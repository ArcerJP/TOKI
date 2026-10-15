const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite'),M=require('../model.js');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('Unicode validation and application abuse cannot lock out a company',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
    insert into auth.users(id,email,email_confirmed_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'audit'||n||'@example.test',now() from generate_series(1,601) n;
    insert into auth.identities select id,'google' from auth.users;insert into auth.sessions(id,user_id) select id,id from auth.users;`);
  await db.exec(fs.readFileSync('database/schema.sql','utf8'));await db.exec(fs.readFileSync('database/companies.sql','utf8'));
  const c=(await db.query("select toki_private.provision_company('Audit company','audit1@example.test') as data")).rows[0].data;
  const auth=async n=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:uid(n),session_id:uid(n),amr:[{method:'oauth'}]})]);await db.exec('set role authenticated');};
  const rpc=async(action,extra={})=>{const params=Object.entries({p_action:action,...extra});return (await db.query('select public.toki_company('+params.map(([key],i)=>key+'=>$'+(i+1)).join(',')+') as data',params.map(([,value])=>value))).rows[0].data;};
  await auth(1);await rpc('list');await db.exec('reset role');
  const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('reset role;begin');try{await fn();}finally{await db.exec('reset role;rollback');}});
  await scenario('name normalization and case comparison agree for Unicode whitespace, expansions and context',async()=>{
    const corpus=['\ufeffAlice','Ali\ufeffce','Alice\ufeff','İ','i\u0307','ΟΣ','ος','οσ','名前','Ａ\u3000Ｂ','😀','\ua7ce','\ua7cf','\u0378','\ud800'];
    for(let i=1;i<=0x10ffff;i++){
      if(i>=0xd800&&i<=0xdfff)continue;
      const c=String.fromCodePoint(i);
      if(M.supportedName(c)&&(c.toLowerCase()!==c||c.normalize('NFKC')!==c||/\s/u.test(c)))corpus.push('A'+c+'B',c);
    }
    const rows=(await db.query("select value,toki_private.normalize_name(value) as normalized,toki_private.name_key(value) as key,toki_private.supported_name(value) as supported from jsonb_array_elements_text($1)",[corpus.filter(c=>c!=='\ud800')])).rows;
    for(const r of rows){assert.equal(r.supported,M.supportedName(r.value));if(r.supported){assert.equal(r.normalized,M.normalizeName(r.value),'normalize '+JSON.stringify(r.value));assert.equal(r.key,M.nameKey(r.value),'case '+JSON.stringify(r.value));}}
    assert.equal(M.supportedName('\ud800'),false);
  });
  await scenario('crafted Unicode payloads are refused without poisoning the board or changing its version',async()=>{
    await auth(1);const before=await rpc('read',{p_company:c.id});
    for(const names of [['Alice\ufeff'],['Ali\ufeffce'],['İ','i\u0307'],['ΟΣ','ος'],['A\u0085B'],['\ua7ce'],['\u0378']]){
      const payload={schemaVersion:4,people:names,groups:[],events:[],meetings:[]};
      assert.equal(M.valid(payload),false);
      assert.equal((await rpc('save',{p_company:c.id,p_payload:payload,p_version:before.version})).message,'INVALID');
      const groups=names.map((name,i)=>({id:'g'+i,name,members:[]}));
      assert.equal((await rpc('save',{p_company:c.id,p_payload:{...payload,people:[],groups},p_version:before.version})).message,'INVALID');
    }
    assert.deepEqual(await rpc('read',{p_company:c.id}),before);
    const valid={schemaVersion:4,people:['飯島','😀','İ'],groups:[],events:[],meetings:[]};
    assert.equal(M.valid((await rpc('save',{p_company:c.id,p_payload:valid,p_version:before.version})).payload),true);
  });
  await scenario('30 new applications per ten minutes across accounts; repeats do not consume company slots',async()=>{
    for(let n=2;n<=31;n++){await auth(n);assert.equal((await rpc('join',{p_code:c.code})).id,c.id);}
    await auth(32);assert.equal((await rpc('join',{p_code:c.code})).message,'JOIN_LIMIT');
    await auth(2);assert.equal((await rpc('join',{p_code:c.code})).id,c.id);
    await db.exec('reset role');const counter=(await db.query('select * from toki_private.company_join_limits where company_id=$1',[c.id])).rows[0];assert.equal(counter.window_attempts,31);
    await db.query("update toki_private.company_join_limits set window_started_at=now()-interval '11 minutes' where company_id=$1",[c.id]);
    await auth(32);assert.equal((await rpc('join',{p_code:c.code})).id,c.id);
  });
  await scenario('invites bypass 50 pending and 500 blocked rows, but cannot reactivate a blocked user',async()=>{
    await db.query("insert into toki_private.company_members(company_id,user_id,status) select $1,id,case when email ~ '^audit5[0-4][0-9]@' then 'pending' else 'blocked' end from auth.users where id>=$2 and id<=$3",[c.id,uid(51),uid(550)]);
    // Exactly 50 pending plus 500 blocked accounts; none occupies active capacity.
    await db.query("insert into toki_private.company_members(company_id,user_id,status) select $1,id,'blocked' from auth.users where id>=$2 and id<=$3",[c.id,uid(551),uid(600)]);
    const counts=(await db.query("select status,count(*)::int as n from toki_private.company_members where company_id=$1 group by status",[c.id])).rows;
    assert.equal(counts.find(r=>r.status==='pending').n,50);assert.equal(counts.find(r=>r.status==='blocked').n,500);
    await auth(1);assert.deepEqual(await rpc('invite',{p_company:c.id,p_email:'audit2@example.test'}),{});
    await auth(2);assert.equal((await rpc('join',{p_code:c.code})).id,c.id);assert.equal((await rpc('list'))[0].status,'active');
    await auth(1);await rpc('invite',{p_company:c.id,p_email:'audit51@example.test'});
    await auth(51);assert.equal((await rpc('list'))[0].status,'blocked');assert.equal((await rpc('read',{p_company:c.id})).message,'DENIED');
  });
  await scenario('expired applications release capacity without deleting blocks or approved members',async()=>{
    await db.query("insert into toki_private.company_members(company_id,user_id,status,created_at) select $1,id,'pending',now()-interval '8 days' from auth.users where id>=$2 and id<=$3",[c.id,uid(51),uid(100)]);
    await db.query("insert into toki_private.company_members(company_id,user_id,status) values($1,$2,'blocked')",[c.id,uid(101)]);
    await auth(51);assert.deepEqual(await rpc('list'),[]);
    await auth(2);assert.equal((await rpc('join',{p_code:c.code})).id,c.id);
    await auth(1);const members=(await rpc('members',{p_company:c.id})).members;assert.equal(members.length,3);assert.ok(members.some(m=>m.status==='blocked'));
    await auth(2);assert.equal((await rpc('list'))[0].status,'pending');
  });
  await scenario('daily saturation cannot block an administrator invitation or existing company reads',async()=>{
    await db.query("insert into toki_private.company_join_limits values($1,now(),1,now(),200)",[c.id]);
    await auth(2);assert.equal((await rpc('join',{p_code:c.code})).message,'JOIN_LIMIT');
    await auth(1);assert.ok((await rpc('read',{p_company:c.id})).payload);await rpc('invite',{p_company:c.id,p_email:'audit2@example.test'});
    await auth(2);await rpc('join',{p_code:c.code});assert.equal((await rpc('list'))[0].status,'active');
  });
  await scenario('a full company invite does not hide existing memberships or exceed the active cap',async()=>{
    const second=(await db.query("select toki_private.provision_company('Second','audit2@example.test') as data")).rows[0].data;
    await db.query("insert into toki_private.company_members(company_id,user_id,status) select $1,id,'active' from auth.users where id>=$2 and id<=$3",[c.id,uid(51),uid(549)]);
    await auth(1);await rpc('invite',{p_company:c.id,p_email:'audit2@example.test'});
    await auth(2);const list=await rpc('list');assert.equal(list.length,1);assert.equal(list[0].id,second.id);
    await db.exec('reset role');await db.query("insert into toki_private.company_members(company_id,user_id,status) values($1,$2,'pending')",[c.id,uid(3)]);
    await auth(1);assert.equal((await rpc('approve',{p_company:c.id,p_member:uid(3)})).message,'LIMIT');
  });
});

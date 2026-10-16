const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('company authorization enforced by PostgreSQL for every read and write',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;`);
  const users=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  const sessions=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
  for(let i=0;i<users.length;i++){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`member${i}@example.com`]);await db.query("insert into auth.identities values($1,'google')",[users[i]]);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[i],users[i]]);}
  await db.exec(fs.readFileSync('database/schema.sql','utf8'));
  const original={schemaVersion:4,people:['Original'],groups:[],events:[],meetings:[]};
  await db.query('insert into public.toki_boards(id,payload) values($1,$2)',['october-2026',original]);
  await db.exec(fs.readFileSync('database/companies.sql','utf8'));
  const initial=(await db.query("select toki_private.bootstrap_company('october-2026','Existing organization','member0@example.com') as data")).rows[0].data;
  const auth=async(index,method='oauth')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(index===null?{}:{sub:users[index],session_id:sessions[index],amr:[{method}]})]);await db.exec('set role '+(index===null?'anon':'authenticated'));};
  const rpc=async(action,extra={})=>{const params={p_action:action,...extra},entries=Object.entries(params);const value=(await db.query(`select public.toki_company(${entries.map(([key],i)=>key+'=>$'+(i+1)).join(',')}) as data`,entries.map(([,v])=>v))).rows[0].data;if(value?.code?.startsWith('TOKI_'))throw Error(value.message);return value;};
  let second;
  await t.test('anonymous and legacy sharing APIs cannot read any company',async()=>{
    await auth(null);await assert.rejects(rpc('list'),/permission denied/);
    await assert.rejects(db.query("select public.toki_share($1)",['a'.repeat(64)]),/permission denied/);
    await assert.rejects(db.query("select toki_private.share_action($1,'read',null,null,null,null)",['a'.repeat(64)]),/permission denied/);
    await assert.rejects(db.query('select * from public.toki_boards'),/permission denied/);
  });
  await t.test('only invited verified Google identity receives existing organization and all data is preserved',async()=>{
    await auth(1);assert.deepEqual(await rpc('list'),[]);await assert.rejects(rpc('read',{p_company:initial.id}),/DENIED/);
    await auth(0,'password');await assert.rejects(rpc('list'),/AUTH/);
    await auth(0);const list=await rpc('list');assert.equal(list[0].role,'admin');assert.equal(list[0].status,'active');
    assert.deepEqual((await rpc('read',{p_company:initial.id})).payload,original);
  });
  await t.test('a second company is independent; its owner cannot read, write or administer the first',async()=>{
    await auth(1);await assert.rejects(rpc('create',{p_name:'Other company'}),/DENIED/);
    await db.exec('reset role');second=(await db.query("select toki_private.provision_company('Other company','member1@example.com') as data")).rows[0].data;await auth(1);await rpc('list');
    assert.equal((await rpc('read',{p_company:second.id})).payload.people.length,0);
    for(const action of ['read','save','members','approve','invite'])await assert.rejects(rpc(action,{p_company:initial.id,p_payload:action==='save'?original:null,p_version:1,p_member:users[1],p_email:'member1@example.com'}),/DENIED/);
    await auth(0);await assert.rejects(rpc('read',{p_company:second.id}),/DENIED/);
  });
  await t.test('company code alone creates only a pending request, never access',async()=>{
    await auth(1);await rpc('join',{p_code:initial.code.toLowerCase()});
    assert.equal((await rpc('list')).find(c=>c.id===initial.id).status,'pending');
    for(const action of ['read','save','members','approve'])await assert.rejects(rpc(action,{p_company:initial.id,p_member:users[1],p_payload:action==='save'?original:null,p_version:1}),/DENIED/);
  });
  await t.test('approval grants schedule access but no administrator powers; writes retain optimistic locking',async()=>{
    await auth(0);await rpc('approve',{p_company:initial.id,p_member:users[1]});
    await auth(1);assert.equal((await rpc('read',{p_company:initial.id})).version,1);
    const value=await rpc('save',{p_company:initial.id,p_payload:{...original,people:['Updated']},p_version:1});assert.equal(value.version,2);
    await assert.rejects(rpc('save',{p_company:initial.id,p_payload:original,p_version:1}),/CONFLICT/);
    await assert.rejects(rpc('members',{p_company:initial.id}),/DENIED/);
    await assert.rejects(rpc('role',{p_company:initial.id,p_member:users[1],p_role:'admin'}),/DENIED/);
  });
  await t.test('revocation immediately blocks stale-session reads and writes, code and invitation cannot reactivate a blocked user',async()=>{
    await auth(0);await rpc('block',{p_company:initial.id,p_member:users[1]});await rpc('invite',{p_company:initial.id,p_email:'member1@example.com'});
    await auth(1);await rpc('join',{p_code:initial.code});assert.equal((await rpc('list')).find(c=>c.id===initial.id).status,'blocked');
    await assert.rejects(rpc('read',{p_company:initial.id}),/DENIED/);await assert.rejects(rpc('save',{p_company:initial.id,p_payload:original,p_version:2}),/DENIED/);
  });
  await t.test('invites match the verified email and never accept a client role escalation',async()=>{
    await auth(0);await rpc('invite',{p_company:initial.id,p_email:'MEMBER2@example.com',p_role:'admin'});
    await auth(2);const c=(await rpc('list'))[0];assert.equal(c.id,initial.id);assert.equal(c.role,'member');assert.equal(c.status,'active');
  });
  await t.test('the last administrator cannot be removed; a separate promotion permits changing admins',async()=>{
    // A stopped admin in this company and an active admin in another company do not count.
    await db.exec('reset role');await db.query("update toki_private.company_members set role='admin' where company_id=$1 and user_id=$2",[initial.id,users[1]]);
    await auth(0);await assert.rejects(rpc('block',{p_company:initial.id,p_member:users[0]}),/LAST_ADMIN/);
    await assert.rejects(rpc('role',{p_company:initial.id,p_member:users[0],p_role:'member'}),/LAST_ADMIN/);
    assert.equal((await rpc('list')).find(c=>c.id===initial.id).role,'admin');
    await rpc('role',{p_company:initial.id,p_member:users[2],p_role:'admin'});
    let members=(await rpc('members',{p_company:initial.id})).members;
    assert.deepEqual(members.filter(m=>m.status==='active'&&m.role==='admin').map(m=>m.id).sort(),[users[0],users[2]]);
    await rpc('role',{p_company:initial.id,p_member:users[0],p_role:'member'});
    await assert.rejects(rpc('members',{p_company:initial.id}),/DENIED/);
    await auth(2);await assert.rejects(rpc('role',{p_company:initial.id,p_member:users[2],p_role:'member'}),/LAST_ADMIN/);
    await assert.rejects(rpc('block',{p_company:initial.id,p_member:users[2]}),/LAST_ADMIN/);
    members=(await rpc('members',{p_company:initial.id})).members;
    assert.deepEqual(members.filter(m=>m.status==='active'&&m.role==='admin').map(m=>m.id),[users[2]]);
  });
  await t.test('a revoked Supabase session cannot reuse its unexpired JWT',async()=>{
    await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[sessions[2]]);await auth(2);await assert.rejects(rpc('read',{p_company:initial.id}),/AUTH/);
  });
  await t.test('reapplying either migration does not reopen old access or destroy company schedules',async()=>{
    await db.exec('reset role');await db.exec(fs.readFileSync('database/schema.sql','utf8'));await db.exec(fs.readFileSync('database/companies.sql','utf8'));
    await auth(0);assert.equal((await rpc('read',{p_company:initial.id})).payload.people[0],'Updated');
    await assert.rejects(db.query("select public.toki_share($1)",['a'.repeat(64)]),/permission denied/);
  });
  await t.test('operators alone can provision; direct private-function and table access cannot bypass the API',async()=>{
    for(const i of [0,1]){
      await auth(i);await assert.rejects(rpc('create',{p_name:'Abusive company'}),/DENIED/);
      for(const query of ["select toki_private.provision_company('X','member0@example.com')","select toki_private.bootstrap_company('october-2026','X','member0@example.com')","select toki_private.company_action('list')","select * from toki_private.request_limits","select * from toki_private.company_invites","update public.toki_boards set payload='{}'"])
        await assert.rejects(db.query(query),/permission denied/);
    }
    await db.exec('reset role');assert.equal((await db.query('select count(*)::int as n from toki_private.companies')).rows[0].n,2);
  });
  await t.test('oversized, unexpected and client-incompatible payloads are rejected without changing data or version',async()=>{
    await auth(0);const before=await rpc('read',{p_company:initial.id});
    const group={id:'g',name:'Group',members:[0]},event={id:'e',person:0,date:'2026-10-05',start:540,end:600},meeting={id:'m',group:'g',date:'2026-10-05',start:600,end:660,members:[0]};
    for(const payload of [
      {...original,extra:'x'}, {...original,extra:'x'.repeat(2097153)}, {...original,people:['😀'.repeat(21)]},
      {...original,groups:[{...group,extra:'x'}]}, {...original,events:[{...event,extra:'x'}]},
      {...original,events:[{...event,id:'😀'.repeat(51)}]},
      {...original,groups:[group],meetings:[{...meeting,extra:'x'}]},
      {...original,groups:[{...group,members:Array(101).fill(0)}]},
      {...original,events:[{...event,date:'2026-02-31'}]},
      {...original,events:[{...event,person:99}]}
    ])await assert.rejects(rpc('save',{p_company:initial.id,p_payload:payload,p_version:before.version}),/INVALID/);
    assert.deepEqual(await rpc('read',{p_company:initial.id}),before);
  });
  await t.test('failed requests consume a bounded quota, company codes cannot reset it, and it recovers after a minute',async()=>{
    await db.exec('reset role');await db.query('delete from toki_private.request_limits where user_id=$1',[users[0]]);await auth(0);
    for(let i=0;i<5;i++)await assert.rejects(rpc('join',{p_code:String(i).repeat(32)}),/COMPANY/);
    await assert.rejects(rpc('join',{p_code:initial.code}),/RATE_LIMIT/);
    await assert.rejects(rpc('create',{p_name:'Not another bucket'}),/RATE_LIMIT/);
    assert.ok(await rpc('read',{p_company:initial.id}),'read quota is independent');
    await db.exec('reset role');const rows=(await db.query('select bucket,attempts from toki_private.request_limits where user_id=$1',[users[0]])).rows;
    assert.equal(rows.length,2);assert.equal(rows.find(r=>r.bucket==='join').attempts,7);
    await db.query("update toki_private.request_limits set started_at=now()-interval '2 minutes' where user_id=$1",[users[0]]);await auth(0);
    await rpc('join',{p_code:initial.code});
  });
  await t.test('banned accounts and expired sessions cannot use a still-signed JWT',async()=>{
    await db.exec('reset role');await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[users[0]]);await auth(0);
    await assert.rejects(rpc('read',{p_company:initial.id}),/AUTH/);
    await db.exec('reset role');await db.query('update auth.users set banned_until=null where id=$1',[users[0]]);await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions[0]]);await auth(0);
    await assert.rejects(rpc('read',{p_company:initial.id}),/AUTH/);
  });
  await t.test('expired invitations also count toward storage quota and can be cancelled',async()=>{
    await db.exec('reset role');await db.query("insert into toki_private.company_invites(company_id,email,expires_at) select $1,'expired'||i||'@example.com',now()-interval '1 day' from generate_series(1,100) i",[second.id]);await auth(1);
    await assert.rejects(rpc('invite',{p_company:second.id,p_email:'overflow@example.com'}),/LIMIT/);
    await rpc('cancel_invite',{p_company:second.id,p_email:'expired1@example.com'});
    await rpc('invite',{p_company:second.id,p_email:'replacement@example.com'});
  });
});

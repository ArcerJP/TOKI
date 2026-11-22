const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomBytes,randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');

test('guest links are single-use, device sessions share one person, and access stays scoped',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for(const file of ['schema.sql','companies.sql','enable-scoped-schedule.sql','guest-invitations.sql'])
    await db.exec(fs.readFileSync('database/'+file,'utf8'));
  const accounts=['admin','other'].map(name=>({id:randomUUID(),session:randomUUID(),email:name+'@example.test'}));
  for(const account of accounts){
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[account.id,account.email]);
    await db.query("insert into auth.identities values($1,'google')",[account.id]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)",[account.session,account.id]);
  }
  const {org}=(await db.query("select toki_private.provision_company('Guests','admin@example.test') as org")).rows[0];
  const {other}=(await db.query("select toki_private.provision_company('Other org','other@example.test') as other")).rows[0];
  const rows=['person','place','person','person'].map(kind=>({id:randomUUID(),kind}));
  const groups=[{id:'open',name:'Visible',members:[0,1]},{id:'private',name:'Confidential',members:[3]}];
  const date='2026-11-22';
  const event=(id,person,start=540,end=600)=>({id,person,date,start,end});
  const seed={schemaVersion:4,people:['Visible person','Visible place','Additional person','Private person'],rows,groups,
    events:[event('visible',0),event('place',1),event('additional',2),event('secret',3)],meetings:[]};
  await db.query('update public.toki_boards set payload=$1 where id=(select board_id from toki_private.companies where id=$2)',[seed,org.id]);

  async function auth(index){
    await db.exec('reset role');
    const account=accounts[index];
    const claims=account?{sub:account.id,session_id:account.session,amr:[{method:'oauth'}]}:{};
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);
    await db.exec(account?'set role authenticated':'set role anon');
  }
  async function call(fn,args){
    const entries=Object.entries(args);
    const {value}=(await db.query(`select public.${fn}(${entries.map(([name],index)=>name+'=> $'+(index+1)).join(',')}) as value`,
      entries.map(([,item])=>item))).rows[0];
    if(value?.code)throw Error(value.message);
    return value;
  }
  const admin=(action,params={})=>call('toki_guest_admin',{p_action:action,p_company:org.id,...params});
  const session=()=>randomBytes(32).toString('hex');
  const a=session(),b=session(),wrong=session();
  const guest=(action,token,params={})=>call('toki_guest',{p_action:action,p_code:org.code,p_token:token,...params});
  const access=(groups,people)=>({groups,people});
  await auth(null);
  await assert.rejects(admin('list'),/permission denied/);
  await assert.rejects(guest('read',wrong),/GUEST_ACCESS/);
  await auth(0);
  await call('toki_company',{p_action:'list'});
  await assert.rejects(admin('issue',{p_name:'Bad',p_access:access([], [rows[1].id])}),/INVALID/);
  const issued=await admin('issue',{p_name:'Invitee',p_access:access(['open'],[rows[2].id])});
  assert.match(issued.ticket,/^[0-9a-f]{64}$/);
  await assert.rejects(admin('issue',{p_name:'Invitee',p_access:access([],[])}),/NAME_TAKEN/);
  const {guests:[record]}=await admin('list');
  assert.equal(record.devices,0);
  assert.equal(record.unusedLink,true);
  assert.equal(record.ticket,undefined);
  await assert.rejects(guest('claim',a,{p_invite:issued.ticket}),/permission denied/);
  await auth(1);
  await call('toki_company',{p_action:'list'});
  await assert.rejects(admin('list'),/DENIED/);
  await assert.rejects(admin('revoke',{p_company:other.id,p_guest:record.id}),/DENIED/);

  await auth(null);
  await assert.rejects(guest('claim',a,{p_code:other.code,p_invite:issued.ticket}),/GUEST_ACCESS/);
  const first=await guest('claim',a,{p_invite:issued.ticket});
  assert.equal(first.board.access.role,'guest');
  assert.deepEqual(first.board.payload.people,['Visible person','Visible place','Additional person','Invitee']);
  assert.deepEqual(first.board.payload.groups.map(g=>g.id),['open']);
  assert.deepEqual(first.board.payload.events.map(e=>e.id),['visible','place','additional']);
  assert.deepEqual(await guest('claim',a,{p_invite:issued.ticket}),first);
  await assert.rejects(guest('claim',wrong,{p_invite:issued.ticket}),/GUEST_ACCESS/);
  assert.equal((await guest('read',a)).guest.id,record.id);
  await assert.rejects(call('toki_company',{p_action:'read',p_company:org.id}),/permission denied/);
  const p=first.board.payload,own=p.people.indexOf('Invitee');
  const save=(token,version,payload)=>guest('save',token,{p_version:version,p_payload:payload});
  for(const id of ['visible','place','additional']){
    await assert.rejects(save(a,first.board.version,{...p,events:p.events.filter(e=>e.id!==id)}),/DENIED/);
  }
  const edited=await save(a,first.board.version,{...p,events:[...p.events,event('own',own)]});
  assert.ok(edited.board.payload.events.some(e=>e.id==='own'));
  await assert.rejects(save(a,first.board.version,p),/CONFLICT/);

  await auth(0);
  const extra=await admin('add_device',{p_guest:record.id});
  await auth(null);
  const second=await guest('claim',b,{p_invite:extra.ticket});
  assert.equal(second.board.access.personId,first.board.access.personId);
  assert.deepEqual(second.board.payload,(await guest('read',a)).board.payload);
  await assert.rejects(guest('claim',wrong,{p_invite:extra.ticket}),/GUEST_ACCESS/);
  await auth(0);
  assert.equal((await admin('list')).guests[0].devices,2);
  await admin('set_access',{p_guest:record.id,p_access:access([],[])});
  await auth(null);
  assert.deepEqual((await guest('read',a)).board.payload.people,['Invitee']);
  assert.deepEqual((await guest('read',b)).board.payload.people,['Invitee']);
  await auth(0);
  await admin('revoke',{p_guest:record.id});
  assert.equal((await admin('list')).guests[0].devices,0);
  await auth(null);
  await assert.rejects(guest('read',a),/GUEST_ACCESS/);
  await assert.rejects(guest('read',b),/GUEST_ACCESS/);
  await assert.rejects(guest('claim',b,{p_invite:extra.ticket}),/GUEST_ACCESS/);
  await auth(0);
  const board=await call('toki_company',{p_action:'read',p_company:org.id});
  assert.ok(board.payload.events.some(e=>e.id==='secret'));
  assert.ok(board.payload.events.some(e=>e.id==='own'));
});

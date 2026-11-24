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
  const accounts=['admin','other','converted'].map(name=>({id:randomUUID(),session:randomUUID(),email:name+'@example.test'}));
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
  const access=groups=>({groups});
  await auth(null);
  await assert.rejects(admin('list'),/permission denied/);
  await assert.rejects(guest('read',wrong),/GUEST_ACCESS/);
  await auth(0);
  await call('toki_company',{p_action:'list'});
  await assert.rejects(admin('issue',{p_name:'Bad',p_access:{groups:[],people:[rows[2].id]}}),/INVALID/);
  const issued=await admin('issue',{p_name:'Invitee',p_access:access(['open'])});
  assert.match(issued.ticket,/^[0-9a-f]{64}$/);
  await assert.rejects(admin('issue',{p_name:'Invitee',p_access:access([])}),/NAME_TAKEN/);
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
  assert.deepEqual(first.board.payload.people,['Visible person','Visible place','Invitee']);
  assert.deepEqual(first.board.payload.groups.map(g=>g.id),['open']);
  assert.deepEqual(first.board.payload.events.map(e=>e.id),['visible','place']);
  assert.deepEqual(await guest('claim',a,{p_invite:issued.ticket}),first);
  await assert.rejects(guest('claim',wrong,{p_invite:issued.ticket}),/GUEST_ACCESS/);
  assert.equal((await guest('read',a)).guest.id,record.id);
  await assert.rejects(call('toki_company',{p_action:'read',p_company:org.id}),/permission denied/);
  const p=first.board.payload,own=p.people.indexOf('Invitee');
  const save=(token,version,payload)=>guest('save',token,{p_version:version,p_payload:payload});
  for(const id of ['visible','place']){
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
  await admin('set_access',{p_guest:record.id,p_access:access([])});
  await assert.rejects(admin('delete',{p_guest:record.id}),/MEMBER_NOT_STOPPED/);
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

  await admin('delete',{p_guest:record.id});
  const remaining=await call('toki_company',{p_action:'read',p_company:org.id});
  assert.deepEqual(remaining.payload,seed);
  await assert.rejects(admin('issue_batch',{p_access:[{name:'Batch ID01',groups:[]},{name:'Batch ID01',groups:[]}]}),/NAME_TAKEN/);
  assert.deepEqual((await admin('list')).guests,[]);
  const {invitations:[toLink,toCancel]}=await admin('issue_batch',{p_access:[
    {name:'Batch ID01',groups:['open']},{name:'Batch ID02',groups:[]}
  ]});
  assert.notEqual(toLink.ticket,toCancel.ticket);
  await admin('revoke',{p_guest:toCancel.id});
  const c=session(),d=session();
  await auth(null);
  await assert.rejects(guest('claim',d,{p_invite:toCancel.ticket}),/GUEST_ACCESS/);
  const claimed=await guest('claim',c,{p_invite:toLink.ticket});
  const ownRow=claimed.board.payload.people.indexOf('Batch ID01');
  assert.equal(claimed.board.payload.groups[0].members.includes(ownRow),false,'view access does not add group membership');
  await save(c,claimed.board.version,{...claimed.board.payload,events:[...claimed.board.payload.events,event('retained',ownRow)]});
  await auth(0);
  const initialMembership=await call('toki_company',{p_action:'read',p_company:org.id});
  const registered=initialMembership.payload.rows.findIndex(row=>row.id===claimed.board.access.personId);
  const assigned={...initialMembership.payload,groups:initialMembership.payload.groups.map(group=>
    group.id==='open'?{...group,members:[...group.members,registered]}:group)};
  await call('toki_company',{p_action:'save',p_company:org.id,p_version:initialMembership.version,p_payload:assigned});
  const secondDevice=await admin('add_device',{p_guest:toLink.id});

  await db.exec('reset role');
  await db.exec("alter table toki_private.company_guests add column visible_people uuid[] not null default '{}'");
  await db.query('update toki_private.company_guests set visible_people=$1 where id=$2',[[rows[2].id],toLink.id]);
  await db.exec(fs.readFileSync('database/companies.sql','utf8'));
  await db.exec(fs.readFileSync('database/guest-invitations.sql','utf8'));
  assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_schema='toki_private' and table_name='company_guests' and column_name='visible_people'")).rows[0].n,0);
  await auth(null);
  const twoDevices=await guest('claim',d,{p_invite:secondDevice.ticket});
  assert.deepEqual(twoDevices.board.payload.people,['Visible person','Visible place','Batch ID01']);
  assert.equal(twoDevices.board.payload.groups[0].members.includes(ownRow),true);

  const convert=token=>call('toki_company',{p_action:'link_guest',p_code:org.code,p_payload:JSON.stringify(token)});
  await auth(0);
  await assert.rejects(convert(c),/MEMBER_EXISTS/);
  await auth(2);
  await assert.rejects(convert(wrong),/DENIED/);
  assert.equal((await convert(c)).id,org.id);
  const member=await call('toki_company',{p_action:'read',p_company:org.id});
  assert.equal(member.access.role,'member');
  assert.equal(member.access.personId,claimed.board.access.personId);
  assert.deepEqual(member.payload,twoDevices.board.payload);
  assert.ok(member.payload.events.some(e=>e.id==='retained'));
  await auth(null);
  await assert.rejects(guest('read',c),/GUEST_ACCESS/);
  await assert.rejects(guest('read',d),/GUEST_ACCESS/);
  await assert.rejects(guest('claim',d,{p_invite:secondDevice.ticket}),/GUEST_ACCESS/);
});

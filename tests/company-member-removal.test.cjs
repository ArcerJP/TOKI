const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('only stopped memberships can be removed, with invitations, without deleting accounts or schedules',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;`);
  const users=[1,2,3,4].map(i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));
  const sessions=[1,2,3,4].map(i=>'10000000-0000-4000-8000-'+String(i).padStart(12,'0'));
  for(let i=0;i<users.length;i++){
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[users[i],`member${i}@example.test`]);
    await db.query("insert into auth.identities values($1,'google')",[users[i]]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sessions[i],users[i]]);
  }
  await db.exec(fs.readFileSync('database/schema.sql','utf8'));await db.exec(fs.readFileSync('database/companies.sql','utf8'));
  const a=(await db.query("select toki_private.provision_company('Company A','member0@example.test') as data")).rows[0].data;
  const b=(await db.query("select toki_private.provision_company('Company B','member3@example.test') as data")).rows[0].data;
  for(const [company,user,role,status] of [[a.id,users[0],'admin','active'],[a.id,users[1],'admin','blocked'],[a.id,users[2],'member','active'],[b.id,users[1],'member','active'],[b.id,users[3],'admin','active']])
    await db.query('insert into toki_private.company_members(company_id,user_id,role,status) values($1,$2,$3,$4)',[company,user,role,status]);
  await db.query("update public.toki_boards set payload=jsonb_set(payload,'{people}','[\"Test member\"]') where id=(select board_id from toki_private.companies where id=$1)",[a.id]);
  // A fresh invitation registered while blocked must not re-enrol a deleted member.
  await db.query("insert into toki_private.company_invites(company_id,email) values($1,'member1@example.test'),($2,'member1@example.test')",[a.id,b.id]);
  const root=()=>db.exec('reset role');
  const auth=async i=>{await root();await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i===null?{}:{sub:users[i],session_id:sessions[i],amr:[{method:'oauth'}]})]);await db.exec('set role '+(i===null?'anon':'authenticated'));};
  const call=async(action,company=a.id,target=users[1])=>{
    const data=(await db.query('select public.toki_company($1,p_company=>$2,p_member=>$3) as data',[action,company,target])).rows[0].data;
    if(data.code?.startsWith('TOKI_'))throw Error(data.message);return data;
  };
  const snapshot=async()=>{await root();const result={};for(const [key,sql] of Object.entries({members:'select * from toki_private.company_members order by company_id,user_id',invites:'select * from toki_private.company_invites order by company_id,email',boards:'select * from public.toki_boards order by id',users:'select * from auth.users order by id'}))result[key]=(await db.query(sql)).rows;return result;};
  const original=await snapshot();
  await t.test('anonymous, ordinary members, stopped users and other-company admins are denied',async()=>{
    await auth(null);await assert.rejects(call('remove_member'),/permission denied/);
    for(const i of [1,2,3]){await auth(i);await assert.rejects(call('remove_member'),/DENIED/);}
    await auth(0);await assert.rejects(call('remove_member',b.id),/DENIED/);assert.deepEqual(await snapshot(),original);
  });
  await t.test('self, unrelated, missing and non-stopped targets cannot be deleted',async()=>{
    for(const target of [null,users[0],users[3],'00000000-0000-4000-8000-000000000099']){await auth(0);await assert.rejects(call('remove_member',a.id,target),/INVALID/);}
    for(const status of ['active','pending']){
      await root();await db.query('update toki_private.company_members set status=$1 where company_id=$2 and user_id=$3',[status,a.id,users[1]]);
      const before=await snapshot();await auth(0);await assert.rejects(call('remove_member'),/MEMBER_NOT_STOPPED/);assert.deepEqual(await snapshot(),before);
    }
    await db.query("update toki_private.company_members set status='blocked' where company_id=$1 and user_id=$2",[a.id,users[1]]);assert.deepEqual(await snapshot(),original);
  });
  await t.test('failure removing a membership also rolls back cancellation of its invitation',async()=>{
    await db.exec(`create function toki_private.reject_test_removal() returns trigger language plpgsql as $$begin raise exception 'TEST_FAILURE';end;$$;
      create trigger test_removal_failure before delete on toki_private.company_members for each row execute function toki_private.reject_test_removal();`);
    await auth(0);await assert.rejects(call('remove_member'),/INVALID/);assert.deepEqual(await snapshot(),original);
    await db.exec('drop trigger test_removal_failure on toki_private.company_members;drop function toki_private.reject_test_removal();');
  });
  await t.test('deletion affects only that membership and invitation; a new application needs approval',async()=>{
    await auth(0);assert.deepEqual(await call('remove_member'),{});
    const after=await snapshot();assert.deepEqual(after.members,original.members.filter(m=>!(m.company_id===a.id&&m.user_id===users[1])));
    assert.deepEqual(after.invites,original.invites.filter(i=>!(i.company_id===a.id&&i.email==='member1@example.test')));assert.deepEqual(after.boards,original.boards);assert.deepEqual(after.users,original.users);
    await auth(0);const members=await call('members');assert.equal(members.members.some(m=>m.id===users[1]),false);
    await assert.rejects(call('remove_member'),/INVALID/);
    await auth(1);const companies=await call('list');assert.equal(companies.some(c=>c.id===a.id),false);assert.equal(companies.some(c=>c.id===b.id&&c.status==='active'),true);
    await assert.rejects(call('read'),/DENIED/);assert.equal((await call('read',b.id)).companyId,b.id);
    const joined=(await db.query("select public.toki_company('join',p_code=>$1) as data",[a.code])).rows[0].data;assert.equal(joined.id,a.id);
    assert.equal((await call('list')).find(c=>c.id===a.id).status,'pending');await assert.rejects(call('read'),/DENIED/);
    await auth(0);await call('approve');await auth(1);const member=(await call('list')).find(c=>c.id===a.id);assert.equal(member.status,'active');assert.equal(member.role,'member');
  });
});

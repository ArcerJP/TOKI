const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('administrator transfer is atomic, company-scoped and restricted to approved Google members',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
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
  for(const [company,user,role] of [[a.id,users[0],'admin'],[a.id,users[1],'member'],[a.id,users[2],'admin'],[b.id,users[0],'admin'],[b.id,users[3],'admin']])
    await db.query("insert into toki_private.company_members(company_id,user_id,role,status) values($1,$2,$3,'active')",[company,user,role]);
  const auth=async i=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify(i===null?{}:{sub:users[i],session_id:sessions[i],amr:[{method:'oauth'}]})]);await db.exec('set role '+(i===null?'anon':'authenticated'));};
  const transfer=async(target,company=a.id)=>{
    const data=(await db.query("select public.toki_company('transfer_admin',p_company=>$1,p_member=>$2) as data",[company,target])).rows[0].data;
    if(data.code?.startsWith('TOKI_'))throw Error(data.message);return data;
  };
  const snapshot=async()=>{await db.exec('reset role');return {members:(await db.query('select * from toki_private.company_members order by company_id,user_id')).rows,boards:(await db.query('select * from public.toki_boards order by id')).rows};};
  const original=await snapshot();
  await t.test('non-admin, other-company admin and anonymous callers cannot transfer',async()=>{
    for(const i of [1,3]){await auth(i);await assert.rejects(transfer(users[1]),/DENIED/);}
    await auth(null);await assert.rejects(transfer(users[1]),/permission denied/);
    assert.deepEqual(await snapshot(),original);
  });
  await t.test('self, missing, unrelated, pending, blocked or unavailable targets change nothing',async()=>{
    for(const target of [null,users[0],users[3],'00000000-0000-4000-8000-000000000099']){await auth(0);await assert.rejects(transfer(target),/INVALID/);}
    for(const status of ['pending','blocked']){
      await db.exec('reset role');await db.query('update toki_private.company_members set status=$1 where company_id=$2 and user_id=$3',[status,a.id,users[1]]);
      const before=await snapshot();await auth(0);await assert.rejects(transfer(users[1]),/INVALID/);assert.deepEqual(await snapshot(),before);
    }
    await db.query("update toki_private.company_members set status='active' where company_id=$1 and user_id=$2",[a.id,users[1]]);
    await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[users[1]]);await auth(0);await assert.rejects(transfer(users[1]),/INVALID/);
    await db.exec('reset role');await db.query('update auth.users set banned_until=null,email_confirmed_at=null where id=$1',[users[1]]);await auth(0);await assert.rejects(transfer(users[1]),/INVALID/);
    await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[users[1]]);
    await db.query("update auth.identities set provider='email' where user_id=$1",[users[1]]);await auth(0);await assert.rejects(transfer(users[1]),/INVALID/);
    await db.exec('reset role');await db.query("update auth.identities set provider='google' where user_id=$1",[users[1]]);
    assert.deepEqual(await snapshot(),original);
  });
  await t.test('a database failure rolls back both role changes',async()=>{
    await db.exec(`create function toki_private.reject_test_transfer() returns trigger language plpgsql as $$begin if new.role='member' and old.role='admin' then raise exception 'TEST_FAILURE'; end if;return new;end;$$;
      create trigger test_transfer_failure before update on toki_private.company_members for each row execute function toki_private.reject_test_transfer();`);
    await auth(0);await assert.rejects(transfer(users[1]),/INVALID/);assert.deepEqual(await snapshot(),original);
    await db.exec('drop trigger test_transfer_failure on toki_private.company_members; drop function toki_private.reject_test_transfer();');
  });
  await t.test('success promotes the target and demotes only the caller, retaining data and other admins',async()=>{
    await auth(0);assert.deepEqual(await transfer(users[1]),{role:'member'});
    const after=await snapshot(),role=(company,user)=>after.members.find(m=>m.company_id===company&&m.user_id===user).role;
    assert.equal(role(a.id,users[0]),'member');assert.equal(role(a.id,users[1]),'admin');assert.equal(role(a.id,users[2]),'admin');assert.equal(role(b.id,users[0]),'admin');
    assert.deepEqual(after.boards,original.boards);
    await auth(0);await assert.rejects(transfer(users[2]),/DENIED/);assert.deepEqual(await snapshot(),after);
    await auth(1);assert.deepEqual(await transfer(users[0]),{role:'member'});assert.deepEqual(await snapshot(),original);
  });
  await t.test('an expired caller session cannot transfer even with an administrator role',async()=>{
    await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions[0]]);await auth(0);await assert.rejects(transfer(users[1]),/AUTH/);
    assert.deepEqual(await snapshot(),original);
  });
});

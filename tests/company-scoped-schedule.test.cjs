const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');

test('scoped schedules protect person rows and preserve places when detached', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const file of ['schema.sql', 'companies.sql']) await db.exec(fs.readFileSync('database/' + file, 'utf8'));
  const users = [];
  for (let i = 0; i < 3; i++) {
    const {id} = (await db.query('insert into auth.users values(gen_random_uuid(),$1,now()) returning id', [`test${i}@example.test`])).rows[0];
    const session = (await db.query('insert into auth.sessions values(gen_random_uuid(),$1) returning id', [id])).rows[0].id;
    await db.query("insert into auth.identities values($1,'google')", [id]);
    users.push({id, session});
  }
  const org = (await db.query("select toki_private.provision_company('Test organization','test0@example.test') as org")).rows[0].org;
  const date = '2026-10-05';
  const event = (id, person, start = 540, end = 600) => ({id, person, date, start, end});
  const original = {
    schemaVersion: 4, people: ['Existing', 'Private'],
    groups: [{id:'open',name:'Open group',members:[0]}, {id:'private',name:'Private group',members:[1]}],
    events: [event('existing', 0), event('hidden', 1)], meetings: []
  };
  await db.query('update public.toki_boards set payload=$2 where id=(select board_id from toki_private.companies where id=$1)', [org.id, original]);
  await db.exec(fs.readFileSync('database/enable-scoped-schedule.sql', 'utf8'));
  await db.exec(fs.readFileSync('database/companies.sql', 'utf8'));

  async function signIn(index) {
    const {id, session} = users[index];
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id,session_id:session,amr:[{method:'oauth'}]})]);
    await db.exec('set role authenticated');
  }
  async function rpc(action, params = {}) {
    const args = Object.entries({p_action:action,p_company:org.id,...params});
    const {data} = (await db.query(`select public.toki_company(${args.map(([name],i)=>name+'=>$'+(i+1)).join(',')}) as data`, args.map(([,value])=>value))).rows[0];
    if (data?.code?.startsWith('TOKI_')) throw Error(data.message);
    return data;
  }
  const save = (version, payload) => rpc('save', {p_version:version,p_payload:payload});
  const access = groups => rpc('set_group_access', {p_member:users[1].id,p_payload:JSON.stringify(groups)});

  await signIn(0);
  assert.equal((await rpc('list'))[0].scopedSchedule, true);
  let board = await rpc('read');
  const {rows, ...legacy} = board.payload;
  assert.deepEqual(legacy, original);
  assert.equal(rows.length, 2);
  await rpc('assign_person', {p_member:users[0].id,p_name:'Administrator'});
  const adminRow = (await rpc('read')).access.personId;
  await rpc('invite', {p_email:'test1@example.test',p_name:'Member'});
  await assert.rejects(rpc('invite', {p_email:'test2@example.test',p_name:'Member'}), /NAME_TAKEN/);
  await signIn(1);
  assert.equal((await rpc('list'))[0].role, 'member');
  const own = await rpc('read');
  const memberRow = own.access.personId;
  assert.deepEqual(own.payload.people, ['Member']);
  assert.deepEqual(own.payload.groups, []);
  await assert.rejects(access(['open']), /DENIED/);
  await save(own.version, {...own.payload,events:[event('mine',0)]});
  await signIn(2);
  await rpc('join', {p_code:org.code});
  await assert.rejects(rpc('read'), /DENIED/);
  await signIn(0);
  await assert.rejects(rpc('approve', {p_member:users[2].id}), /NAME_INVALID/);
  await rpc('approve', {p_member:users[2].id,p_name:'Applicant'});
  await access(['open']);
  board = await rpc('read');
  assert.equal(board.payload.people[3], 'Member');
  assert.equal(board.payload.people[4], 'Applicant');
  const shared = await rpc('add_place', {p_version:board.version,p_name:'Shared room',p_payload:{groups:['open','private']}});
  shared.board.payload.meetings.push({id:'reservation',group:'private',members:[5],date,start:660,end:720});
  await save(shared.board.version,shared.board.payload);

  await signIn(1);
  board = await rpc('read');
  assert.deepEqual(board.payload.people, ['Existing','Member','Shared room']);
  assert.deepEqual(board.payload.groups.map(g=>g.id), ['open']);
  assert.deepEqual(board.payload.meetings, []);
  assert.deepEqual(board.payload.events.map(e=>e.person), [0,1]);
  const edited = structuredClone(board.payload);
  edited.events.push(event('room',2));
  await assert.rejects(save(board.version, {...edited,events:[...edited.events,event('busy',2,660,720)]}), /SCHEDULE_BUSY/);
  await assert.rejects(save(board.version, {...edited,events:edited.events.filter(e=>e.person!==0)}), /DENIED/);
  await assert.rejects(rpc('remove_row', {p_version:board.version,p_member:memberRow}), /DENIED/);
  await assert.rejects(rpc('remove_row', {p_version:board.version,p_member:shared.id}), /DENIED/);
  await assert.rejects(rpc('detach_place', {p_version:board.version,p_member:shared.id,p_payload:'"private"'}), /DENIED/);
  board = await save(board.version, edited);
  await assert.rejects(save(board.version-1, edited), /CONFLICT/);
  const {board: detached} = await rpc('detach_place', {p_version:board.version,p_member:shared.id,p_payload:'"open"'});
  assert.deepEqual(detached.payload.people, ['Existing','Member']);
  const local = await rpc('add_place', {p_version:detached.version,p_name:'Local room',p_payload:{groups:['open']}});
  await rpc('remove_row', {p_version:local.board.version,p_member:local.id});

  await signIn(0);
  board = await rpc('read');
  assert.deepEqual(board.payload.groups.map(g=>g.members), [[0],[1,5]]);
  assert.deepEqual(board.payload.events.find(e=>e.id==='room'),event('room',5));
  assert.deepEqual(board.payload.meetings[0].members,[5]);
  await assert.rejects(rpc('remove_row', {p_version:board.version,p_member:adminRow}), /LAST_ADMIN/);
  await rpc('detach_place', {p_version:board.version,p_member:shared.id,p_payload:'"private"'});
  board = await rpc('read');
  assert.equal(board.payload.rows[5].id,shared.id);
  assert.deepEqual(board.payload.meetings[0].members,[5]);
  await access([]);
  await signIn(1);
  board = await rpc('read');
  assert.deepEqual(board.payload.people,['Member']);
  assert.deepEqual(board.payload.events,[event('mine',0)]);
  await signIn(0);
  board = await rpc('read');
  const removed = await rpc('remove_row', {p_version:board.version,p_member:memberRow});
  assert.equal(removed.board.payload.people.includes('Member'),false);
  assert.equal(removed.board.payload.events.some(e=>e.id==='mine'),false);
  assert.equal(removed.board.payload.events.find(e=>e.id==='room').person,4);
  await signIn(1);
  await assert.rejects(rpc('read'), /DENIED/);
});

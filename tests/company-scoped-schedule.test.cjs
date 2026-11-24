const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {randomBytes} = require('node:crypto');
const {PGlite} = require('@electric-sql/pglite');
const S = require('../src/core/schedule.js');

test('scoped schedules protect person rows and preserve places when detached', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
    create table auth.identities(user_id uuid,provider text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;`);
  for (const file of ['schema.sql', 'companies.sql', 'guest-invitations.sql', 'application-mail.sql'])
    await db.exec(fs.readFileSync('database/' + file, 'utf8'));
  const users = [];
  for (let i = 0; i < 5; i++) {
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
  await assert.rejects(rpc('apply', {p_code:org.code}), /NAME_INVALID/);
  await rpc('apply', {p_code:org.code,p_name:'Requested name'});
  await rpc('apply', {p_code:org.code,p_name:'Duplicate request'});
  await assert.rejects(rpc('read'), /DENIED/);
  const workerKey=randomBytes(32).toString('hex');
  await db.exec('reset role');
  await db.query("insert into toki_private.company_application_mail_worker(credential_hash) values(sha256(convert_to($1,'UTF8')))",[workerKey]);
  await db.exec('set role anon');
  async function notify(key,action='claim',id=null,lease=null){
    const {data}=(await db.query('select public.toki_application_mail($1,$2,$3,$4) as data',[key,action,id,lease])).rows[0];
    return data;
  }
  assert.deepEqual(await notify('0'.repeat(64)),{message:'DENIED'});
  const message=await notify(workerKey);
  assert.equal(message.name,'Requested name');
  assert.equal(message.recipient,'test0@example.test');
  assert.equal(message.email,'test2@example.test');
  assert.equal(await notify(workerKey),null);
  assert.deepEqual(await notify(workerKey,'ack',message.id,users[0].id),{acknowledged:false});
  assert.deepEqual(await notify(workerKey,'ack',message.id,message.lease),{acknowledged:true});
  await signIn(0);
  assert.equal((await rpc('members')).members.find(m=>m.id===users[2].id).requestName,'Requested name');
  await assert.rejects(rpc('approve', {p_member:users[2].id}), /NAME_INVALID/);
  await rpc('approve', {p_member:users[2].id,p_name:'Applicant',p_payload:'["open"]'});
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

  await db.exec('reset role');
  await db.exec(fs.readFileSync('database/enable-invitations.sql','utf8'));
  await signIn(0);
  const issue=batch=>rpc('invite_batch',{p_payload:JSON.stringify(batch)});
  await assert.rejects(issue([{name:'New guest',groups:[]},{name:'New guest',groups:[]}]),/NAME_TAKEN/);
  assert.deepEqual((await rpc('members')).pinInvites,[]);
  const batch=await issue([{name:'New guest',groups:['open']},{name:'Cancelled guest',groups:['private']}]);
  const invites=(await rpc('members')).pinInvites;
  assert.equal(invites.length,2);
  assert.ok(invites.every(invite=>!Object.hasOwn(invite,'password')));
  assert.ok(batch.invitations.every(invite=>/^\d{6}$/.test(invite.password)));
  await assert.rejects(rpc('invite',{p_email:'other@example.test',p_name:'Other'}),/UPDATE_REQUIRED/);
  await rpc('cancel_pin_invite',{p_member:invites.find(invite=>invite.name==='Cancelled guest').id});
  await signIn(3);
  const redeem=index=>rpc('accept_invite',{p_code:org.code,p_payload:JSON.stringify(batch.invitations[index].password)});
  await assert.rejects(rpc('join',{p_code:org.code}),/UPDATE_REQUIRED/);
  await assert.rejects(redeem(1),/INVITE_INVALID/);
  await assert.rejects(issue([{name:'Unauthorized',groups:[]}]),/DENIED/);
  await redeem(0);
  const guest=await rpc('read');
  assert.deepEqual(guest.payload.people,['Existing','New guest']);
  assert.deepEqual(guest.payload.groups.map(group=>group.id),['open']);
  await signIn(4);
  await assert.rejects(redeem(0),/INVITE_INVALID/);
  await assert.rejects(rpc('read'),/DENIED/);

  await signIn(0);
  board = await rpc('read');
  board.payload.groups.find(group=>group.id==='open').members=[0,1];
  await save(board.version,board.payload);
  await signIn(3);
  const memberBoard = await rpc('read');
  const proposed = S.reserve(memberBoard.payload,'open',date,[{start:550,end:560}]);
  const meetingId = proposed.meetings[0].id;
  proposed.meetings[0].creatorName = 'Untrusted submitted name';
  const incorrectAvailability = S.editPerson(proposed,0,date,[{start:540,end:545}],[]);
  await assert.rejects(save(memberBoard.version,incorrectAvailability), /DENIED/);
  const wrongGroup = structuredClone(proposed);
  wrongGroup.meetings[0].group='private';
  await assert.rejects(save(memberBoard.version,wrongGroup), /DENIED/);
  const created = await save(memberBoard.version,proposed);
  assert.equal(created.payload.meetings[0].creatorName,'New guest');
  assert.deepEqual(created.payload.meetings[0].members,[0,1]);

  await signIn(0);
  board=await rpc('read');
  const hiddenBefore=board.payload.meetings.find(meeting=>meeting.group==='private');
  board.payload.groups.find(group=>group.id==='open').members=[];
  await save(board.version,board.payload);
  await signIn(2);
  const partiallyVisible=await rpc('read');
  assert.deepEqual(partiallyVisible.payload.people,['Applicant']);
  assert.deepEqual(partiallyVisible.payload.meetings,[{
    id:meetingId,group:'open',date,start:550,end:560,members:[],creatorName:'New guest',limitedParticipants:true
  }]);
  await assert.rejects(save(partiallyVisible.version,S.adjustMeeting(partiallyVisible.payload,meetingId,{start:575,end:610})), /SCHEDULE_BUSY/);
  const adjusted=await save(partiallyVisible.version,S.adjustMeeting(partiallyVisible.payload,meetingId,{start:570,end:590}));
  assert.equal(adjusted.payload.meetings[0].creatorName,'New guest');
  assert.deepEqual(adjusted.payload.meetings[0].members,[]);
  assert.deepEqual([adjusted.payload.meetings[0].start,adjusted.payload.meetings[0].end],[570,590]);
  const afterRelease=await save(adjusted.version,S.release(adjusted.payload,meetingId));
  assert.deepEqual(afterRelease.payload.meetings,[]);

  await signIn(0);
  const restored=(await rpc('read')).payload;
  assert.deepEqual(S.personRanges(restored,0,date),[{start:540,end:600}]);
  assert.deepEqual(S.personRanges(restored,1,date),[{start:540,end:600}]);
  assert.deepEqual(restored.meetings.find(meeting=>meeting.group==='private'),hiddenBefore);

  await t.test('manual rows, name requests and administrator reviews respect scope and mail delivery',async()=>{
    // Start a new simulated request window after the preceding fixture.
    await db.exec('reset role; delete from toki_private.request_limits');
    await signIn(3);
    const member=await rpc('read');
    await assert.rejects(rpc('add_person',{p_version:member.version,p_name:'Manual row',p_payload:{groups:['open']}}),/DENIED/);
    const request=(kind,id,name)=>rpc('rename_request',{p_name:name,p_payload:{kind,id}});
    await assert.rejects(request('person',adminRow,'Other account'),/DENIED/);
    await assert.rejects(request('group','private','Hidden group'),/DENIED/);
    const rename=await request('person',member.access.personId,'Requested display name');
    await assert.rejects(request('person',member.access.personId,'Second request'),/RENAME_PENDING/);
    await assert.rejects(rpc('rename_approve',{p_member:rename.id}),/DENIED/);
    assert.equal((await rpc('read')).payload.people[0],'New guest');
    assert.deepEqual((await rpc('review_list')).renames,[]);

    const mail=async(action,id,lease)=>{
      await db.exec('reset role; set role anon');
      return notify(workerKey,action,id,lease);
    };
    const ack=job=>mail('ack',job.id,job.lease);
    const renameMail=await mail('claim_v2');
    assert.equal(renameMail.kind,'rename');
    assert.equal(renameMail.recipient,'test0@example.test');
    assert.equal(renameMail.related,rename.id);
    assert.equal(renameMail.new_name,'Requested display name');
    await ack(renameMail);
    await signIn(0);
    assert.equal((await rpc('review_list')).renames[0].id,rename.id);
    await rpc('rename_approve',{p_member:rename.id});
    await assert.rejects(rpc('rename_approve',{p_member:rename.id}),/REVIEW_CLOSED/);
    const ready=await rpc('read');
    assert.ok(ready.payload.people.includes('Requested display name'));
    const manual=await rpc('add_person',{p_version:ready.version,p_name:'Manual row',p_payload:{groups:['open']}});
    const row=manual.board.payload.rows.findIndex(row=>row.id===manual.id);
    assert.equal(manual.board.payload.rows[row].kind,'person');
    assert.ok(manual.board.payload.groups[0].members.includes(row));
    assert.ok((await rpc('members')).members.every(member=>member.personId!==manual.id));

    const role=value=>rpc('role',{p_member:users[2].id,p_role:value});
    await role('admin');
    const promotion=await mail('claim_v2');
    assert.deepEqual([promotion.kind,promotion.recipient,promotion.label],['promotion','test0@example.test','Applicant']);
    await ack(promotion);
    await signIn(2);
    assert.ok((await rpc('review_list')).probationUntil);
    const before=await rpc('read');
    const groupChange={...before.payload,groups:before.payload.groups.map(g=>g.id==='open'?{...g,name:'Reviewed group'}:g)};
    const adminGuest=async names=>{
      const {data}=(await db.query("select public.toki_guest_admin('issue_batch',$1,null,null,$2) as data",[org.id,JSON.stringify(names.map(name=>({name,groups:['open']})))])).rows[0];
      assert.equal(data.message,undefined);return data;
    };
    assert.deepEqual(await save(before.version,groupChange),{queued:true});
    assert.deepEqual(await issue([{name:'Review passcode',groups:['open']}]),{queued:true});
    assert.deepEqual(await adminGuest(['Review guest']),{queued:true});
    assert.equal((await rpc('members')).pinInvites.length,0);
    assert.equal((await rpc('read')).payload.groups[0].name,'Open group');
    assert.equal(await mail('claim_v2'),null,'digest is due the next day');
    await mail('sweep');
    await db.exec('reset role');
    const {review,correctTime}=(await db.query(`select r.id as review, q.due_at=((r.day+1)+time '09:00') at time zone 'Asia/Tokyo' as "correctTime"
      from toki_private.company_admin_reviews r join toki_private.company_workflow_mail q on q.related=r.id where r.company_id=$1`,[org.id])).rows[0];
    assert.equal(correctTime,true);
    await signIn(0);
    assert.equal((await rpc('review_list')).reviews[0].canReject,false);
    await assert.rejects(rpc('review_reject',{p_member:review}),/REVIEW_CLOSED/);
    const makeMailDue=async()=>{
      await db.exec("reset role; update toki_private.company_workflow_mail set due_at=now()-interval '1 minute' where kind='review'");
    };
    await makeMailDue();
    const digest=await mail('claim_v2');
    assert.equal(digest.recipient,'test0@example.test');
    assert.equal(digest.label,'Applicant');
    assert.equal(digest.items.length,3);
    assert.ok(digest.items.some(item=>item.includes('Review guest')));
    await ack(digest);
    await signIn(2);
    await assert.rejects(rpc('review_reject',{p_member:review}),/REVIEW_CLOSED/);
    await signIn(0);
    assert.equal((await rpc('review_list')).reviews[0].canReject,true);
    await rpc('review_reject',{p_member:review});
    const rejected=(await rpc('review_list')).reviews[0];
    assert.equal(rejected.state,'rejected');
    assert.deepEqual(rejected.items.map(item=>item.state),['rejected','rejected','rejected']);
    assert.deepEqual((await rpc('read')).payload,before.payload);

    await db.exec('reset role');
    await db.query("update toki_private.company_admin_reviews set day=day-1 where id=$1",[review]);
    await signIn(2);
    assert.deepEqual(await save(before.version,groupChange),{queued:true});
    const anotherGroup={...before.payload,groups:[...before.payload.groups,{id:'another',name:'Another change',members:[row]}]};
    assert.deepEqual(await save(before.version,anotherGroup),{queued:true});
    assert.deepEqual(await issue([{name:'Delivered invitation',groups:['open']}]),{queued:true});
    const timing=await save(before.version,S.editPerson(before.payload,row,date,[],[{start:600,end:630}]));
    assert.notEqual(timing.version,before.version);
    assert.equal(timing.payload.groups[0].name,'Open group');
    await makeMailDue();
    const nextDigest=await mail('claim_v2');
    await mail('sweep');
    await signIn(0);
    assert.equal((await rpc('read')).payload.groups[0].name,'Open group');
    await ack(nextDigest);
    await db.exec('reset role');
    await db.query("update toki_private.company_admin_reviews set notified_at=now()-interval '25 hours' where id=$1",[nextDigest.related]);
    await mail('sweep');
    await signIn(0);
    const applied=await rpc('read');
    assert.equal(applied.payload.groups[0].name,'Reviewed group');
    assert.equal(applied.payload.groups.at(-1).name,'Another change');
    assert.deepEqual(S.personRanges(applied.payload,row,date),[{start:600,end:630}]);
    const report=(await rpc('review_list')).reviews.find(batch=>batch.id===nextDigest.related);
    assert.equal(report.state,'applied');
    assert.deepEqual(report.items.map(item=>item.state),['applied','applied','applied']);
    const ticket=report.items.find(item=>item.summary.includes('Delivered invitation')).id;
    await assert.rejects(rpc('review_result',{p_member:ticket}),/REVIEW_CLOSED/);
    await signIn(2);
    assert.match((await rpc('review_result',{p_member:ticket})).invitations[0].password,/^\d{6}$/);
    await assert.rejects(rpc('review_result',{p_member:ticket}),/REVIEW_CLOSED/);

    await signIn(0);
    await role('member');
    const demotion=await mail('claim_v2');
    assert.deepEqual([demotion.kind,demotion.recipient],['demotion','test2@example.test']);
    await ack(demotion);
    await signIn(0);
    await assert.rejects(rpc('review_recover',{p_member:demotion.related}),/REVIEW_CLOSED/);
    await signIn(2);
    assert.equal((await rpc('read')).access.role,'member');
    assert.equal((await rpc('review_list')).recovery.id,demotion.related);
    await rpc('review_acknowledge',{p_member:demotion.related});
    assert.equal((await rpc('review_list')).recovery.acknowledged,true);
    await rpc('review_recover',{p_member:demotion.related});
    assert.equal((await rpc('read')).access.role,'admin');
    await signIn(0);
    await role('member');
    const expired=(await mail('claim_v2')).related;
    await db.exec('reset role');
    await db.query("update toki_private.company_admin_recovery set demoted_at=now()-interval '8 days' where id=$1",[expired]);
    await signIn(2);
    await assert.rejects(rpc('review_recover',{p_member:expired}),/REVIEW_CLOSED/);
  });
});

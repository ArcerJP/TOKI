const test=require('node:test'),assert=require('node:assert/strict'),S=require('../schedule.js'),M=require('../model.js');
const date='2026-10-15',r=(start,end)=>({start,end});let serial=0;const id=()=>`new-${++serial}`;
const base=()=>({schemaVersion:4,people:['A','B','C'],groups:[{id:'g',name:'企画局',members:[0,1,2]},{id:'h',name:'別グループ',members:[0,1]}],events:[{id:'a',person:0,date,...r(540,1080)},{id:'b',person:1,date,...r(600,1020)},{id:'c',person:2,date,...r(720,960)}],meetings:[]});
test('groups show the exact intersection and local exclusions do not alter stored memberships',()=>{
  const b=base();assert.deepEqual(S.ranges(b,'g:g',date),[r(720,960)]);assert.deepEqual(S.ranges(b,'g:g',date,['C']),[r(600,1020)]);
  assert.deepEqual(S.ranges(b,'g:g',date,['A','B','C']),[]);assert.deepEqual(b.groups[0].members,[0,1,2]);
});
test('converting a common segment to MTG edits only selected people, and updates other groups',()=>{
  const b=base(),next=S.reserve(b,'g',date,[r(600,660)],['C'],id);
  assert.deepEqual(next.meetings[0].members,[0,1]);assert.deepEqual(S.personRanges(next,0,date),[r(540,600),r(660,1080)]);
  assert.deepEqual(S.personRanges(next,2,date),[r(720,960)]);assert.deepEqual(S.ranges(next,'g:h',date),[r(660,1020)]);
  assert.equal(b.meetings.length,0);assert.throws(()=>S.reserve(b,'g',date,[r(600,660)],[],id),/共通/);
});
test('removing one MTG participant restores only that person, and preserves the original participant set on roster edits',()=>{
  let b=S.reserve(base(),'g',date,[r(720,780)],[],id),meeting=b.meetings[0].id;
  b=M.setGroup(b,'g','企画局',[1,2]);assert.deepEqual(b.meetings[0].members,[0,1,2]);
  b=S.release(b,meeting,{person:0},id);assert.deepEqual(b.meetings[0].members,[1,2]);assert.deepEqual(S.personRanges(b,0,date),[r(540,1080)]);
  assert.deepEqual(S.personRanges(b,1,date),[r(600,720),r(780,1020)]);
  b=S.release(b,meeting,{},id);assert.equal(b.meetings.length,0);assert.deepEqual(S.personRanges(b,1,date),[r(600,1020)]);
});
test('shortening MTG restores only the released edges, and a zero length releases the remainder',()=>{
  let b=S.reserve(base(),'g',date,[r(720,840)],[],id),meeting=b.meetings[0].id;
  b=S.release(b,meeting,{start:750,end:810},id);assert.deepEqual(S.personRanges(b,2,date),[r(720,750),r(810,960)]);
  assert.throws(()=>S.release(b,meeting,{start:720,end:810},id),/短縮/);
  b=S.release(b,meeting,{start:810,end:810},id);assert.equal(b.meetings.length,0);assert.deepEqual(S.personRanges(b,2,date),[r(720,960)]);
});
test('personal edits cannot make a meeting available or alter another person',()=>{
  const b=S.reserve(base(),'g',date,[r(720,780)],[],id),next=S.editPerson(b,0,date,[],[r(660,840)],id);
  assert.deepEqual(S.personRanges(next,0,date),[r(540,720),r(780,1080)]);assert.deepEqual(next.meetings,b.meetings);
  const deleted=S.editPerson(next,0,date,[r(540,720)],[],id);assert.deepEqual(S.personRanges(deleted,0,date),[r(780,1080)]);
});
test('people reordering and deletion retain correct MTG participant identities',()=>{
  const b=S.reserve(base(),'g',date,[r(720,780)],[],id),moved=M.reorderPeople(b,2,0);
  assert.deepEqual(moved.meetings[0].members.map(p=>moved.people[p]),['A','B','C']);
  const removed=M.removePerson(moved,1);assert.deepEqual(removed.meetings[0].members.map(p=>removed.people[p]),['B','C']);assert.ok(M.valid(removed));
});
test('deleting a group restores its meetings, and preserves other groups and their meetings',()=>{
  let b=S.reserve(base(),'g',date,[r(720,780)],[],id);b=S.reserve(b,'h',date,[r(840,900)],[],id);
  b=S.removeGroup(b,'g',id);assert.deepEqual(b.groups.map(g=>g.id),['h']);assert.deepEqual(b.meetings.map(m=>m.group),['h']);
  assert.deepEqual(S.personRanges(b,0,date),[r(540,840),r(900,1080)]);assert.deepEqual(S.personRanges(b,2,date),[r(720,960)]);
});
test('migration removes titles and independent group slots without changing any personal intervals',()=>{
  const b=base();b.schemaVersion=3;delete b.meetings;b.events=b.events.map(e=>({...e,title:'Old',detail:'Private memo'}));b.events.push({id:'old-group',group:'g',date,start:540,end:600,title:'Old group',detail:''});
  const next=S.migrate(b);assert.deepEqual(next,base());assert.deepEqual(S.migrate(next),next);assert.equal(b.events.length,4);
});
test('copy text includes no-time days and merges adjacent or overlapping registrations',()=>{
  assert.equal(S.exportText(base(),'g:g',date,'2026-10-16'),'10月15日(木)：12:00～16:00\n10月16日(金)：なし');
  assert.equal(S.exportText(base(),'g:g',date,date,['C']),'10月15日(木)：10:00～17:00');
  assert.throws(()=>S.exportText(base(),'p:0','2026-10-16',date),/開始日/);
});
test('schema rejects stale MTG references and editable titles in availability records',()=>{
  const b=base();b.events[0].title='title';assert.equal(M.valid(b),false);delete b.events[0].title;
  b.meetings=[{id:'mtg',group:'missing',date,start:600,end:660,members:[0]}];assert.equal(M.valid(b),false);
  b.meetings[0].group='g';b.meetings[0].members=[0,99];assert.equal(M.valid(b),false);
});

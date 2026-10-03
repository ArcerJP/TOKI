const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../schedule.js'),M=require('../model.js');
function fixture(){return {schemaVersion:4,people:['ふうか','れいな','ゆうと'],groups:[{id:'plan',name:'企画局',members:[0,1,2]},{id:'sound',name:'音響局',members:[2]},{id:'empty',name:'予定なし局',members:[0]}],events:[],meetings:[
  {id:'later',group:'plan',date:'2026-10-06',start:660,end:720,members:[0,2]},
  {id:'sound',group:'sound',date:'2026-10-05',start:600,end:660,members:[2]},
  {id:'adjacent',group:'plan',date:'2026-10-05',start:600,end:650,members:[0,1]},
  {id:'first',group:'plan',date:'2026-10-05',start:540,end:600,members:[0,1]}
]};}
test('bulk MTG export sorts by date and start time, uses exact requested format and keeps adjacent MTGs separate',()=>{
  const b=fixture(),before=structuredClone(b);assert.ok(M.valid(b));
  assert.equal(S.exportMeetings(b,['sound','empty','plan'],'2026-10-04','2026-10-07'),[
    '企画局（ふうか、れいな）：10月5日(月)：09:00～10:00',
    '企画局（ふうか、れいな）：10月5日(月)：10:00～10:50',
    '音響局（ゆうと）：10月5日(月)：10:00～11:00',
    '企画局（ふうか、ゆうと）：10月6日(火)：11:00～12:00'
  ].join('\n'));assert.deepEqual(b,before);
});
test('group filters and inclusive date bounds omit other groups, dates and empty days',()=>{
  const b=fixture();
  assert.equal(S.exportMeetings(b,['plan'],'2026-10-06','2026-10-06'),'企画局（ふうか、ゆうと）：10月6日(火)：11:00～12:00');
  assert.equal(S.exportMeetings(b,['sound'],'2026-10-05','2026-10-06'),'音響局（ゆうと）：10月5日(月)：10:00～11:00');
  assert.equal(S.exportMeetings(b,['empty'],'2026-10-05','2026-10-06'),'');
  assert.equal(S.exportMeetings(b,['plan','sound'],'2026-10-07','2026-10-08'),'');
});
test('export uses actual MTG participants after roster edits, member release and person renaming',()=>{
  let b=M.setGroup(fixture(),'plan','企画局',[2]);
  b=S.release(b,'first',{person:1});b.people[0]='ふうか改';
  const lines=S.exportMeetings(b,['plan'],'2026-10-05','2026-10-05').split('\n');
  assert.equal(lines[0],'企画局（ふうか改）：10月5日(月)：09:00～10:00');
  assert.equal(lines[1],'企画局（ふうか改、れいな）：10月5日(月)：10:00～10:50');
});
test('empty group selection and invalid periods report actionable errors',()=>{
  const b=fixture();
  assert.throws(()=>S.exportMeetings(b,[],'2026-10-05','2026-10-05'),/グループを選択/);
  assert.throws(()=>S.exportMeetings(b,['missing'],'2026-10-05','2026-10-05'),/開き直して/);
  for(const [first,last] of [['','2026-10-05'],['2026-02-30','2026-03-01'],['2026-10-06','2026-10-05']])assert.throws(()=>S.exportMeetings(b,['plan'],first,last),/開始日/);
  assert.doesNotThrow(()=>S.exportMeetings(b,['plan'],'2026-01-01','2027-01-01'));
  assert.throws(()=>S.exportMeetings(b,['plan'],'2026-01-01','2027-01-02'),/366日/);
});

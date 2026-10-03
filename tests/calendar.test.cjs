const test=require('node:test'),assert=require('node:assert/strict'),M=require('../model.js');
test('week picker lists Sunday through Saturday including dates outside the original six days',()=>{
  assert.deepEqual(M.weekDates('2026-10-05'),['2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10']);
  assert.deepEqual(M.weekDates('2026-10-03'),['2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03']);
});
test('daily navigation crosses Sunday boundaries and weekly navigation preserves weekday',()=>{
  const next=M.shiftDate('2026-10-03',1);assert.equal(next,'2026-10-04');assert.equal(M.weekDates(next)[0],next);
  assert.equal(M.shiftDate(next,-1),'2026-10-03');assert.equal(M.shiftDate('2026-10-05',7),'2026-10-12');assert.equal(M.shiftDate('2026-10-12',-7),'2026-10-05');
});
test('calendar handles year changes, leap days and DST using date-only UTC arithmetic',()=>{
  assert.deepEqual(M.weekDates('2027-01-01'),['2026-12-27','2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02']);
  assert.equal(M.shiftDate('2028-02-28',1),'2028-02-29');assert.equal(M.shiftDate('2028-02-29',1),'2028-03-01');assert.equal(M.shiftDate('2026-03-08',1),'2026-03-09');assert.equal(M.shiftDate('2026-11-01',1),'2026-11-02');
});
test('invalid dates and navigation past complete-week calendar bounds are rejected',()=>{
  for(const date of ['2026-02-29','2026-02-30','2026-13-01','2026-10-00','2026-1-1','0000-12-01','not-a-date',null])assert.equal(M.validDate(date),false,date);
  assert.equal(M.shiftDate(M.MIN_DATE,-1),null);assert.equal(M.shiftDate(M.MAX_DATE,1),null);assert.equal(M.weekDates(M.MIN_DATE).length,7);assert.equal(M.weekDates(M.MAX_DATE).at(-1),M.MAX_DATE);
});
test('migration preserves all people, memberships and exact schedules across dates',()=>{
  const old={schemaVersion:2,dates:['2026-10-03'],people:['A'],groups:[{id:'g',name:'G',members:[0]}],events:[{id:'e',person:0,date:'2026-10-03',start:540,end:770,title:'参加可能',detail:''}]};
  const b=M.upgrade(old);assert.equal(b.schemaVersion,3);assert.equal('dates' in b,false);assert.deepEqual(b.events,old.events);assert.deepEqual(b.people,old.people);assert.deepEqual(b.groups,old.groups);assert.ok(M.valid(b));
  const next=M.clone(b);next.events.push({...b.events[0],id:'new',date:'2027-01-04'});assert.ok(M.valid(next));assert.deepEqual(next.events[0],old.events[0]);next.events[1].date='2027-02-29';assert.equal(M.valid(next),false);
});

const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../src/core/mobile-model.js'),S=require('../src/core/schedule.js'),M=require('../src/core/model.js');
const date='2026-10-05';
const seed=()=>({schemaVersion:4,people:['A','B','C','D'],groups:[{id:'a',name:'局A',members:[0,1]},{id:'b',name:'局B',members:[1,2]}],events:[0,1,2].map(person=>({id:'e'+person,person,date,start:540,end:1080})),meetings:[]});
test('hiding a group only removes its display rows, preserves multiple memberships and unassigned people',()=>{
  const board=seed(),before=JSON.stringify(board);
  assert.deepEqual(H.rows(board,['a']).map(r=>r.key),['g:b','p:1','p:2','p:3']);
  assert.deepEqual(H.rows(board,['a'],new Set(['b'])).map(r=>r.key),['g:b','p:3']);
  assert.equal(JSON.stringify(board),before);
  assert.equal(S.exportText(board,'g:a',date,date),'10月5日(月)：09:00～18:00');
});
test('person time editing retains precise minutes and other people, with zero length deletion',()=>{
  const board=seed();board.events[0].end=770;
  const op={person:0,date,from:{start:540,end:770},to:{start:570,end:770}};
  const next=H.applyMonthEdit(board,op);assert.deepEqual(S.personRanges(next,0,date),[{start:570,end:770}]);
  assert.deepEqual(S.personRanges(next,1,date),[{start:540,end:1080}]);
  assert.deepEqual(S.personRanges(H.applyMonthEdit(board,{...op,to:{start:770,end:770}}),0,date),[]);
  assert.throws(()=>H.applyMonthEdit(board,{...op,to:{start:470,end:600}}));
});
test('monthly cross-date copying preserves the original band and refuses a destination MTG',()=>{
  const after=M.shiftDate(date,1),from={start:540,end:675},board=seed();
  board.events[0].end=from.end;
  board.meetings.push({id:'next-meeting',group:'a',date:after,start:690,end:750,members:[0,1]});
  const before=structuredClone(board);
  const op={person:0,date,targetDate:after,from,to:{start:600,end:735}};
  assert.throws(()=>H.applyMonthEdit(board,op),/登録済みのMTG/);
  assert.deepEqual(board,before);
  const copied=H.applyMonthEdit(board,{...op,to:{start:480,end:615}});
  assert.deepEqual(S.personRanges(copied,0,date),[from]);
  assert.deepEqual(S.personRanges(copied,0,after),[{start:480,end:615}]);
});

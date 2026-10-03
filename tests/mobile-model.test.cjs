const test=require('node:test'),assert=require('node:assert/strict');
const H=require('../mobile-model.js'),S=require('../schedule.js'),M=require('../model.js');
const date='2026-10-05';
const seed=()=>({schemaVersion:4,people:['A','B','C','D'],groups:[{id:'a',name:'局A',members:[0,1]},{id:'b',name:'局B',members:[1,2]}],events:[0,1,2].map(person=>({id:'e'+person,person,date,start:540,end:1080})),meetings:[]});
test('hiding a group only removes its display rows, preserves multiple memberships and unassigned people',()=>{
  const board=seed(),before=JSON.stringify(board);
  assert.deepEqual(H.rows(board,['a']).map(r=>r.key),['g:b','p:1','p:2','p:3']);
  assert.deepEqual(H.rows(board,['a'],new Set(['b'])).map(r=>r.key),['g:b','p:3']);
  assert.equal(JSON.stringify(board),before);
  assert.equal(S.exportText(board,'g:a',date,date),'10月5日(月)：09:00～18:00');
});
test('mobile MTG creation respects exclusions and rejects any unavailable part without changing the board',()=>{
  const board=seed(),before=JSON.stringify(board),op={kind:'reserve',date,group:'a',excluded:['B'],to:{start:600,end:660}};
  const result=H.apply(board,op);assert.deepEqual(result.meetings[0].members,[0]);
  assert.deepEqual(S.personRanges(result,1,date),[{start:540,end:1080}]);
  assert.throws(()=>H.apply(board,{...op,to:{start:510,end:600}}),/可能時間がありません/);
  assert.equal(JSON.stringify(board),before);
});
test('shortening common time reserves only the removed difference; zero reserves the entire interval',()=>{
  const board=seed(),op={kind:'common',date,group:'a',excluded:[],from:{start:540,end:1080},to:{start:600,end:1050}};
  assert.deepEqual(H.apply(board,op).meetings.map(({start,end})=>({start,end})),[{start:540,end:600},{start:1050,end:1080}]);
  assert.deepEqual(H.apply(board,{...op,to:{start:540,end:540}}).meetings.map(({start,end})=>({start,end})),[{start:540,end:1080}]);
  assert.throws(()=>H.apply(board,{...op,to:{start:510,end:1080}}),/短縮のみ/);
});
test('person time editing retains precise minutes and other people, with zero length deletion',()=>{
  const board=seed();board.events[0].end=770;
  const op={kind:'person',person:0,date,from:{start:540,end:770},to:{start:570,end:770}};
  const next=H.apply(board,op);assert.deepEqual(S.personRanges(next,0,date),[{start:570,end:770}]);
  assert.deepEqual(S.personRanges(next,1,date),[{start:540,end:1080}]);
  assert.deepEqual(S.personRanges(H.apply(board,{...op,to:{start:770,end:770}}),0,date),[]);
  assert.throws(()=>H.apply(board,{...op,to:{start:470,end:600}}));
});
test('mobile MTG adjustment uses fixed participants even after current membership and exclusions change',()=>{
  let board=S.reserve(seed(),'a',date,[{start:600,end:660}]);const id=board.meetings[0].id;
  board=M.setGroup(board,'a','局A',[2]);
  const op={kind:'meeting',id,date,excluded:['A','B'],to:{start:570,end:690}};
  const next=H.apply(board,op);assert.deepEqual(next.meetings[0].members,[0,1]);
  for(const p of [0,1])assert.deepEqual(S.personRanges(next,p,date),[{start:540,end:570},{start:690,end:1080}]);
  assert.deepEqual(S.personRanges(next,2,date),[{start:540,end:1080}]);
});
test('moving MTG restores the old interval, reserves the new one and refuses conflicting participants atomically',()=>{
  let board=S.reserve(seed(),'a',date,[{start:600,end:660}]);const id=board.meetings[0].id;
  board=S.editPerson(board,1,date,[{start:900,end:930}],[]);const before=JSON.stringify(board);
  const op={kind:'meeting',id,date,to:{start:720,end:780}};const next=H.apply(board,op);
  assert.deepEqual(S.personRanges(next,0,date),[{start:540,end:720},{start:780,end:1080}]);
  assert.throws(()=>H.apply(board,{...op,to:{start:870,end:930}}),/可能時間がありません/);
  assert.equal(JSON.stringify(board),before);
});
test('individual release changes only that person and all-person release restores everyone',()=>{
  const board=S.reserve(seed(),'a',date,[{start:600,end:660}]),id=board.meetings[0].id;
  const one=H.apply(board,{kind:'release',id,person:0,date});assert.deepEqual(one.meetings[0].members,[1]);
  assert.deepEqual(S.personRanges(one,0,date),[{start:540,end:1080}]);
  const all=H.apply(board,{kind:'meeting',id,date,to:{start:600,end:600}});assert.equal(all.meetings.length,0);
  for(const p of [0,1])assert.deepEqual(S.personRanges(all,p,date),[{start:540,end:1080}]);
});
test('adding availability never overrides MTG; moving preserves exact duration',()=>{
  const board=S.reserve(seed(),'a',date,[{start:600,end:660}]);
  const next=H.apply(board,{kind:'person',person:0,date,to:{start:480,end:720}});
  assert.deepEqual(S.personRanges(next,0,date),[{start:480,end:600},{start:660,end:1080}]);
  assert.deepEqual(H.move({start:630,end:770},'move',640,671),{start:660,end:800});
});
test('explicit transfer moves only the selected interval to the chosen person and still protects their MTG',()=>{
  const board=S.reserve(seed(),'b',date,[{start:600,end:660}]);
  const next=H.apply(board,{kind:'person',person:0,target:2,date,from:{start:540,end:1080},to:{start:570,end:1110}});
  assert.deepEqual(S.personRanges(next,0,date),[]);
  assert.deepEqual(S.personRanges(next,2,date),[{start:540,end:600},{start:660,end:1110}]);
  assert.deepEqual(next.meetings,board.meetings);
  assert.deepEqual(S.personRanges(next,1,date),S.personRanges(board,1,date));
});

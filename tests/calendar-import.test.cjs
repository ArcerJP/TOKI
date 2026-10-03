const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};for(const file of ['model.js','calendar-import.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window});
const C=window.TokiCalendarImport;
const period=(start='2026-10-03T08:00',end='2026-10-04T00:00')=>C.period(start,end);
const busy=(start,end)=>({start:Date.parse(start),end:Date.parse(end)});
const own=value=>structuredClone(value);
test('11:10–11:50 excludes both half-hour slots from 11:00–12:00',()=>{
  const ranges=C.availability(period(),[busy('2026-10-03T11:10:00+09:00','2026-10-03T11:50:00+09:00')]);
  assert.deepEqual(own(ranges),[{date:'2026-10-03',start:480,end:660},{date:'2026-10-03',start:720,end:1440}]);
});
test('exclusive busy ends and exact half-hour boundaries do not block adjacent slots',()=>{
  const ranges=C.availability(period('2026-10-03T10:00','2026-10-03T12:00'),[busy('2026-10-03T10:30:00+09:00','2026-10-03T11:00:00+09:00')]);
  assert.deepEqual(own(ranges),[{date:'2026-10-03',start:600,end:630},{date:'2026-10-03',start:660,end:720}]);
});
test('even a one-second overlap blocks a whole slot',()=>{
  const ranges=C.availability(period('2026-10-03T10:00','2026-10-03T11:00'),[busy('2026-10-03T10:29:59+09:00','2026-10-03T10:30:01+09:00')]);
  assert.equal(ranges.length,0);
});
test('query bounds round inward and never assume unqueried time is available',()=>{
  assert.deepEqual(own(C.availability(period('2026-10-03T10:10','2026-10-03T12:50'),[])),[{date:'2026-10-03',start:630,end:750}]);
  assert.equal(C.availability(period('2026-10-03T10:10','2026-10-03T10:20'),[]).length,0);
});
test('UTC results, overlapping intervals and overnight busy periods use Japan time',()=>{
  const range=period('2026-10-03T23:00','2026-10-04T10:00');
  const blocks=[busy('2026-10-04T08:00:00+09:00','2026-10-04T09:10:00+09:00'),busy('2026-10-03T14:10:00Z','2026-10-04T00:00:00Z')];
  assert.deepEqual(own(C.availability(range,blocks)),[{date:'2026-10-04',start:570,end:600}]);
});
test('all-day busy blocks remove availability and do not affect the next day',()=>{
  const range=period('2026-10-03T00:00','2026-10-05T00:00');
  assert.deepEqual(own(C.availability(range,[busy('2026-10-03T00:00:00+09:00','2026-10-04T00:00:00+09:00')])),[{date:'2026-10-04',start:480,end:1440}]);
});
test('invalid dates, empty/reversed periods and overly long requests are rejected',()=>{
  for(const [a,b] of [['2026-02-30T08:00','2026-03-02T08:00'],['2026-10-03T08:00','2026-10-03T08:00'],['2026-10-04T08:00','2026-10-03T08:00'],['2026-01-01T00:00','2028-01-01T00:00']])assert.throws(()=>period(a,b));
});
test('FreeBusy response errors and incomplete data never imply all-day availability',()=>{
  const range=period(),response={timeMin:range.start,timeMax:range.end,calendars:{primary:{busy:[]}}};
  assert.equal(C.readBusy(response,range).length,0);
  assert.equal(C.readBusy({...response,calendars:{'resolved-primary-id':{busy:[]}}},range).length,0);
  for(const value of [{...response,calendars:{}},{...response,calendars:{primary:{busy:[],errors:[{reason:'notFound'}]}}},{...response,calendars:{primary:{}}},{...response,timeMax:range.start},{...response,calendars:{primary:{busy:[{start:'bad',end:'bad'}]}}}])assert.throws(()=>C.readBusy(value,range));
});
const event=(id,person,start,end,date='2026-10-03')=>({id,person,date,start,end,title:'元の予定',detail:'保持する詳細'});
function board(){return {schemaVersion:3,people:['A','B'],groups:[{id:'g',name:'グループ',members:[0]}],events:[event('target',0,540,840),event('other',1,540,840),{id:'group',group:'g',date:'2026-10-03',start:600,end:900,title:'グループ予定',detail:''},event('outside',0,540,600,'2026-10-04')]};}
test('replacement splits boundary events and preserves other people, groups and dates',()=>{
  const original=board();let serial=0;
  const result=C.plan(original,0,period('2026-10-03T10:10','2026-10-03T12:50'),[],()=>`new-${++serial}`);
  assert.equal(result.affected,1);assert.equal(original.events.length,4);
  assert.deepEqual(own(result.board.events.filter(e=>['other','group','outside'].includes(e.id))),original.events.slice(1));
  const ownEvents=result.board.events.filter(e=>e.person===0&&e.date==='2026-10-03');
  assert.deepEqual(own(ownEvents.map(e=>[e.start,e.end])),[[540,610],[770,840],[630,750]]);
  assert.equal(ownEvents[0].detail,'保持する詳細');assert.equal(ownEvents[1].detail,'保持する詳細');
  assert.equal(ownEvents[2].title,'参加可能');assert.equal(ownEvents[2].detail,'');assert.ok(window.TokiModel.valid(result.board));
});
test('fully busy import removes only the chosen period and supports an empty preview',()=>{
  const result=C.plan(board(),0,period(),[busy('2026-10-03T00:00:00+09:00','2026-10-04T00:00:00+09:00')],()=> 'unused');
  assert.equal(result.ranges.length,0);assert.equal(result.affected,1);assert.equal(result.board.events.length,3);
});
test('reimport replaces previous generated ranges instead of accumulating duplicates',()=>{
  let serial=0;const id=()=>`new-${++serial}`,range=period();
  const first=C.plan(board(),0,range,[],id),second=C.plan(first.board,0,range,[],id);
  assert.equal(second.board.events.length,first.board.events.length);assert.equal(second.ranges.length,1);
});
test('import refuses to exceed the shared board event limit',()=>{
  const original=board();original.events=Array.from({length:2000},(_,i)=>event(`existing-${i}`,1,540,600));
  assert.throws(()=>C.plan(original,0,period(),[],()=> 'extra'),/2000/);
});

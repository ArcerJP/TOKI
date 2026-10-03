const test=require('node:test'),assert=require('node:assert/strict'),A=require('../availability.js');
const r=(start,end)=>({start,end});
test('common availability accounts for overlapping registrations and precise minute boundaries',()=>{
  const people=[[r(540,620),r(600,780),r(900,1440)],[r(570,750),r(930,1380)],[r(610,720),r(750,960),r(1020,1400)]];
  assert.deepEqual(A.common(people),[r(610,720),r(930,960),r(1020,1380)]);
  assert.deepEqual(A.common([people[0],people[1],[]]),[]);
  assert.deepEqual(A.common([]),[]);
  assert.deepEqual(A.intersect([r(540,600)],[r(600,660)]),[]);
});
test('subtracting meetings retains both sides and handles overlapping meeting ranges',()=>{
  assert.deepEqual(A.subtract([r(540,1320)],[r(600,660),r(650,720),r(900,930)]),[r(540,600),r(720,900),r(930,1320)]);
  assert.deepEqual(A.subtract([r(540,600),r(630,660)],[r(480,1440)]),[]);
  assert.deepEqual(A.subtract([r(540,600),r(660,720)],[r(570,690)]),[r(540,570),r(690,720)]);
});
test('text matches requested Japanese date, weekday, separators and merges duplicate time ranges',()=>{
  assert.equal(A.formatDay('2026-10-15',[r(900,1320),r(720,750),r(740,780)]),'10月15日(木)：12:00～13:00, 15:00～22:00');
  assert.equal(A.formatDay('2026-10-03',[r(1380,1440)]),'10月3日(土)：23:00～24:00');
  assert.throws(()=>A.formatDay('2026-02-30',[]),/日付/);
});
test('interval operations preserve their inputs and match a minute-by-minute reference',()=>{
  let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
  const sample=()=>Array.from({length:6},()=>{const start=480+random()%959;return r(start,start+1+random()%(1440-start));});
  const contains=(ranges,m)=>ranges.some(x=>x.start<=m&&m<x.end);
  for(let iteration=0;iteration<40;iteration++){
    const a=sample(),b=sample(),before=JSON.stringify([a,b]),both=A.intersect(a,b),remainder=A.subtract(a,b);
    for(let m=480;m<1440;m++){
      assert.equal(contains(both,m),contains(a,m)&&contains(b,m));
      assert.equal(contains(remainder,m),contains(a,m)&&!contains(b,m));
    }
    assert.equal(JSON.stringify([a,b]),before);
  }
});

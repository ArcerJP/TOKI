const {sourcePath}=require('../scripts/pwa-assets.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const S=require('../src/core/schedule.js');
const date='2026-10-05';
const seed=()=>S.reserve({schemaVersion:4,people:['A','B','C','D'],groups:[{id:'a',name:'局A',members:[0,1]},{id:'b',name:'局B',members:[1,2]}],events:[0,1,2].map(person=>({id:'e'+person,person,date,start:540,end:1080})),meetings:[]},'a',date,[{start:780,end:840}]);
const flush=()=>new Promise(resolve=>setTimeout(resolve,40));
async function environment(t,{width=390,coarse=false,shared=false,preselect=true,groupId='a',scoped=false,guest=false,launchDate=date,blockedDates=[],entry=false,legacyFolded}={}){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync(sourcePath('index.html'),'utf8'),{url:'https://example.test/TOKI/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window,d=w.document,media=[];let board=seed(),version=1,hooks,online=true,saves=0,failSave=false;
  w.Date=class extends w.Date {constructor(...args){super(...(args.length?args:[launchDate+'T12:00:00']));}};
  const access=scoped?{role:guest?'guest':'member',personId:'00000000-0000-4000-8000-000000000001'}:undefined;
  if(scoped)board.rows=board.people.map((_,i)=>({id:'00000000-0000-4000-8000-00000000000'+(i+1),kind:i===1?'place':'person'}));
  board.groups[0].id=groupId;board.meetings.filter(m=>m.group==='a').forEach(m=>m.group=groupId);
  w.scrollTo=()=>{};w.confirm=()=>{throw Error('Unexpected browser confirmation');};
  w.matchMedia=query=>{const entry={media:query,matches:false,listeners:[],addEventListener(type,fn){this.listeners.push(fn);}};media.push(entry);entry.matches=query.includes('767')?width<=767:width<=1023&&coarse;return entry;};
  w.HTMLElement.prototype.setPointerCapture=()=>{};
  // jsdom 26 has no PointerEvent handler properties; route them to its EventTarget.
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])Object.defineProperty(w.HTMLElement.prototype,'on'+type,{configurable:true,set(value){if(this['_'+type])this.removeEventListener(type,this['_'+type]);this['_'+type]=value;this.addEventListener(type,value);},get(){return this['_'+type];}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  const copies=[];Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>copies.push(text)}});
  w.TOKI_CONFIG={boardId:'test-board'};w.TOKI_DATA={people:[],dates:[date],availability:[]};w.TOKI_DATA_READY=Promise.resolve();
  w.localStorage.setItem('toki-selected-date','2026-10-11');w.localStorage.setItem('toki-availability-v3',JSON.stringify({version:3,board}));
  if(preselect)w.localStorage.setItem('toki-view-v1:'+(shared?'shared':'local')+':groups',JSON.stringify({version:1,selected:[groupId,'b','@unassigned']}));
  if(legacyFolded)w.localStorage.setItem('toki-view-v1:'+(shared?'shared':'local')+':toki-mobile-folded',JSON.stringify(legacyFolded));
  w.TokiShared={enabled:shared,guest,get online(){return online;},shareUrl:()=>'',initialize:async h=>{hooks=h;h.board({version,payload:board,access});},save:async next=>{
    if(failSave)throw Error('試験：保存失敗');
    if(next.events.some(event=>event.person===0&&blockedDates.includes(event.date)))throw Object.assign(Error('登録済みのMTGと重なります。'),{code:'SCHEDULE_BUSY'});
    saves++;board=structuredClone(next);return {version:++version,payload:board,access};
  },refresh:async()=>{}};
  for(const name of ['model','availability','schedule','availability-ui','meeting-menu','meeting-export-ui','row-drag','calendar-import','google-calendar','google-import-ui','mobile-model','mobile-month','mobile-ui','group-view','company-ui','app'])w.eval(fs.readFileSync(sourcePath(name+'.js'),'utf8'));
  await flush();await flush();
  if(!entry)w.document.querySelector('.mob-nav [aria-label="予定"]')?.click();
  t.after(()=>{dom.window.close();assert.deepEqual(errors.map(e=>e.message),[]);});
  const $=id=>d.getElementById(id),current=()=>shared?board:JSON.parse(w.localStorage.getItem('toki-availability-v3')).board;
  const scope=()=>d.querySelector('dialog[open]')||$('mobile-app');
  const button=(label,container=scope())=>{const b=[...container.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert.ok(b,`button: ${label}; gate=${$('auth-message').textContent}; root=${$('mobile-app').textContent.slice(0,120)}`);return b;};
  async function click(label,container){button(label,container).click();await flush();}
  async function select(label,value){const s=[...scope().querySelectorAll('select')].find(e=>e.getAttribute('aria-label')===label);assert.ok(s);s.value=value;s.dispatchEvent(new w.Event('change'));await flush();}
  function pointer(type,minute,id=1,extra={}){const track=d.querySelector('.mob-editor-track'),e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientY:(minute-480)*1.6,clientX:160});Object.assign(e,{pointerId:id,isPrimary:true,...extra});track.dispatchEvent(e);}
  return {w,d,$,click,button,select,pointer,copies,current,get saves(){return saves;},get error(){return d.querySelector('.mob-error')?.textContent;},async resetAccount(){hooks.reset();await flush();},async switchScope(scope){hooks.reset();w.TokiShared.scope=scope;hooks.board({version,payload:board});await flush();},async resize(newWidth,newCoarse=coarse){width=newWidth;coarse=newCoarse;media.forEach(entry=>{entry.matches=entry.media.includes('767')?width<=767:width<=1023&&coarse;entry.listeners.forEach(fn=>fn());});await flush();},async offline(value=true){online=!value;hooks.state({online,fetchedAt:Date.now()});await flush();},async remoteUpdate(){board=structuredClone(board);board.people[0]='A更新';hooks.board({version:++version,payload:board});await flush();},async localUpdate(){const value=structuredClone(current());value.people[0]='A更新';const text=JSON.stringify({version:3,board:value});w.localStorage.setItem('toki-availability-v3',text);w.dispatchEvent(new w.StorageEvent('storage',{key:'toki-availability-v3',newValue:text}));await flush();},fail(){failSave=true;}};
}

test('guest starts with granted groups visible and cannot edit a shared place',async t=>{
  const e=await environment(t,{shared:true,scoped:true,guest:true,preselect:false});
  assert.equal(e.$('group-view-dialog').open,false);
  assert.equal(e.$('copy-link').hidden,true);
  assert.equal(e.$('add-person').hidden,true);
  assert.equal(e.$('chart').querySelectorAll('.group-row').length,2);
  assert.equal(e.$('mobile-app').querySelector('button[aria-label="メンバー"]'),null);

  await e.click('Bの時間を編集');
  assert.equal(e.button('保存').disabled,true);
  await e.click('閉じる');
  await e.click('Aの時間を編集');
  await e.select('編集する時間','range:0');
  await e.click('開始を30分遅らせる');
  await e.click('保存');
  assert.equal(e.saves,1);
});

test('a valid group ID named __proto__ remains ordinary persisted exclusion data',async t=>{
  const e=await environment(t,{groupId:'__proto__'}),before=JSON.stringify(e.current());
  await e.click('Aを対象から一時除外');
  const saved=JSON.parse(e.w.localStorage.getItem('toki-view-v1:local:excluded'));
  assert.equal(Object.hasOwn(saved,'__proto__'),true);assert.deepEqual(saved.__proto__,['A']);
  assert.equal(e.$('mobile-app').querySelector('.mob-excluded').textContent,'A');assert.equal(JSON.stringify(e.current()),before);
});

for(const width of [1440,390])test(`fresh starts use today and the shared month picker retains an in-memory date (${width}px)`,async t=>{
  const e=await environment(t,{width,launchDate:'2028-02-28'});
  const open=()=>width===1440?e.$('date-select').click():e.button('日付を選択').click();
  assert.match(e.$('date-select').textContent,/2028年2月28日/);
  open();
  assert.equal(e.$('date-picker').open,true);
  assert.equal(e.$('picker-month').textContent,'2028年 2月');
  assert.equal(e.$('picker-days').querySelectorAll('button').length,29);
  assert.equal(e.$('picker-days').querySelector('[aria-current="date"]').dataset.date,'2028-02-28');
  e.$('next-month').click();
  e.$('picker-days').querySelector('[data-date="2028-03-02"]').click();
  assert.equal(e.$('date-picker').open,false);
  e.w.dispatchEvent(new e.w.Event('pageshow'));
  assert.match(e.$('date-select').textContent,/2028年3月2日/);
  open();
  e.$('picker-today').click();
  assert.match(e.$('date-select').textContent,/2028年2月28日/);
});

const chooseDuplicateDay=(e,day)=>e.$('picker-days').querySelector('[data-date="'+day+'"]').click();
function rightClickBand(e,selector){
  const bar=e.$('chart').querySelector(selector);
  assert.ok(bar,selector);
  bar.dispatchEvent(new e.w.MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}));
  assert.equal(e.$('meeting-menu').open,true);
}
test('desktop right-click duplicates availability across months and one undo reverts all selected dates',async t=>{
  const e=await environment(t,{width:1440,shared:true}),before=e.current();
  rightClickBand(e,'[data-name="A"] .event.availability');
  e.$('duplicate-time').click();
  assert.equal(e.$('picker-form').hidden,true);
  assert.equal(e.$('confirm-duplicate').disabled,true);
  assert.equal(e.$('picker-days').querySelector('[data-date="'+date+'"]').disabled,true);
  chooseDuplicateDay(e,'2026-10-06');
  chooseDuplicateDay(e,'2026-10-07');chooseDuplicateDay(e,'2026-10-07');
  e.$('next-month').click();chooseDuplicateDay(e,'2026-11-01');
  assert.equal(e.$('duplicate-count').textContent,'2日を選択');
  e.$('previous-month').click();
  assert.equal(e.$('picker-days').querySelector('[data-date="2026-10-06"]').getAttribute('aria-pressed'),'true');
  assert.equal(e.saves,0);
  await e.$('confirm-duplicate').onclick();
  assert.equal(e.$('date-picker').open,false);assert.equal(e.saves,1);
  for(const day of ['2026-10-06','2026-11-01'])assert.deepEqual(S.personRanges(e.current(),0,day),[{start:540,end:780}]);
  assert.deepEqual(S.personRanges(e.current(),0,'2026-10-07'),[]);
  await e.$('undo').onclick();
  assert.deepEqual(e.current(),before);
  e.$('date-select').click();assert.equal(e.$('picker-form').hidden,false);
});
test('group MTG right-click opens the same calendar and marks unavailable dates without saving them',async t=>{
  const e=await environment(t,{width:1440,shared:true});
  rightClickBand(e,'[data-name="局A"] .event.meeting');
  e.$('duplicate-time').click();chooseDuplicateDay(e,'2026-10-06');
  await e.$('confirm-duplicate').onclick();
  assert.equal(e.saves,0);
  assert.match(e.$('duplicate-warning').textContent,/⚠.*10月6日/);
  assert.equal(e.$('picker-days').querySelector('[data-date="2026-10-06"]').hasAttribute('data-duplicate-warning'),true);
  e.$('close-date-picker').click();assert.equal(e.$('date-picker').open,false);
});
test('mobile guest copies permitted dates and the server can block a date without disclosing other schedules',async t=>{
  const e=await environment(t,{shared:true,scoped:true,guest:true,blockedDates:['2026-10-06']});

  await e.click('A 09:00～13:00の操作');
  await e.click('他の日に複製');
  chooseDuplicateDay(e,'2026-10-06');chooseDuplicateDay(e,'2026-10-07');chooseDuplicateDay(e,'2026-10-08');
  await e.$('confirm-duplicate').onclick();
  assert.equal(e.$('date-picker').open,true);
  assert.match(e.$('duplicate-result').textContent,/2日に複製/);
  assert.match(e.$('duplicate-warning').textContent,/⚠.*10月6日/);
  assert.deepEqual(S.personRanges(e.current(),0,'2026-10-06'),[]);
  for(const day of ['2026-10-07','2026-10-08'])assert.deepEqual(S.personRanges(e.current(),0,day),[{start:540,end:780}]);
  e.$('close-date-picker').click();await e.$('undo').onclick();
  for(const day of ['2026-10-07','2026-10-08'])assert.deepEqual(S.personRanges(e.current(),0,day),[]);
});
test('double-click splits a band at the nearest interior half hour without changing group availability',async t=>{
  const e=await environment(t,{width:1440,shared:true}),before=e.current();
  const bands=()=>e.$('chart').querySelectorAll('[data-name="A"] .event.availability');
  function doubleClick(bar,minute){
    bar.closest('.timeline').getBoundingClientRect=()=>({left:0,width:960});
    bar.dispatchEvent(new e.w.MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0,detail:2,clientX:minute-480}));
  }
  doubleClick(bands()[0],541);await flush();assert.equal(e.saves,0);
  doubleClick(bands()[0],618);await flush();assert.equal(e.saves,1);
  assert.deepEqual([...bands()].map(bar=>bar.querySelector('.event-time').textContent),['09:00–10:30','10:30–13:00','14:00–18:00']);
  assert.deepEqual(S.ranges(e.current(),'g:a',date),S.ranges(before,'g:a',date));
  await e.$('undo').onclick();assert.deepEqual(e.current(),before);
});

test('members can edit their own and place times on mobile, while other people and MTGs are view-only',async t=>{
  const e=await environment(t,{shared:true,scoped:true});
  assert.equal(e.$('add-group').hidden,true);
  assert.equal(e.$('add-person').textContent,'＋ 場所・外部予定を追加');

  await e.click('Cの時間を編集');
  assert.equal(e.button('保存').disabled,true);
  assert.match(e.error,/閲覧のみ/);
  await e.click('閉じる');

  await e.click('Aの時間を編集');
  await e.select('編集する時間','range:0');
  await e.click('開始を30分遅らせる');
  await e.click('保存');
  assert.equal(e.saves,1);
  assert.ok(e.current().events.some(event=>event.person===0&&event.start===570));
  await e.click('Bの時間を編集');
  await e.select('編集する時間','range:0');
  await e.click('開始を30分遅らせる');
  await e.click('保存');
  assert.equal(e.saves,2);
  assert.ok(e.current().events.some(event=>event.person===1&&event.start===570));
  await e.resize(1440);
  assert.equal(e.$('chart').querySelectorAll('.row-drag-handle').length,0);
  assert.ok(e.$('chart').querySelector('[aria-label="Bを編集・削除"]'));
  assert.equal(e.$('chart').querySelector('[aria-label="Cを編集・削除"]'),null);
});

test('first visit hides all groups and shares the explicit selection between desktop and mobile',async t=>{
  const e=await environment(t,{width:1440,preselect:false}),before=JSON.stringify(e.current());
  assert.equal(e.$('group-view-dialog').open,true);assert.equal(e.$('group-view-dialog').querySelectorAll('input:checked').length,0);
  assert.equal(e.$('chart').querySelectorAll('.person-row,.group-row').length,0);
  e.$('group-view-choices').querySelector('[data-group="b"]').click();await e.click('適用');
  assert.equal(e.$('chart').querySelectorAll('.group-row').length,1);assert.ok(e.$('chart').querySelector('.group-row').textContent.includes('局B'));
  await e.resize(390);await e.click('予定');assert.deepEqual([...e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child')].map(n=>n.textContent),['局B']);
  assert.equal(JSON.stringify(e.current()),before);
});

test('company changes start with their own empty selection; returning restores only that company preference',async t=>{
  const e=await environment(t,{shared:true});await e.switchScope('u:company-b');
  assert.equal(e.$('group-view-dialog').open,false);await e.click('予定');
  assert.equal(e.$('group-view-dialog').open,true);assert.equal(e.$('group-view-dialog').querySelectorAll('input:checked').length,0);
  e.$('group-view-choices').querySelector('[data-group="b"]').click();await e.click('適用');
  const groupNames=()=>[...e.d.querySelectorAll('.mob-group-tr th button:first-child')].map(button=>button.textContent);
  await e.switchScope('shared');assert.equal(e.$('group-view-dialog').open,false);await e.click('予定');assert.deepEqual(groupNames(),['局A','局B']);
  await e.switchScope('u:company-b');assert.equal(e.$('group-view-dialog').open,false);await e.click('予定');assert.deepEqual(groupNames(),['局B']);
});

for(const width of [1440,390])for(const shared of [false,true])test(`created groups become visible and preserve other choices (${width}px, ${shared?'shared':'local'})`,async t=>{
  const e=await environment(t,{width,shared,preselect:false});
  e.$('group-view-choices').querySelector('[data-group="b"]').click();await e.click('適用');
  if(width<768){await e.click('その他');await e.click('メンバー');await e.click('＋ グループ');}else e.$('add-group').click();
  e.$('roster-name').value='作成したグループ';e.$('membership-options').querySelector('input[value="0"]').checked=true;
  await e.$('roster-form').onsubmit({preventDefault(){}});await flush();
  const created=e.current().groups.find(g=>g.name==='作成したグループ');assert.ok(created);assert.equal(e.$('roster-dialog').open,false);
  const preferenceKey=`toki-view-v1:${shared?'shared':'local'}:groups`;
  assert.deepEqual(JSON.parse(e.w.localStorage.getItem(preferenceKey)).selected.sort(),['b',created.id].sort());
  if(width<768)await e.click('予定');
  const visibleNames=()=>[...(width<768?e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child'):e.$('chart').querySelectorAll('.group-row .row-name'))].map(n=>n.textContent);
  assert.deepEqual(visibleNames(),['局B','作成したグループ']);
  if(shared){
    await e.switchScope('u:other-organization');assert.equal(e.$('group-view-dialog').querySelectorAll('input:checked').length,0);
    await e.switchScope('shared');if(width<768)await e.click('予定');assert.deepEqual(visibleNames(),['局B','作成したグループ']);
  }
  await e.resize(width<768?1440:390);
  if(width>=768)await e.click('予定');
  assert.deepEqual([...(width<768?e.$('chart').querySelectorAll('.group-row .row-name'):e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child'))].map(n=>n.textContent),['局B','作成したグループ']);
});

test('creating after dismissing the first filter prompt persists the new group without selecting existing groups',async t=>{
  const e=await environment(t,{width:1440,preselect:false});e.$('group-view-close').click();
  e.$('add-group').click();e.$('roster-name').value='最初のグループ';await e.$('roster-form').onsubmit({preventDefault(){}});
  const created=e.current().groups.find(g=>g.name==='最初のグループ');assert.ok(created);
  assert.deepEqual(JSON.parse(e.w.localStorage.getItem('toki-view-v1:local:groups')).selected,[created.id]);
  assert.equal(e.$('group-view-dialog').open,false);assert.equal(e.$('chart').querySelectorAll('.group-row').length,1);
});

test('failed group creation and editing a hidden group do not change display choices',async t=>{
  const e=await environment(t,{shared:true,preselect:false});await e.click('適用');
  const key='toki-view-v1:shared:groups',before=e.w.localStorage.getItem(key);
  await e.click('その他');await e.click('メンバー');await e.click('局Aの設定を編集');e.$('roster-name').value='編集後の局A';
  await e.$('roster-form').onsubmit({preventDefault(){}});assert.equal(e.w.localStorage.getItem(key),before);
  await e.click('＋ グループ');e.$('roster-name').value='保存失敗グループ';e.fail();
  await e.$('roster-form').onsubmit({preventDefault(){}});assert.equal(e.$('roster-dialog').open,true);assert.match(e.$('roster-error').textContent,/保存失敗/);
  assert.equal(e.current().groups.some(g=>g.name==='保存失敗グループ'),false);assert.equal(e.w.localStorage.getItem(key),before);
  e.$('cancel-roster').click();await e.click('予定');assert.equal(e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child').length,0);
});

test('groups received from another device remain hidden until explicitly selected',async t=>{
  const e=await environment(t,{shared:true});
  const key='toki-view-v1:shared:groups',before=e.w.localStorage.getItem(key);
  e.current().groups.push({id:'remote-group',name:'別端末のグループ',members:[0]});await e.remoteUpdate();
  assert.equal(e.w.localStorage.getItem(key),before);assert.equal([...e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child')].some(n=>n.textContent==='別端末のグループ'),false);
  await e.click('表示グループを選択');assert.equal(e.$('group-view-choices').querySelector('[data-group="remote-group"]').checked,false);
});

test('logout closes editors and removes company data from hidden DOM and exported text',async t=>{
  const e=await environment(t,{shared:true});await e.click('局Aの時間を編集');await e.click('終了を30分遅らせる');
  e.$('export-result').value='Private schedule';e.$('print-area').textContent='Private schedule';
  await e.resetAccount();
  assert.equal(e.d.querySelector('dialog[open]'),null);assert.equal(e.$('auth-gate').hidden,false);
  assert.equal(e.$('mobile-app').hidden,true);assert.equal(e.$('mobile-editor').textContent,'閉じる');
  assert.equal(e.$('export-result').value,'');assert.equal(e.$('print-area').textContent,'');
  assert.equal(e.$('chart').textContent,'');assert.equal(e.saves,0);
});
test('compact layout selection and deferred switching preserve an open editor',async t=>{
  const e=await environment(t,{width:768});assert.equal(e.$('mobile-app').hidden,true);
  await e.resize(767);assert.equal(e.$('mobile-app').hidden,false);
  await e.click('予定');
  await e.click('局Aの時間を編集');await e.resize(1280);assert.equal(e.d.documentElement.dataset.ui,'compact');
  await e.click('閉じる');assert.equal(e.d.documentElement.dataset.ui,'desktop');
  await e.resize(1023,true);assert.equal(e.d.documentElement.dataset.ui,'compact');
  await e.resize(1024,true);assert.equal(e.d.documentElement.dataset.ui,'desktop');
});
test('scroll gestures cannot edit; explicit selection previews without persistence, then saves once',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('局Aの時間を編集');
  const summary=()=>e.d.querySelector('.mob-preview-summary').textContent;
  const initial=summary();e.pointer('pointerdown',600);e.pointer('pointermove',660);e.pointer('pointerup',660);assert.equal(summary(),initial);assert.equal(JSON.stringify(e.current()),before);
  await e.click('範囲選択モード');e.pointer('pointerdown',600);e.pointer('pointermove',660);e.pointer('pointerup',660);
  assert.match(summary(),/10:00～11:00/);assert.equal(JSON.stringify(e.current()),before);
  assert.equal(e.button('スクロールモード').getAttribute('aria-pressed'),'true');await e.click('保存');
  assert.ok(e.current().meetings.some(m=>m.start===600&&m.end===660));
  for(const p of [0,1])assert.equal(S.personRanges(e.current(),p,date).some(r=>r.start<660&&r.end>600),false);
});
test('cancel, multitouch and rotation restore the prior draft without writing',async t=>{
  for(const reason of ['cancel','second-pointer','rotation']){
    const e=await environment(t),before=JSON.stringify(e.current());await e.click('局Aの時間を編集');const summary=e.d.querySelector('.mob-preview-summary').textContent;
    await e.click('範囲選択モード');e.pointer('pointerdown',600);e.pointer('pointermove',660);
    if(reason==='cancel')e.pointer('pointercancel',660);else if(reason==='second-pointer')e.pointer('pointerdown',630,2,{isPrimary:false});else e.w.dispatchEvent(new e.w.Event('orientationchange'));
    assert.equal(e.d.querySelector('.mob-preview-summary').textContent,summary,reason);assert.equal(JSON.stringify(e.current()),before,reason);
  }
});
test('dirty cancellation is inline and discards data only after the explicit choice',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('局Aの時間を編集');await e.click('終了を30分遅らせる');await e.click('閉じる');
  assert.ok(e.d.querySelector('.mob-discard'));await e.click('編集に戻る');assert.equal(e.$('mobile-editor').open,true);
  await e.click('キャンセル');await e.click('変更を破棄');assert.equal(e.$('mobile-editor').open,false);assert.equal(JSON.stringify(e.current()),before);
});
test('MTG expansion/movement preserve participants and reject unavailable ranges',async t=>{
  const e=await environment(t);await e.click('局Aの時間を編集');const id=e.current().meetings[0].id;await e.select('編集する時間',id);
  await e.click('開始を30分早める');await e.click('終了を30分遅らせる');await e.click('30分後へ');await e.click('保存');
  const m=e.current().meetings[0];assert.deepEqual([m.start,m.end,m.members],[780,900,[0,1]]);
  await e.click('局Aの時間を編集');await e.select('編集する時間',id);await e.click('移動モード');e.pointer('pointerdown',780);e.pointer('pointermove',1080);e.pointer('pointerup',1080);
  assert.match(e.error,/可能時間がありません/);assert.equal(e.button('保存').disabled,true);assert.equal(e.current().meetings[0].end,900);
});
test('personal MTG release restores only that participant; availability menu copy/deletion uses same interval',async t=>{
  const e=await environment(t);
  const person=e.$('mobile-app').querySelector('[aria-label="Aの時間を編集"]').closest('tr');await e.click('局A MTG 13:00～14:00の操作',person);await e.click('削除（可能時間を復元）');
  assert.deepEqual(e.current().meetings[0].members,[1]);assert.deepEqual(S.personRanges(e.current(),0,date),[{start:540,end:1080}]);
  await e.click('A 09:00～18:00の操作');await e.click('時間をコピー');assert.deepEqual(e.copies,['10月5日(月)：09:00～18:00']);await e.click('削除');assert.deepEqual(S.personRanges(e.current(),0,date),[]);
});
test('group filters apply together, do not change the board or export defaults, and persist locally',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('表示グループを選択');const choices=e.d.querySelector('dialog[open]');
  const checkbox=choices.querySelector('[data-group="a"]');checkbox.click();assert.ok([...e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child')].some(h=>h.textContent==='局A'));
  assert.equal(choices.querySelector('input').indeterminate,true);await e.click('適用');
  assert.equal([...e.$('mobile-app').querySelectorAll('.mob-group-tr th button:first-child')].some(h=>h.textContent==='局A'),false);assert.ok(!JSON.parse(e.w.localStorage.getItem('toki-view-v1:local:groups')).selected.includes('a'));assert.equal(JSON.stringify(e.current()),before);
  assert.ok([...e.$('mobile-app').querySelectorAll('tbody th button:first-child')].some(h=>h.textContent==='B'));
  await e.click('書き出し');await e.click('MTG一括書き出し');assert.equal(e.$('meeting-export-groups').querySelectorAll('input:checked').length,2);
  const expected=S.exportMeetings(e.current(),e.current().groups.map(g=>g.id),'2026-10-04','2026-10-10');
  assert.equal(e.$('meeting-export-result').value,expected);await e.click('コピー');assert.deepEqual(e.copies,[expected]);
});

test('mobile starts at the current month with four bottom actions and only editable targets',async t=>{
  const e=await environment(t,{entry:true,shared:true,scoped:true,launchDate:'2028-01-31'});
  assert.deepEqual([...e.d.querySelectorAll('.mob-nav button')].map(button=>button.textContent),['予定入力','予定','書き出し','その他']);
  assert.equal(e.d.querySelector('.mob-nav [aria-current="page"]').textContent,'予定入力');
  assert.deepEqual([...e.d.querySelectorAll('.mob-entry-person option')].map(option=>option.textContent),['A','B']);
  assert.equal(e.d.querySelector('.mob-entry-person').selectedOptions[0].textContent,'A');
  assert.equal(e.d.querySelector('.mob-month-date[aria-current="date"]').textContent,'31 月');
  await e.click('次の月');assert.equal(e.d.querySelectorAll('.mob-month-track').length,29);
  assert.match(e.button('日付を選択').textContent,/2月29日/);
  await e.click('日付を選択');e.$('picker-days').querySelector('[data-date="2028-02-11"]').click();await flush();
  assert.match(e.button('日付を選択').textContent,/2月11日/);
  await e.click('予定');assert.equal(e.d.querySelector('.mob-month').hidden,true);
  const group=e.d.querySelector('.mob-group-tr'),toggle=group.querySelector('.mob-table-fold');
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  const count=e.d.querySelectorAll('.mob-table tbody tr').length;
  await e.click('局Aのメンバー表示');
  assert.equal(e.button('局Aのメンバー表示').getAttribute('aria-expanded'),'false');
  assert.equal(e.d.querySelectorAll('.mob-table tbody tr').length,count-2);
});
test('initial mobile group selection waits until the comparison table is first opened',async t=>{
  const e=await environment(t,{entry:true,preselect:false});
  assert.equal(e.$('group-view-dialog').open,false);
  assert.equal(e.d.querySelector('.mob-month').hidden,false);
  await e.click('予定');
  assert.equal(e.$('group-view-dialog').open,true);
  assert.equal(e.$('group-view-dialog').querySelectorAll('input:checked').length,0);
});
test('the new mobile table carries over a saved group fold and stores later changes for that table',async t=>{
  const e=await environment(t,{entry:true,legacyFolded:['a']});
  await e.click('予定');
  assert.equal(e.button('局Aのメンバー表示').getAttribute('aria-expanded'),'false');
  assert.equal(e.button('局Bのメンバー表示').getAttribute('aria-expanded'),'true');
  await e.click('局Aのメンバー表示');
  assert.deepEqual(JSON.parse(e.w.localStorage.getItem('toki-view-v1:local:toki-mobile-table-collapsed')),[]);
});
function monthGesture(e){
  const viewport=e.d.querySelector('.mob-month'),axis=viewport.querySelector('.mob-month-axis');
  const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
  viewport.getBoundingClientRect=()=>rect(0,0,390,560);axis.getBoundingClientRect=()=>rect(0,0,390,36);
  Object.defineProperty(axis.firstChild,'offsetWidth',{value:58});
  const slot=()=>parseFloat(viewport.style.getPropertyValue('--month-slot'))||44;
  function track(day){
    const tracks=[...viewport.querySelectorAll('.mob-month-track')];
    for(const [index,node] of tracks.entries()){
      node.getBoundingClientRect=()=>rect(58,36+(index-4)*54,slot()*32,54);
      for(const band of node.querySelectorAll('.mob-month-band'))band.getBoundingClientRect=()=>{
        const row=node.getBoundingClientRect();
        return rect(row.left+parseFloat(band.style.left)/100*row.width,row.top+3,parseFloat(band.style.width)/100*row.width,48);
      };
    }
    return tracks.find(node=>node.dataset.date===day);
  }
  function touch(target,type,touches,changedTouches=touches){
    const event=new e.w.Event(type,{bubbles:true,cancelable:true});
    Object.assign(event,{touches,changedTouches});target.dispatchEvent(event);return event;
  }
  const point=(day,minute,identifier=1)=>({identifier,clientX:58+(minute-480)/30*slot(),clientY:track(day).getBoundingClientRect().top+27});
  return {viewport,track,touch,point};
}
const holdMonth=()=>new Promise(resolve=>setTimeout(resolve,480));
test('monthly touch gestures separate scrolling, tapping, range creation, cross-date moves and resizing',async t=>{
  const e=await environment(t,{entry:true,shared:true}),g=monthGesture(e);
  const day6='2026-10-06',day7='2026-10-07',day8='2026-10-08';
  let down=g.point(day6,515),up={...down,clientY:down.clientY+70},track=g.track(day6);
  g.touch(track,'touchstart',[down]);assert.equal(g.touch(track,'touchmove',[up]).defaultPrevented,false);
  await holdMonth();g.touch(track,'touchend',[],[up]);assert.equal(e.saves,0);
  g.touch(track,'touchstart',[down]);g.touch(track,'touchend',[],[down]);await flush();
  assert.deepEqual(S.personRanges(e.current(),0,day6),[{start:510,end:540}]);
  down=g.point(day7,545);up=g.point(day7,610);track=g.track(day7);
  g.touch(track,'touchstart',[down]);await holdMonth();
  assert.equal(g.touch(track,'touchmove',[up]).defaultPrevented,true);
  g.touch(track,'touchend',[],[up]);await flush();
  assert.deepEqual(S.personRanges(e.current(),0,day7),[{start:540,end:630}]);
  let band=g.track(day7).querySelector('.mob-month-band');
  down=g.point(day7,585);up=g.point(day8,615);
  g.touch(band,'touchstart',[down]);await holdMonth();g.touch(band,'touchmove',[up]);g.touch(band,'touchend',[],[up]);await flush();
  assert.deepEqual(S.personRanges(e.current(),0,day7),[]);
  assert.deepEqual(S.personRanges(e.current(),0,day8),[{start:570,end:660}]);
  band=g.track(day8).querySelector('.mob-month-band');down=g.point(day8,657);up=g.point(day8,688);
  g.touch(band,'touchstart',[down]);await holdMonth();g.touch(band,'touchmove',[up]);g.touch(band,'touchend',[],[up]);await flush();
  assert.deepEqual(S.personRanges(e.current(),0,day8),[{start:570,end:690}]);
  band=g.track(day8).querySelector('.mob-month-band');down=g.point(day8,600);
  g.touch(band,'touchstart',[down]);g.touch(band,'touchend',[],[down]);
  assert.ok(e.button('時間をコピー'));assert.ok(e.button('他の日に複製'));assert.ok(e.button('削除'));assert.equal(e.saves,4);
});
test('pinching cancels a pending edit, scales the grid, and consumes the remaining finger',async t=>{
  const e=await environment(t,{entry:true,shared:true}),g=monthGesture(e),day='2026-10-06',track=g.track(day);
  const a=g.point(day,520),b=g.point(day,565,2);
  g.touch(track,'touchstart',[a]);await holdMonth();assert.ok(track.querySelector('.mob-month-preview'));
  g.touch(track,'touchstart',[a,b]);assert.equal(track.querySelector('.mob-month-preview'),null);
  assert.equal(g.touch(track,'touchmove',[{...a,clientX:a.clientX-15},{...b,clientX:b.clientX+40}]).defaultPrevented,true);
  assert.ok(parseFloat(g.viewport.style.getPropertyValue('--month-slot'))>44);
  g.touch(track,'touchmove',[{...a,clientX:a.clientX+10},{...b,clientX:b.clientX-20}]);
  assert.ok(parseFloat(g.viewport.style.getPropertyValue('--month-slot'))<44);
  g.touch(track,'touchend',[a],[b]);g.touch(track,'touchend',[],[a]);await flush();assert.equal(e.saves,0);
});
test('individual transfer preserves precise minutes and can be cancelled without effect',async t=>{
  const e=await environment(t);await e.click('Cの時間を編集');await e.select('編集する時間','range:0');await e.select('移動先の人','3');await e.click('開始を30分遅らせる');await e.click('保存');
  assert.deepEqual(S.personRanges(e.current(),2,date),[]);assert.deepEqual(S.personRanges(e.current(),3,date),[{start:570,end:1080}]);
});
test('group exclusions strike through a person without changing existing MTG participants',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('Aを対象から一時除外');
  assert.equal(e.$('mobile-app').querySelector('.mob-excluded').textContent,'A');assert.equal(JSON.stringify(e.current()),before);
  await e.click('局Aの時間を編集');await e.click('保存');assert.deepEqual(e.current().meetings.at(-1).members,[1]);
});
test('table scroll mode does not expose drag editing, fullscreen can be exited',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('予定');assert.ok(e.$('mobile-app').querySelector('.mob-table'));assert.equal(e.$('mobile-app').querySelector('.timeline'),null);
  await e.click('⛶ 全画面表示');assert.equal(e.$('mobile-app').classList.contains('mob-full'),true);await e.click('⛶ 全画面終了');assert.equal(e.$('mobile-app').classList.contains('mob-full'),false);assert.equal(JSON.stringify(e.current()),before);
});
test('local and shared concurrent changes block saving and are applied on closing',async t=>{
  for(const shared of [false,true]){const e=await environment(t,{shared});await e.click('局Aの時間を編集');await e.click('終了を30分遅らせる');if(shared)await e.remoteUpdate();else await e.localUpdate();
    assert.match(e.error,/更新/);assert.equal(e.button('保存').disabled,true);await e.click('キャンセル');await e.click('変更を破棄');assert.equal(e.current().people[0],'A更新');assert.equal(e.saves,0);
  }
});
test('offline forces scroll mode and blocks writing while retaining copy; save failure keeps draft open',async t=>{
  const e=await environment(t,{shared:true});await e.click('局Aの時間を編集');await e.select('編集する時間',e.current().meetings[0].id);await e.click('移動モード');await e.offline();
  assert.equal(e.d.querySelector('.mob-editor-track').dataset.mode,'scroll');assert.equal(e.button('保存').disabled,true);await e.click('時間をコピー');assert.deepEqual(e.copies,['10月5日(月)：13:00～14:00']);
  await e.offline(false);await e.click('終了を30分遅らせる');e.fail();await e.click('保存');assert.equal(e.$('mobile-editor').open,true);assert.equal(e.saves,0);assert.equal(e.current().meetings[0].end,840);assert.match(e.error,/保存失敗/);
});

test('desktop local save failure retains the old board and form, and retry saves once',async t=>{
  const e=await environment(t,{width:1440}),before=JSON.stringify(e.current());
  const storage=Object.getPrototypeOf(e.w.localStorage),setItem=storage.setItem;
  storage.setItem=function(key,value){if(key==='toki-availability-v3')throw Error('QuotaExceededError');return setItem.call(this,key,value);};
  e.$('add-person').click();e.$('roster-name').value='E';
  const submit=async()=>{e.$('roster-form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  await submit();
  assert.equal(JSON.stringify(e.current()),before);assert.equal(e.$('roster-dialog').open,true);
  assert.match(e.$('roster-error').textContent,/保存できません/);assert.match(e.$('save-status').textContent,/未保存/);
  assert.doesNotMatch(e.$('toast').textContent,/追加しました/);assert.equal(e.$('undo').disabled,true);
  assert.equal(e.d.querySelectorAll('.person-row[data-person="4"]').length,0);
  storage.setItem=setItem;await submit();assert.equal(e.$('roster-dialog').open,false);
  assert.deepEqual(e.current().people,['A','B','C','D','E']);assert.equal(e.$('undo').disabled,false);
  e.$('undo').click();await flush();assert.equal(JSON.stringify(e.current()),before);
});

test('desktop local changes arriving during a roster dialog are applied after cancel',async t=>{
  const e=await environment(t,{width:1440});e.$('add-person').click();await e.localUpdate();e.$('cancel-roster').click();await flush();
  assert.equal(e.d.querySelector('[data-person="0"] .row-name').textContent,'A更新');
  e.$('add-person').click();e.$('roster-name').value='E';e.$('roster-form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert.deepEqual(e.current().people,['A更新','B','C','D','E']);
});

test('desktop local stale submissions cannot overwrite updates received while editing',async t=>{
  const e=await environment(t,{width:1440});e.d.querySelector('[data-person="0"] .row-name').click();e.$('roster-name').value='stale';await e.localUpdate();
  e.$('roster-form').dispatchEvent(new e.w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert.equal(e.current().people[0],'A更新');assert.equal(e.$('roster-dialog').open,true);assert.match(e.$('roster-error').textContent,/別タブ/);
  e.$('cancel-roster').click();await flush();assert.equal(e.d.querySelector('[data-person="0"] .row-name').textContent,'A更新');
});

test('desktop drag cannot overwrite a local update and adopts it after release',async t=>{
  const e=await environment(t,{width:1440}),track=e.d.querySelector('.timeline[data-row="p:3"]');
  track.getBoundingClientRect=()=>({left:0,width:960,top:0,height:30,right:960,bottom:30});
  const fire=(target,type,x)=>{const event=new e.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:15});Object.assign(event,{pointerId:1});target.dispatchEvent(event);};
  fire(track,'pointerdown',120);fire(e.d,'pointermove',180);await e.localUpdate();fire(e.d,'pointerup',180);await flush();
  assert.equal(e.current().people[0],'A更新');assert.deepEqual(S.personRanges(e.current(),3,date),[]);
  assert.equal(e.d.querySelector('[data-person="0"] .row-name').textContent,'A更新');
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const S=require('../schedule.js');
const date='2026-10-05';
const seed=()=>S.reserve({schemaVersion:4,people:['A','B','C','D'],groups:[{id:'a',name:'局A',members:[0,1]},{id:'b',name:'局B',members:[1,2]}],events:[0,1,2].map(person=>({id:'e'+person,person,date,start:540,end:1080})),meetings:[]},'a',date,[{start:780,end:840}]);
const flush=()=>new Promise(resolve=>setTimeout(resolve,40));
async function environment(t,{width=390,coarse=false,shared=false}={}){
  const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/TOKI/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const w=dom.window,d=w.document,media=[];let board=seed(),version=1,hooks,online=true,saves=0,failSave=false;
  w.scrollTo=()=>{};w.confirm=()=>{throw Error('Unexpected browser confirmation');};
  w.matchMedia=query=>{const entry={media:query,matches:false,listeners:[],addEventListener(type,fn){this.listeners.push(fn);}};media.push(entry);entry.matches=query.includes('767')?width<=767:width<=1023&&coarse;return entry;};
  w.HTMLElement.prototype.setPointerCapture=()=>{};
  // jsdom 26 has no PointerEvent handler properties; route them to its EventTarget.
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])Object.defineProperty(w.HTMLElement.prototype,'on'+type,{configurable:true,set(value){if(this['_'+type])this.removeEventListener(type,this['_'+type]);this['_'+type]=value;this.addEventListener(type,value);},get(){return this['_'+type];}});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  const copies=[];Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text=>copies.push(text)}});
  w.TOKI_CONFIG={boardId:'test-board'};w.TOKI_DATA={people:[],dates:[date],availability:[]};w.TOKI_DATA_READY=Promise.resolve();
  w.localStorage.setItem('toki-selected-date',date);w.localStorage.setItem('toki-availability-v3',JSON.stringify({version:3,board}));
  w.TokiShared={enabled:shared,get online(){return online;},shareUrl:()=>'',initialize:async h=>{hooks=h;h.board({version,payload:board});},save:async next=>{if(failSave)throw Error('試験：保存失敗');saves++;board=structuredClone(next);return {version:++version,payload:board};},refresh:async()=>{}};
  for(const name of ['model','availability','schedule','availability-ui','meeting-menu','meeting-export-ui','row-drag','calendar-import','google-calendar','google-import-ui','mobile-model','mobile-ui','app'])w.eval(fs.readFileSync(name+'.js','utf8'));
  await flush();await flush();
  t.after(()=>{dom.window.close();assert.deepEqual(errors.map(e=>e.message),[]);});
  const $=id=>d.getElementById(id),current=()=>shared?board:JSON.parse(w.localStorage.getItem('toki-availability-v3')).board;
  const scope=()=>d.querySelector('dialog[open]')||$('mobile-app');
  const button=(label,container=scope())=>{const b=[...container.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent===label);assert.ok(b,`button: ${label}; gate=${$('auth-message').textContent}; root=${$('mobile-app').textContent.slice(0,120)}`);return b;};
  async function click(label,container){button(label,container).click();await flush();}
  async function select(label,value){const s=[...scope().querySelectorAll('select')].find(e=>e.getAttribute('aria-label')===label);assert.ok(s);s.value=value;s.dispatchEvent(new w.Event('change'));await flush();}
  function pointer(type,minute,id=1,extra={}){const track=d.querySelector('.mob-editor-track'),e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientY:(minute-480)*1.6,clientX:160});Object.assign(e,{pointerId:id,isPrimary:true,...extra});track.dispatchEvent(e);}
  return {w,d,$,click,button,select,pointer,copies,current,get saves(){return saves;},get error(){return d.querySelector('.mob-error')?.textContent;},async resize(newWidth,newCoarse=coarse){width=newWidth;coarse=newCoarse;media.forEach(entry=>{entry.matches=entry.media.includes('767')?width<=767:width<=1023&&coarse;entry.listeners.forEach(fn=>fn());});await flush();},async offline(value=true){online=!value;hooks.state({online,fetchedAt:Date.now()});await flush();},async remoteUpdate(){board=structuredClone(board);board.people[0]='A更新';hooks.board({version:++version,payload:board});await flush();},async localUpdate(){const value=structuredClone(current());value.people[0]='A更新';const text=JSON.stringify({version:3,board:value});w.localStorage.setItem('toki-availability-v3',text);w.dispatchEvent(new w.StorageEvent('storage',{key:'toki-availability-v3',newValue:text}));await flush();},fail(){failSave=true;}};
}
test('compact layout selection and deferred switching preserve an open editor',async t=>{
  const e=await environment(t,{width:768});assert.equal(e.$('mobile-app').hidden,true);
  await e.resize(767);assert.equal(e.$('mobile-app').hidden,false);
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
  const e=await environment(t);await e.click('局Aのメンバー表示');
  const person=e.$('mobile-app').querySelector('.mob-person');await e.click('局A MTG 13:00～14:00の操作',person);await e.click('削除（可能時間を復元）');
  assert.deepEqual(e.current().meetings[0].members,[1]);assert.deepEqual(S.personRanges(e.current(),0,date),[{start:540,end:1080}]);
  await e.click('A 09:00～18:00の操作');await e.click('時間をコピー');assert.deepEqual(e.copies,['10月5日(月)：09:00～18:00']);await e.click('削除');assert.deepEqual(S.personRanges(e.current(),0,date),[]);
});
test('group filters apply together, do not change the board or export defaults, and persist locally',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('表示グループを選択');const choices=e.d.querySelector('dialog[open]');
  const checkbox=choices.querySelector('[data-group="a"]');checkbox.click();assert.ok([...e.$('mobile-app').querySelectorAll('h2')].some(h=>h.textContent==='局A'));
  assert.equal(choices.querySelector('input').indeterminate,true);await e.click('適用');
  assert.equal([...e.$('mobile-app').querySelectorAll('h2')].some(h=>h.textContent==='局A'),false);assert.ok(e.w.localStorage.getItem('toki-mobile-hidden-groups:local').includes('a'));assert.equal(JSON.stringify(e.current()),before);
  await e.click('局Bのメンバー表示');assert.ok([...e.$('mobile-app').querySelectorAll('h3')].some(h=>h.textContent==='B'));
  await e.click('書き出し');await e.click('MTG一括書き出し');assert.equal(e.$('meeting-export-groups').querySelectorAll('input:checked').length,2);
  const expected=S.exportMeetings(e.current(),e.current().groups.map(g=>g.id),'2026-10-04','2026-10-10');
  assert.equal(e.$('meeting-export-result').value,expected);await e.click('コピー');assert.deepEqual(e.copies,[expected]);
});

test('long press opens the same actions while finger movement cancels it',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('局Aのメンバー表示');
  const b=e.button('A 09:00～13:00の操作');
  const point=(target,type,x)=>{const event=new e.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:200});Object.assign(event,{pointerId:1,isPrimary:true});target.dispatchEvent(event);};
  point(b,'pointerdown',100);point(b,'pointermove',120);await new Promise(resolve=>setTimeout(resolve,650));assert.equal(e.d.querySelector('dialog[open]'),null);
  point(b,'pointerdown',100);await new Promise(resolve=>setTimeout(resolve,650));assert.ok(e.d.querySelector('dialog[open]'));assert.ok(e.button('削除'));assert.ok(e.button('時間をコピー'));assert.equal(JSON.stringify(e.current()),before);
});
test('individual transfer preserves precise minutes and can be cancelled without effect',async t=>{
  const e=await environment(t);await e.click('局Bのメンバー表示');await e.click('Cの時間を編集');await e.select('編集する時間','range:0');await e.select('移動先の人','3');await e.click('開始を30分遅らせる');await e.click('保存');
  assert.deepEqual(S.personRanges(e.current(),2,date),[]);assert.deepEqual(S.personRanges(e.current(),3,date),[{start:570,end:1080}]);
});
test('group exclusions strike through a person without changing existing MTG participants',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('局Aのメンバー表示');await e.click('Aを対象から一時除外');
  assert.equal(e.$('mobile-app').querySelector('.mob-excluded').textContent,'A');assert.equal(JSON.stringify(e.current()),before);
  await e.click('局Aの時間を編集');await e.click('保存');assert.deepEqual(e.current().meetings.at(-1).members,[1]);
});
test('table scroll mode does not expose drag editing, fullscreen can be exited',async t=>{
  const e=await environment(t),before=JSON.stringify(e.current());await e.click('表');assert.ok(e.$('mobile-app').querySelector('.mob-table'));assert.equal(e.$('mobile-app').querySelector('.timeline'),null);
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

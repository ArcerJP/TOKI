const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../schedule.js'),A=require('../availability.js');
const source=fs.readFileSync('meeting-menu.js','utf8');
function environment({personal=false,online=true,copyFails=false}={}){
  const listeners=new Map();
  function element(){return {hidden:false,disabled:false,textContent:'',value:'',style:{},attrs:{},open:false,
    addEventListener(type,fn){const key=[...listeners.keys()].find(k=>k.owner===this&&k.type===type)||{owner:this,type};listeners.set(key,[...(listeners.get(key)||[]),fn]);},
    emit(type,values={}){const e={target:this,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};for(const [key,fns] of listeners)if(key.owner===this&&key.type===type)for(const fn of fns)fn(e);return e;},
    setAttribute(key,value){this.attrs[key]=value;},getAttribute(key){return this.attrs[key]??null;},
    showModal(){this.open=true;},close(){this.open=false;this.emit('close');},focus(){this.focused=true;},select(){this.selected=true;},
    getBoundingClientRect(){return {width:300,height:210,left:100,bottom:200};}};}
  const root=element(),document=element(),window=element(),nodes=new Map();
  const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};document.getElementById=$;
  let current=S.reserve({schemaVersion:4,people:['A','B'],groups:[{id:'g',name:'企画局',members:[0,1]}],events:[{id:'a',person:0,date:'2026-10-05',start:540,end:1080},{id:'b',person:1,date:'2026-10-05',start:540,end:1080}],meetings:[]},'g','2026-10-05',[{start:540,end:600}]);
  const display={kind:'meeting',id:current.meetings[0].id,inGroup:!personal,row:personal?'p:0':'g:g'};
  const bar=element();bar.closest=()=>bar;
  let now=0,nextTimer=0,opened=0;const timers=new Map(),copies=[],notifications=[],releases=[];
  const setTimeout=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},clearTimeout=id=>timers.delete(id);
  function tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}}
  Object.assign(window,{TokiAvailability:A,innerWidth:1000,innerHeight:700});
  vm.runInNewContext(source,{window,document,setTimeout,clearTimeout,navigator:{clipboard:{writeText:async text=>{if(copyFails)throw Error('Denied');copies.push(text);}}}});
  const api=window.TokiMeetingMenu({root,resolve:()=>display,board:()=>current,canOpen:()=>!$('meeting-menu').open,canDelete:()=>online,onOpen:()=>opened++,release:async target=>{releases.push(target);current=S.release(current,target.id,target.person===null?{}:{person:target.person});return true;},notify:text=>notifications.push(text),settled:()=>{}});
  const down=()=>root.emit('pointerdown',{target:bar,button:0,isPrimary:true,pointerId:1,clientX:950,clientY:650});
  const up=()=>document.emit('pointerup',{pointerId:1});
  return {$,api,root,bar,document,window,down,up,tick,copies,notifications,releases,get opened(){return opened;},get board(){return current;}};
}
test('short clicks remain ordinary clicks; a stationary 600ms hold opens a menu without changing the meeting',()=>{
  const e=environment();e.down();e.tick(599);assert.equal(e.opened,0);e.up();e.tick(1);assert.equal(e.opened,0);
  e.down();e.tick(600);assert.equal(e.opened,1);assert.equal(e.$('meeting-menu').open,true);assert.equal(e.releases.length,0);
  assert.equal(e.document.emit('click').prevented,true);e.up();assert.equal(e.api.pressing,false);e.tick(0);assert.equal(e.document.emit('click').prevented,undefined);
  assert.equal(e.$('copy-meeting-time').hidden,false);assert.equal(e.$('meeting-menu').style.left,'692px');
});
test('movement, pointer cancellation, scrolling and window blur cancel a pending hold',()=>{
  for(const reason of ['move','cancel','scroll','blur']){
    const e=environment();e.down();e.tick(300);
    if(reason==='move')e.document.emit('pointermove',{pointerId:1,clientX:956,clientY:650});
    if(reason==='cancel')e.document.emit('pointercancel',{pointerId:1});
    if(reason==='scroll')e.root.emit('scroll');
    if(reason==='blur')e.window.emit('blur');
    e.tick(600);assert.equal(e.opened,0,reason);assert.equal(e.api.pressing,false);
  }
});
test('a native touch context menu arriving before the timer opens only once and suppresses the release click',()=>{
  const e=environment();e.down();e.tick(400);e.root.emit('contextmenu',{target:e.bar,clientX:950,clientY:650});e.tick(300);
  assert.equal(e.opened,1);e.up();assert.equal(e.document.emit('click').prevented,true);e.tick(0);assert.equal(e.document.emit('click').prevented,undefined);
});
test('group copy uses the requested date and time format, and group deletion restores every original participant',async()=>{
  const e=environment();e.down();e.tick(600);e.up();e.tick(0);
  await e.$('copy-meeting-time').onclick();assert.deepEqual(e.copies,['10月5日(月)：09:00～10:00']);assert.equal(e.board.meetings.length,1);
  e.down();e.tick(600);e.up();e.tick(0);await e.$('delete-meeting').onclick();
  assert.equal(e.board.meetings.length,0);for(let p=0;p<2;p++)assert.deepEqual(S.personRanges(e.board,p,'2026-10-05'),[{start:540,end:1080}]);
});
test('personal deletion removes only that participant and updates the group meeting',async()=>{
  const e=environment({personal:true});e.down();e.tick(600);e.up();e.tick(0);
  assert.equal(e.$('copy-meeting-time').hidden,true);await e.$('delete-meeting').onclick();
  assert.deepEqual(e.board.meetings[0].members,[1]);assert.deepEqual(S.personRanges(e.board,0,'2026-10-05'),[{start:540,end:1080}]);
  assert.deepEqual(S.personRanges(e.board,1,'2026-10-05'),[{start:600,end:1080}]);
});
test('offline menus allow copying and closing but never release a meeting',async()=>{
  const e=environment({online:false});e.down();e.tick(600);e.up();e.tick(0);
  assert.equal(e.$('delete-meeting').disabled,true);await e.$('delete-meeting').onclick();assert.equal(e.releases.length,0);
  e.$('close-meeting-menu').onclick();assert.equal(e.$('meeting-menu').open,false);
});
test('clipboard rejection keeps the text available for manual copying',async()=>{
  const e=environment({copyFails:true});e.down();e.tick(600);e.up();e.tick(0);await e.$('copy-meeting-time').onclick();
  assert.equal(e.$('meeting-copy-fallback').hidden,false);assert.equal(e.$('meeting-copy-fallback').value,'10月5日(月)：09:00～10:00');assert.equal(e.$('meeting-copy-fallback').selected,true);
});

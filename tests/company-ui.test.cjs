const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM,VirtualConsole}=require('jsdom');
const {sourcePath}=require('../scripts/pwa-assets.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(t){
  const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(fs.readFileSync(sourcePath('index.html'),'utf8'),{url:'https://example.test/TOKI/',runScripts:'outside-only',virtualConsole:console});
  const w=dom.window,$=id=>w.document.getElementById(id),calls=[];
  t.after(()=>{w.close();assert.deepEqual(errors,[]);});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  const members=[
    {id:'self',name:'Current administrator',email:'current@example.test',role:'admin',status:'active'},
    {id:'next',name:'<img src=x onerror=alert(1)>',email:'next@example.test',role:'member',status:'active'},
    {id:'admin',name:'Other admin',email:'admin@example.test',role:'admin',status:'active'},
    {id:'pending',name:'Pending',email:'pending@example.test',role:'member',status:'pending'},
    {id:'blocked',name:'Blocked',email:'blocked@example.test',role:'member',status:'blocked'},
  ];
  let transfer=null,removal=null,listFailure=null,listRole=null;
  const shared=w.TokiShared={enabled:true,companyAccess:true,online:true,pendingCode:'',user:{id:'self',email:'current@example.test'},company:{id:'a',name:'Company A',code:'a'.repeat(32),role:'admin'},companies:[],
    async listCompanies(){calls.push(['list']);if(listFailure)throw listFailure;if(listRole)shared.company.role=listRole;ui.render();},
    async manage(action,params){calls.push([action,params]);if(action==='members')return {members,invites:[]};if(action==='transfer_admin'){if(transfer)await transfer.promise;shared.company={...shared.company,role:'member'};ui.render();return {role:'member'};}if(action==='remove_member'){if(removal)await removal.promise;members.splice(members.findIndex(m=>m.id===params.p_member),1);return {};}},
    leaveView(){shared.company=null;ui.render();},async logout(){shared.company=null;shared.user=null;ui.render();},
  };
  w.eval(fs.readFileSync(sourcePath('company-ui.js'),'utf8'));const ui=w.TokiCompanyUI();ui.render();
  return {w,$,shared,calls,members,ui,set transfer(v){transfer=v;},set removal(v){removal=v;},set listFailure(v){listFailure=v;},set listRole(v){listRole=v;},open:()=>$('company-button').onclick(),review(){const s=$('company-transfer-target');s.value='next';s.dispatchEvent(new w.Event('change'));$('company-transfer-review').click();}};
}
test('account refresh shows transfer only to current admins and lists other approved members safely',async t=>{
  const e=environment(t);await e.open();
  assert.equal(e.$('company-admin').hidden,false);
  assert.deepEqual([...e.$('company-transfer-target').options].map(o=>o.value),['','next','admin']);
  assert.equal(e.$('company-members').querySelector('img'),null);
  e.review();assert.equal(e.$('company-transfer-confirmation').hidden,false);
  assert.match(e.$('company-transfer-summary').textContent,/next@example.test.*current@example.test.*一般メンバー/);
  assert.equal(e.calls.some(c=>c[0]==='transfer_admin'),false);
  e.$('company-transfer-cancel').click();assert.equal(e.$('company-transfer-confirmation').hidden,true);
  assert.equal(e.$('company-transfer-target').disabled,false);
  e.$('company-dialog').close();e.listRole='member';await e.open();
  assert.equal(e.$('company-admin').hidden,true);assert.equal(e.calls.filter(c=>c[0]==='members').length,1);
});
test('confirmed transfer prevents duplicate submissions and leaves success visible after demotion',async t=>{
  const e=environment(t);await e.open();e.review();const d=deferred();e.transfer=d;
  const pending=e.$('company-transfer-submit').onclick();await e.$('company-transfer-submit').onclick();
  assert.equal(e.$('company-admin-controls').disabled,true);assert.equal(e.calls.filter(c=>c[0]==='transfer_admin').length,1);
  d.resolve();await pending;
  assert.equal(e.shared.company.role,'member');assert.equal(e.$('company-admin').hidden,true);
  assert.equal(e.$('company-admin-controls').disabled,true);assert.match(e.$('company-admin-status').textContent,/next@example.test.*譲渡しました.*一般メンバー/);
  assert.equal(e.$('company-transfer-summary').textContent,'');
});
test('failed transfer rechecks permissions and never displays success',async t=>{
  const e=environment(t);await e.open();e.review();const d=deferred();e.transfer=d;
  const pending=e.$('company-transfer-submit').onclick();d.reject(Object.assign(new Error('Connection failed'),{code:'NETWORK'}));await pending;
  assert.equal(e.shared.company.role,'admin');assert.equal(e.$('company-admin').hidden,false);
  assert.match(e.$('company-admin-error').textContent,/完了を確認できません/);
  assert.doesNotMatch(e.$('company-admin-status').textContent,/譲渡しました/);assert.equal(e.$('company-transfer-confirmation').hidden,true);
  assert.equal(e.calls.filter(c=>c[0]==='list').length,2);
});
test('closing the dialog during transfer prevents stale confirmation or success messages',async t=>{
  const e=environment(t);await e.open();e.review();const d=deferred();e.transfer=d;
  const pending=e.$('company-transfer-submit').onclick();e.$('company-dialog').close();d.resolve();await pending;
  assert.equal(e.$('company-dialog').open,false);assert.equal(e.$('company-admin-status').textContent,'');
  assert.equal(e.$('company-transfer-confirmation').hidden,true);assert.equal(e.$('company-transfer-target').options.length,1);
});
test('no candidates and offline permission failures leave clear guidance without enabled transfer controls',async t=>{
  const e=environment(t);e.members.splice(1);await e.open();assert.equal(e.$('company-transfer-empty').hidden,false);assert.equal(e.$('company-transfer-review').disabled,true);
  e.$('company-dialog').close();e.listFailure=new Error('Offline');e.shared.online=false;await e.open();await tick();
  assert.equal(e.$('company-admin').hidden,true);assert.equal(e.$('company-admin-controls').disabled,true);assert.match(e.$('company-admin-error').textContent,/Offline/);
  assert.equal(e.$('company-dialog-logout').disabled,false);
});

test('only stopped members have removal controls and cancelling never sends a request',async t=>{
  const e=environment(t);await e.open();const buttons=[...e.$('company-members').querySelectorAll('button')].filter(b=>b.textContent==='団体から削除');
  assert.equal(buttons.length,1);assert.match(buttons[0].parentElement.textContent,/blocked@example.test/);
  e.w.confirm=message=>{assert.match(message,/blocked@example.test/);assert.match(message,/予定表の人の行・可能時間・MTGは残ります/);assert.match(message,/再参加には改めて招待・承認/);return false;};
  await buttons[0].onclick();assert.equal(e.calls.some(c=>c[0]==='remove_member'),false);
  e.$('company-dialog').close();e.listRole='member';await e.open();assert.equal(e.$('company-admin').hidden,true);assert.equal(e.$('company-members').textContent,'');
});
test('confirmed removal is submitted once and the removed member disappears from the refreshed list',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;const button=[...e.$('company-members').querySelectorAll('button')].find(b=>b.textContent==='団体から削除');
  const d=deferred();e.removal=d;const pending=button.onclick();await button.onclick();assert.equal(e.$('company-admin-controls').disabled,true);
  assert.equal(e.calls.filter(c=>c[0]==='remove_member').length,1);assert.equal(e.calls.find(c=>c[0]==='remove_member')[1].p_member,'blocked');
  d.resolve();await pending;assert.doesNotMatch(e.$('company-members').textContent,/blocked@example.test/);assert.match(e.$('company-members').textContent,/next@example.test/);assert.equal(e.$('company-admin-controls').disabled,false);
});
test('failed removal keeps the row and describes an uncertain network outcome',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;const button=[...e.$('company-members').querySelectorAll('button')].find(b=>b.textContent==='団体から削除');
  const d=deferred();e.removal=d;const pending=button.onclick();d.reject(Object.assign(new Error('Failed'),{code:'NETWORK'}));await pending;
  assert.match(e.$('company-members').textContent,/blocked@example.test/);assert.match(e.$('company-admin-error').textContent,/削除結果を確認できません/);assert.equal(e.$('company-admin-controls').disabled,false);
});

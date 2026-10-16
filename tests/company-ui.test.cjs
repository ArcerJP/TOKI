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
  let roleChange=null,roleFailure=null,removal=null,listFailure=null,listRole=null;
  const shared=w.TokiShared={enabled:true,companyAccess:true,online:true,pendingCode:'',user:{id:'self',email:'current@example.test'},company:{id:'a',name:'Company A',code:'a'.repeat(32),role:'admin'},companies:[],
    async listCompanies(){calls.push(['list']);if(listFailure)throw listFailure;if(listRole)shared.company.role=listRole;ui.render();},
    async manage(action,params){
      calls.push([action,params]);if(action==='members')return {members,invites:[]};
      if(action==='role'||action==='block'){
        if(roleChange)await roleChange.promise;if(roleFailure)throw roleFailure;
        const member=members.find(m=>m.id===params.p_member);
        if(action==='role')member.role=params.p_role;else member.status='blocked';
        shared.company={...shared.company,role:members.find(m=>m.id==='self').role};ui.render();return {};
      }
      if(action==='remove_member'){if(removal)await removal.promise;members.splice(members.findIndex(m=>m.id===params.p_member),1);return {};}
    },
    leaveView(){shared.company=null;ui.render();},async logout(){shared.company=null;shared.user=null;ui.render();},
  };
  w.eval(fs.readFileSync(sourcePath('company-ui.js'),'utf8'));const ui=w.TokiCompanyUI();ui.render();
  return {w,$,shared,calls,members,ui,set roleChange(v){roleChange=v;},set roleFailure(v){roleFailure=v;},set removal(v){removal=v;},set listFailure(v){listFailure=v;},set listRole(v){listRole=v;},open:()=>$('company-button').onclick(),memberButton(email,label){const row=[...$('company-members').children].find(r=>r.querySelector('span').textContent===email);return [...row.querySelectorAll('button')].find(b=>b.textContent===label);}};
}
test('account refresh exposes per-member role controls only to current admins and renders names safely',async t=>{
  const e=environment(t);await e.open();
  assert.equal(e.$('company-admin').hidden,false);
  assert.equal(e.$('company-transfer-target'),null);assert.doesNotMatch(e.$('company-dialog').textContent,/管理者権限の譲渡/);
  assert.ok(e.memberButton('next@example.test','管理者に変更'));assert.ok(e.memberButton('current@example.test','一般メンバーに変更'));
  assert.equal(e.memberButton('pending@example.test','管理者に変更'),undefined);assert.equal(e.memberButton('blocked@example.test','管理者に変更'),undefined);
  assert.equal(e.$('company-members').querySelector('img'),null);
  e.$('company-dialog').close();e.listRole='member';await e.open();
  assert.equal(e.$('company-admin').hidden,true);assert.equal(e.calls.filter(c=>c[0]==='members').length,1);
});
test('promotion changes only the selected member, suppresses duplicates, and self-demotion is separate',async t=>{
  const e=environment(t);await e.open();let confirmations=0;e.w.confirm=message=>{confirmations++;assert.match(message,/next@example.testを管理者/);assert.match(message,/他の参加者の権限は変わりません/);return true;};
  const d=deferred();e.roleChange=d;const button=e.memberButton('next@example.test','管理者に変更');
  const pending=button.onclick();await button.onclick();
  assert.equal(e.$('company-admin-controls').disabled,true);assert.equal(e.calls.filter(c=>c[0]==='role').length,1);assert.equal(confirmations,1);
  d.resolve();await pending;assert.equal(e.shared.company.role,'admin');assert.equal(e.members[1].role,'admin');assert.equal(e.members[2].role,'admin');
  assert.ok(e.memberButton('next@example.test','一般メンバーに変更'));
  e.w.confirm=message=>{assert.match(message,/current@example.testを一般メンバー/);return true;};
  await e.memberButton('current@example.test','一般メンバーに変更').onclick();
  assert.equal(e.shared.company.role,'member');assert.equal(e.$('company-admin').hidden,true);
  assert.equal(e.$('company-admin-controls').disabled,true);assert.equal(e.$('company-admin-status').textContent,'一般メンバー');
  assert.deepEqual(e.calls.filter(c=>c[0]==='role').map(c=>[c[1].p_member,c[1].p_role]),[['next','admin'],['self','member']]);
});
test('last-admin rejection is focused above the list for both demotion and blocking',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;
  // The displayed list still contains another admin; the server's latest state must win.
  e.roleFailure=Object.assign(new Error('最後の管理者は解除できません。先に別の管理者を設定してください。'),{code:'LAST_ADMIN'});
  for(const label of ['一般メンバーに変更','アクセスを停止']){
    await e.memberButton('current@example.test',label).onclick();
    assert.match(e.$('company-admin-error').textContent,/最後の管理者/);assert.equal(e.w.document.activeElement,e.$('company-admin-error'));
    assert.ok(e.$('company-admin-error').compareDocumentPosition(e.$('company-members'))&e.w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(e.shared.company.role,'admin');assert.equal(e.members[0].status,'active');assert.equal(e.$('company-admin-controls').disabled,false);
  }
  e.roleFailure=null;await e.memberButton('next@example.test','管理者に変更').onclick();assert.equal(e.$('company-admin-error').textContent,'');
});
test('closing the dialog during a failed change prevents stale errors and focus changes',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;const d=deferred();e.roleChange=d;
  const pending=e.memberButton('next@example.test','管理者に変更').onclick();e.$('company-dialog').close();d.reject(new Error('Failed'));await pending;
  assert.equal(e.$('company-dialog').open,false);assert.equal(e.$('company-admin-status').textContent,'');
  assert.equal(e.$('company-admin-error').textContent,'');assert.equal(e.$('company-members').textContent,'');
});
test('offline permission failures leave clear guidance without enabled admin controls',async t=>{
  const e=environment(t);e.listFailure=new Error('Offline');e.shared.online=false;await e.open();await tick();
  assert.equal(e.$('company-admin').hidden,true);assert.equal(e.$('company-admin-controls').disabled,true);assert.match(e.$('company-admin-error').textContent,/Offline/);
  assert.equal(e.$('company-dialog-logout').disabled,false);
});

test('cancelled, stale, offline and no-longer-admin role controls send no mutation',async t=>{
  const e=environment(t);await e.open();const button=e.memberButton('next@example.test','管理者に変更');
  e.w.confirm=()=>false;await button.onclick();
  e.w.confirm=()=>{assert.fail('Unavailable control must not ask for confirmation');};
  e.shared.online=false;await button.onclick();e.shared.online=true;
  e.shared.company.role='member';await button.onclick();e.shared.company.role='admin';
  e.$('company-dialog').close();await e.open();await button.onclick();
  assert.equal(e.calls.some(c=>c[0]==='role'),false);
});
test('network errors explain uncertain role outcomes without claiming success',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;e.roleFailure=Object.assign(new Error('Failed'),{code:'NETWORK'});
  await e.memberButton('next@example.test','管理者に変更').onclick();assert.match(e.$('company-admin-error').textContent,/変更結果を確認できません/);assert.equal(e.shared.company.role,'admin');assert.equal(e.members[1].role,'member');
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
  assert.match(e.$('company-members').textContent,/blocked@example.test/);assert.match(e.$('company-admin-error').textContent,/変更結果を確認できません/);assert.equal(e.$('company-admin-controls').disabled,false);
});

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
  return {w,$,shared,calls,members,ui,set roleChange(v){roleChange=v;},set roleFailure(v){roleFailure=v;},set removal(v){removal=v;},set listFailure(v){listFailure=v;},set listRole(v){listRole=v;},open:()=>$('company-button').onclick(),memberButton(email,label){const row=[...w.document.querySelectorAll('#company-admins .company-member,#company-members .company-member,#company-pending .company-member')].find(r=>r.querySelector('.company-member-id span').textContent===email);return row&&[...row.querySelectorAll('button')].find(b=>b.textContent===label);}};
}

test('the sign-in gate hides the join form, preserves an incoming link, and lists organizations first',async t=>{
  const e=environment(t),user=e.shared.user,code='A'.repeat(32);
  let loginCode;
  e.$('auth-gate').hidden=false;
  e.shared.user=null;e.shared.company=null;e.shared.pendingCode=code;
  e.shared.login=async value=>{loginCode=value;};
  e.ui.render();
  assert.equal(e.$('company-login').hidden,false);
  assert.equal(e.$('company-code').closest('[hidden]').id,'company-signed-in');
  assert.equal(e.$('company-code').value,'');
  await e.$('company-login').onclick();
  assert.equal(loginCode,code);

  e.shared.user=user;
  e.shared.companies=[{id:'test',name:'Test organization',status:'active'}];
  e.ui.render();
  assert.equal(e.$('company-login').hidden,true);
  assert.equal(e.$('company-code').closest('[hidden]'),null);
  assert.equal(e.$('company-code').value,code);
  assert.match(e.$('company-list').textContent,/Test organization/);
  assert.ok(e.$('company-list').compareDocumentPosition(e.$('company-code'))&e.w.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('join screen requires exactly one entry method and submits the corresponding input',async t=>{
  const e=environment(t),submissions=[];
  e.shared.join=async (code,options)=>submissions.push({code,...options});
  e.$('company-code').value='A'.repeat(32);
  e.$('company-code').oninput();
  assert.equal(e.$('company-join').disabled,true);
  e.$('company-entry').querySelector('[value="invite"]').click();
  assert.equal(e.$('company-entry-name-field').hidden,true);
  const password=e.$('company-entry-password');
  password.value='00009';password.oninput();
  assert.equal(e.$('company-join').disabled,true);
  password.value='000090';password.oninput();
  assert.equal(e.$('company-join').disabled,false);
  await e.$('company-join').onclick();
  e.$('company-entry').querySelector('[value="apply"]').click();
  assert.equal(e.$('company-entry-password-field').hidden,true);
  const name=e.$('company-entry-name');
  name.value='Applicant';name.oninput();
  await e.$('company-join').onclick();
  assert.deepEqual(submissions.map(input=>[input.mode,input.name,input.password]),[['invite','','000090'],['apply','Applicant','']]);
});
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
  const e=environment(t);await e.open();let confirmations=0;e.w.confirm=message=>{confirmations++;assert.match(message,/next@example.testを管理者/);return true;};
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
test('last-admin rejection is focused and the only administrator cannot be demoted',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;
  // The displayed list still contains another admin; the server's latest state must win.
  e.roleFailure=Object.assign(new Error('最後の管理者は解除できません。先に別の管理者を設定してください。'),{code:'LAST_ADMIN'});
  await e.memberButton('current@example.test','一般メンバーに変更').onclick();
  assert.match(e.$('company-admin-error').textContent,/最後の管理者/);assert.equal(e.w.document.activeElement,e.$('company-admin-error'));
  assert.ok(e.$('company-admin-error').compareDocumentPosition(e.$('company-admins'))&e.w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(e.shared.company.role,'admin');assert.equal(e.members[0].status,'active');assert.equal(e.$('company-admin-controls').disabled,false);
  e.members.find(member=>member.id==='admin').role='member';
  await e.open();assert.equal(e.memberButton('current@example.test','一般メンバーに変更').disabled,true);
  e.roleFailure=null;await e.memberButton('next@example.test','管理者に変更').onclick();
  assert.equal(e.$('company-admin-error').textContent,'');assert.equal(e.memberButton('current@example.test','一般メンバーに変更').disabled,false);
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
  const e=environment(t);await e.open();const buttons=[...e.$('company-members').querySelectorAll('button')].filter(b=>b.textContent==='削除'&&!b.disabled);
  assert.equal(buttons.length,1);assert.match(buttons[0].parentElement.textContent,/blocked@example.test/);
  e.w.confirm=message=>{assert.match(message,/blocked@example.test/);assert.match(message,/予定表の行・可能時間・MTGは残ります/);assert.match(message,/再参加には改めて招待・承認/);return false;};
  await buttons[0].onclick();assert.equal(e.calls.some(c=>c[0]==='remove_member'),false);
  e.$('company-dialog').close();e.listRole='member';await e.open();assert.equal(e.$('company-admin').hidden,true);assert.equal(e.$('company-members').textContent,'');
});
test('confirmed removal is submitted once and the removed member disappears from the refreshed list',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;const button=e.memberButton('blocked@example.test','削除');
  const d=deferred();e.removal=d;const pending=button.onclick();await button.onclick();assert.equal(e.$('company-admin-controls').disabled,true);
  assert.equal(e.calls.filter(c=>c[0]==='remove_member').length,1);assert.equal(e.calls.find(c=>c[0]==='remove_member')[1].p_member,'blocked');
  d.resolve();await pending;assert.doesNotMatch(e.$('company-members').textContent,/blocked@example.test/);assert.match(e.$('company-members').textContent,/next@example.test/);assert.equal(e.$('company-admin-controls').disabled,false);
});
test('failed removal keeps the row and describes an uncertain network outcome',async t=>{
  const e=environment(t);await e.open();e.w.confirm=()=>true;const button=e.memberButton('blocked@example.test','削除');
  const d=deferred();e.removal=d;const pending=button.onclick();d.reject(Object.assign(new Error('Failed'),{code:'NETWORK'}));await pending;
  assert.match(e.$('company-members').textContent,/blocked@example.test/);assert.match(e.$('company-admin-error').textContent,/変更結果を確認できません/);assert.equal(e.$('company-admin-controls').disabled,false);
});

test('the account keeps its active organization separate and opens another approved organization directly',async t=>{
  const e=environment(t);
  const initial={...e.shared.company,status:'active'},other={id:'b',name:'Organization B',role:'member',status:'active'};
  e.shared.companies=[initial,other,{id:'pending',name:'Pending organization',role:'member',status:'pending'}];
  const selected=[];
  e.shared.selectCompany=async id=>{selected.push(id);e.shared.company=e.shared.companies.find(entry=>entry.id===id);};
  await e.open();
  assert.equal(e.$('company-dialog-title').textContent,'アカウント');
  assert.match(e.$('company-dialog-user').textContent,/ログイン中：current@example.test/);
  assert.equal(e.$('company-admin').open,false);
  assert.equal(e.$('company-organization-picker').open,false);
  assert.match(e.$('company-organization-summary').textContent,/Company A（管理者）/);
  assert.match(e.$('company-other-organizations').textContent,/Organization B（一般）/);
  assert.doesNotMatch(e.$('company-other-organizations').textContent,/Pending organization/);
  await e.$('company-other-organizations').querySelector('button').onclick();
  assert.deepEqual(selected,['b']);
  assert.equal(e.$('company-dialog').open,false);
});

test('a mail link reveals the requested review and rejects it only after an authorized button click',async t=>{
  const e=environment(t);
  e.shared.company.managementWorkflows=true;
  let linked={organization:'a',id:'batch'},state='pending';
  e.shared.reviewLink=()=>linked;
  e.shared.clearReviewLink=()=>{linked=null;};
  e.w.requestAnimationFrame=callback=>callback();
  const manage=e.shared.manage;
  e.shared.manage=async(action,params)=>{
    if(action==='review_list')return {reviews:[{
      id:'batch',day:'2026-11-24',state,canReject:state==='pending',deadline:'2026-11-26T09:00:00+09:00',
      items:[{id:'new-pin',summary:'招待を発行',state}]
    }],renames:[]};
    if(action==='review_reject'){e.calls.push([action,params]);state='rejected';return {};}
    return manage(action,params);
  };
  await e.open();
  const panel=e.$('company-review-actions').querySelector('details');
  assert.equal(panel.open,true);
  assert.equal(linked,null);
  assert.ok(e.calls.every(call=>call[0]!=='review_reject'));
  await panel.querySelector('button').onclick();
  assert.deepEqual(e.calls.filter(call=>call[0]==='review_reject').map(call=>call[1].p_member),['batch']);
  assert.match(e.$('company-review-actions').textContent,/拒否済み/);
});

test('numbered member and guest invitations share group-only choices and remove cancelled text in place',async t=>{
  const e=environment(t),groups=[{id:'g',name:'Long group name'}],pins=[],guests=[],submitted=[];
  const mint=(names,field,kind)=>names.map(({name,groups},index)=>({id:kind+index,name,groupIds:[...groups],[field]:'test-'+kind+index}));
  e.shared.shareUrl=()=> 'https://example.test/TOKI/';
  e.shared.guestUrl=ticket=>'https://example.test/TOKI/?guest=test#invite='+ticket;
  e.shared.manage=async(action,params)=>{
    if(action==='members')return {groups,members:e.members,invites:[],pinInvites:pins};
    if(action==='invite_batch'){
      submitted.push([action,JSON.parse(JSON.stringify(params.p_payload))]);
      pins.push(...mint(params.p_payload,'password','pin'));return {invitations:[...pins]};
    }
    if(action==='cancel_pin_invite'){pins.splice(pins.findIndex(pin=>pin.id===params.p_member),1);return {};}
  };
  e.shared.guestAdmin=async(action,params)=>{
    if(action==='list')return {groups,guests};
    if(action==='issue_batch'){
      submitted.push([action,JSON.parse(JSON.stringify(params.p_access))]);
      guests.push(...mint(params.p_access,'ticket','guest').map(guest=>({...guest,unusedLink:true,devices:0})));
      return {invitations:[...guests]};
    }
    if(action==='revoke'){guests.splice(guests.findIndex(guest=>guest.id===params.p_guest),1);return {};}
  };
  await e.open();e.w.confirm=()=>true;e.$('company-admin').open=true;
  for(const [prefix,choices,names,result] of [
    ['company-invite','company-invite-groups','company-invite-names','company-issued-messages'],
    ['company-guest','company-guest-choices','company-guest-name','company-guest-messages']
  ]){
    e.$(prefix+'-prefix').value='ID';e.$(prefix+'-from').value='00';e.$(prefix+'-to').value='01';
    e.$(prefix+'-series').onclick();
    assert.equal(e.$(names).value,'ID00\nID01');
    const label=e.$(choices).querySelector('label');
    assert.equal(label.firstElementChild.type,'checkbox');
    assert.equal(label.lastElementChild.textContent,'Long group name');
    label.firstElementChild.click();
    if(prefix==='company-invite')await e.$('company-issue-pins').onclick();
    else await e.$('company-guest-form').onsubmit({preventDefault(){}});
    assert.deepEqual([...e.$(result).querySelectorAll('textarea')].map(node=>node.value.split('さん')[0]),['ID00','ID01']);
  }
  assert.deepEqual(submitted,[
    ['invite_batch',[{name:'ID00',groups:['g']},{name:'ID01',groups:[]}]],
    ['issue_batch',[{name:'ID00',groups:['g']},{name:'ID01',groups:[]}]]
  ]);
  e.$('company-dialog').scrollTop=380;
  await e.$('company-unused-pins').querySelector('button').onclick();
  const guestCancel=[...e.$('company-guests').querySelectorAll('button')].find(button=>button.textContent==='招待を取り消す');
  await guestCancel.onclick();
  assert.doesNotMatch(e.$('company-issued-messages').textContent,/ID00/);
  assert.doesNotMatch(e.$('company-guest-messages').textContent,/ID00/);
  assert.match(e.$('company-guest-messages').textContent,/ID01/);
  assert.equal(e.$('company-dialog').scrollTop,380);
  assert.equal(e.$('company-admin').open,true);
});

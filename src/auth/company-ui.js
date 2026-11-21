"use strict";
window.TokiCompanyUI=()=>{
  const shared=window.TokiShared,$=id=>document.getElementById(id);
  let pending=false,last='',view=0,entryUser=null,issued=[],inviteGroups=[];
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const button=(text,run)=>{const b=el('button',text);b.type='button';b.onclick=run;return b;};
  const entryMode=()=>$('company-entry').querySelector('input[type="radio"]:checked')?.value;
  function updateEntry(){
    const mode=entryMode(),pin=$('company-entry-password'),name=$('company-entry-name');
    $('company-entry-password-field').hidden=mode!=='invite';pin.disabled=mode!=='invite';
    $('company-entry-name-field').hidden=mode!=='apply';name.disabled=mode!=='apply';
    $('company-join').textContent=mode==='invite'?'予定表に参加':mode==='apply'?'参加申請を送信':'次へ';
    const validInput=mode==='invite'?/^[0-9]{6}$/.test(pin.value):mode==='apply'&&name.value.trim();
    $('company-join').disabled=pending||!validInput||!$('company-code').value.trim();
  }
  async function run(fn){if(pending)return;pending=true;$('company-error').textContent='';try{await fn();}catch(e){$('company-error').textContent=e.message;$('auth-message').textContent=e.message;}finally{pending=false;last='';render();}}
  function render(){
    if(!shared.enabled||!shared.companyAccess)return;
    const user=shared.user,company=shared.company,list=shared.companies;
    $('company-access').hidden=false;$('company-login').hidden=Boolean(user);$('company-signed-in').hidden=!user;
    $('company-current-user').textContent=user?.email||'';
    if((user?.id??null)!==entryUser){
      entryUser=user?.id??null;
      $('company-entry-password').value='';$('company-entry-name').value='';
      $('company-entry').querySelectorAll('input[type="radio"]').forEach(radio=>{radio.checked=false;});
    }
    $('company-button').hidden=!company;$('company-button').title=company?'組織・アカウント（'+company.name+'）':'組織・アカウント';
    if(company?.role!=='admin')clearAdmin();
    if(!company)$('company-admin-status').textContent='';
    $('company-entry').hidden=!user;$('company-entry').disabled=pending;$('company-code').disabled=pending;
    if(!user&&!$('company-code').value)$('company-code').value=shared.pendingCode;
    if(user&&!$('company-code').value&&shared.pendingCode)$('company-code').value=shared.pendingCode;
    updateEntry();
    const signature=JSON.stringify([user?.id,company?.id,list,pending]);if(last===signature)return;last=signature;
    const container=$('company-list');container.replaceChildren();
    for(const c of list){const row=el('div');row.className='company-choice';row.append(el('strong',c.name));
      if(c.status==='active')row.append(button('予定表を開く',()=>run(()=>shared.selectCompany(c.id))));
      else row.append(el('span',c.status==='pending'?'管理者の承認待ち':'参加が許可されていません'));
      container.append(row);
    }
    $('company-login').disabled=pending;
    if(user&&!company)$('auth-message').textContent=list.some(c=>c.status==='active')?'開く組織を選んでください。':'組織コードで参加申請するか、管理者からの招待をご確認ください。';
    else if(!user)$('auth-message').textContent='Googleで本人確認後、招待・承認済みの組織だけにアクセスできます。';
  }
  $('company-login').onclick=()=>run(()=>shared.login($('company-code').value));
  $('company-code').oninput=updateEntry;
  $('company-entry').onchange=updateEntry;
  for(const id of ['company-entry-password','company-entry-name'])$(id).oninput=updateEntry;
  $('company-join').onclick=()=>run(async()=>{
    const mode=entryMode();
    if(!mode)return;
    $('company-entry').disabled=true;$('company-code').disabled=true;
    await shared.join($('company-code').value,{mode,name:$('company-entry-name').value,password:$('company-entry-password').value});
    $('company-entry-password').value='';$('company-entry-name').value='';
  });
  $('company-refresh').onclick=()=>run(()=>shared.listCompanies());
  $('company-logout').onclick=()=>run(()=>shared.logout());
  function showAdminError(message){
    const error=$('company-admin-error');error.textContent=message;error.focus();
  }
  function clearAdmin(){
    $('company-admin').hidden=true;$('company-admin-controls').disabled=true;
    $('company-members').replaceChildren();$('company-invites').replaceChildren();
    $('company-unused-pins').replaceChildren();
    if(shared.company?.role!=='admin')clearInvitationForm();
  }
  function groupChoices(groups,selected=[]){
    const fieldset=el('fieldset');fieldset.className='company-group-choices';
    fieldset.append(el('legend','閲覧を許可するグループ'));
    if(!groups.length)fieldset.append(el('p','選択できるグループはありません。'));
    for(const group of groups){
      const label=el('label'),box=el('input');
      box.type='checkbox';box.value=group.id;box.checked=selected.includes(group.id);
      label.append(box,document.createTextNode(group.name));fieldset.append(label);
    }
    return fieldset;
  }
  const chosenGroups=parent=>[...parent.querySelectorAll('input:checked')].map(input=>input.value);
  function addMemberSettings(row,member,groups,action){
    const settings=el('div');settings.className='company-member-settings';
    if(!member.personId){
      const label=el('label','予定表の表示名 '),name=el('input');
      name.type='text';name.maxLength=40;name.autocomplete='off';name.value=member.requestName||'';label.append(name);
      const text=member.status==='active'?'人の行を作成':member.status==='pending'?'参加を承認':'参加を再許可';
      const choices=member.status==='pending'?groupChoices(groups):null;
      settings.append(label);
      if(choices)settings.append(choices);
      settings.append(button(text,()=>{
        if(!name.value.trim()){showAdminError('予定表の表示名を入力してください。');name.focus();return;}
        return action(member.status==='active'?'assign_person':'approve',{
          p_member:member.id,p_name:name.value,...(choices&&{p_payload:chosenGroups(choices)})
        });
      }));
    }
    if(member.status==='active'&&member.role==='member'){
      const details=el('details'),fieldset=groupChoices(groups,member.groupIds);
      details.append(el('summary','閲覧できるグループ'));
      details.append(fieldset,button('閲覧権限を保存',()=>action('set_group_access',{
        p_member:member.id,p_payload:chosenGroups(fieldset),
      })));
      settings.append(details);
    }
    row.append(settings);
  }
  function clearInvitationForm(){
    issued=[];inviteGroups=[];$('company-invite-names').value='';
    $('company-invite-groups').replaceChildren();$('company-issued-messages').replaceChildren();
    $('company-issued-pins').hidden=true;$('company-pin-status').textContent='';
  }
  function invitationNames(){return $('company-invite-names').value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);}
  function renderInvitationGroups(){
    const list=$('company-invite-groups'),selected=new Map([...list.children].map(node=>[node.dataset.name,chosenGroups(node)]));
    list.replaceChildren();
    for(const name of invitationNames().slice(0,30)){
      const row=el('details');row.dataset.name=name;
      const groups=selected.get(name)||[];
      const heading=el('summary',name+'の閲覧グループ');
      const choices=groupChoices(inviteGroups,groups);
      const showCount=()=>{heading.textContent=name+'の閲覧グループ（'+chosenGroups(row).length+'）';};
      row.append(heading,choices);row.onchange=showCount;showCount();list.append(row);
    }
  }
  async function copyPins(text){
    try{await navigator.clipboard.writeText(text);$('company-pin-status').textContent='コピーしました。';}
    catch{$('company-pin-status').textContent='コピーできませんでした。文面を選択してコピーしてください。';}
  }
  function renderIssued(company){
    const list=$('company-issued-messages');list.replaceChildren();
    $('company-issued-pins').hidden=!issued.length;
    for(const [index,invite] of issued.entries()){
      const label=el('label',invite.name),message=el('textarea');message.id='company-invite-message-'+index;
      label.htmlFor=message.id;message.readOnly=true;message.rows=5;
      message.value=`${invite.name}さん、${company.name}からTOKIへの招待です。\n${shared.shareUrl()}\n組織コード：${company.code}\n招待パスワード：${invite.password}\nGoogleでログイン後、「招待パスワードで参加」を選んでください。`;
      list.append(label,message,button(invite.name+'の招待をコピー',()=>copyPins(message.value)));
    }
  }
  $('company-invite-names').oninput=renderInvitationGroups;
  $('company-copy-pins').onclick=()=>copyPins([...$('company-issued-messages').querySelectorAll('textarea')].map(n=>n.value).join('\n\n'));
  const sameView=(companyId,userId,generation)=>$('company-dialog').open&&shared.company?.id===companyId&&shared.user?.id===userId&&view===generation;
  const adminBusy=value=>{pending=value;$('company-admin-controls').disabled=value||shared.company?.role!=='admin'||!shared.online;};
  async function adminList(){
    const company=shared.company,d=$('company-dialog');if(!company)return;
    const identity=shared.user.id,generation=++view,current=()=>sameView(company.id,identity,generation);
    $('company-dialog-title').textContent=company.name;$('company-dialog-code').textContent=company.code;$('company-dialog-user').textContent=shared.user.email;
    clearAdmin();$('company-admin-error').textContent='';$('company-admin-status').textContent='権限を確認中…';
    if(!d.open)d.showModal();
    try{
      await shared.listCompanies();if(!current())return;
      if(shared.company.role!=='admin'){$('company-admin-status').textContent='一般メンバー';return;}
      const data=await shared.manage('members');if(!current()||shared.company.role!=='admin')return;
      const scoped=Array.isArray(data.groups);
      const batchEnabled=scoped&&Array.isArray(data.pinInvites);
      $('company-pin-invites').hidden=!batchEnabled;
      $('company-legacy-invite').hidden=batchEnabled;
      if(batchEnabled){inviteGroups=data.groups;renderInvitationGroups();renderIssued(company);}
      $('company-invite-name-label').hidden=!scoped;$('company-invite-name').hidden=!scoped;
      $('company-admin-status').textContent='組織の管理者';$('company-admin').hidden=false;adminBusy(pending);
      const action=async(kind,params)=>{
        if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;
        adminBusy(true);$('company-admin-error').textContent='';
        try{await shared.manage(kind,params);if(current())await adminList();}
        catch(e){if(current())showAdminError(e.code==='NETWORK'&&['remove_member','role','block'].includes(kind)
          ?'変更結果を確認できませんでした。接続を確認し、アカウント画面を開き直して参加者一覧を確認してください。':e.message);}
        finally{adminBusy(false);}
      };
      for(const m of data.members){const row=el('div');row.className='company-member';row.append(el('strong',m.name),el('span',m.email),el('small',({pending:'承認待ち',active:m.role==='admin'?'管理者':'メンバー',blocked:'アクセス停止'})[m.status]));
        if(m.status!=='active'){
          if(!scoped||m.personId)row.append(button(m.status==='pending'?'参加を承認':'参加を再許可',()=>action('approve',{p_member:m.id})));
        }
        else {const demote=m.role==='admin';row.append(button(demote?'一般メンバーに変更':'管理者に変更',()=>{
          if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;
          if(confirm(m.email+'を'+(demote?'一般メンバー':'管理者')+'に変更しますか？\n'+(demote?'対象者は、この組織の管理操作ができなくなります。':'他の参加者の権限は変わりません。')))return action('role',{p_member:m.id,p_role:demote?'member':'admin'});
        }));}
        if(m.status!=='blocked')row.append(button('アクセスを停止',()=>{if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;if(confirm(m.email+'の組織へのアクセスを停止しますか？端末のオフラインデータは即時には消去できません。'))return action('block',{p_member:m.id});}));
        else {
          const remove=button('組織から削除',()=>{if(pending||!current())return;if(confirm(m.email+' を「'+company.name+'」の参加者一覧から削除しますか？\n予定表の人の行・可能時間・MTGは残ります。\nアクセス停止の記録も削除され、再参加には改めて招待・承認が必要です。'))return action('remove_member',{p_member:m.id});});
          remove.className='danger';row.append(remove);
        }
        if(scoped&&(!m.personId||m.status==='active'&&m.role==='member'))addMemberSettings(row,m,data.groups,action);
        $('company-members').append(row);
      }
      for(const invite of data.invites){const row=el('div');row.className='company-choice';row.append(el('span',(invite.displayName?invite.displayName+' · ':'')+invite.email+(Date.parse(invite.expiresAt)<=Date.now()?'（期限切れ）':'（招待済み）')),button('招待を取り消す',()=>action('cancel_invite',{p_email:invite.email})));$('company-invites').append(row);}
      for(const invite of data.pinInvites||[]){
        const row=el('div');row.className='company-choice';
        const groups=data.groups.filter(group=>invite.groupIds.includes(group.id)).map(group=>group.name);
        row.append(el('span',invite.name+(groups.length?'（'+groups.join('、')+'）':'')),
          button('招待を取り消す',()=>action('cancel_pin_invite',{p_member:invite.id})));
        $('company-unused-pins').append(row);
      }
    }catch(e){if(current()){$('company-admin-status').textContent='権限を確認できませんでした';showAdminError(e.message);}}
  }
  $('company-button').onclick=adminList;
  $('company-dialog-close').onclick=()=>$('company-dialog').close();
  $('company-dialog').addEventListener('close',()=>{view++;clearAdmin();clearInvitationForm();$('company-admin-status').textContent='';$('company-admin-error').textContent='';});
  $('company-switch').onclick=()=>{$('company-dialog').close();shared.leaveView();};
  $('company-dialog-logout').onclick=()=>{$('company-dialog').close();run(()=>shared.logout());};
  $('company-issue-pins').onclick=async()=>{
    const company=shared.company,generation=view,identity=shared.user?.id;
    if(pending||company?.role!=='admin'||!shared.online)return;
    const names=invitationNames();
    if(!names.length||names.length>30||names.some(name=>name.length>40)){
      showAdminError('1〜30人の表示名を、1行に1人、40文字以内で入力してください。');return;
    }
    const rows=[...$('company-invite-groups').children];
    const batch=names.map((name,i)=>({name,groups:chosenGroups(rows[i])}));
    adminBusy(true);$('company-admin-error').textContent='';
    try{
      const result=await shared.manage('invite_batch',{p_payload:batch});
      if(sameView(company.id,identity,generation)&&shared.company.role==='admin'){
        issued=result.invitations;$('company-invite-names').value='';
        renderInvitationGroups();renderIssued(company);await adminList();
      }
    }catch(e){if(sameView(company.id,identity,generation))showAdminError(e.message);}
    finally{adminBusy(false);}
  };
  $('company-invite-button').onclick=async()=>{
    if(pending||shared.company?.role!=='admin')return;
    const companyId=shared.company.id,identity=shared.user.id,generation=view;
    const name=$('company-invite-name'),params={p_email:$('company-invite-email').value};
    if(!name.hidden){
      if(!name.value.trim()){showAdminError('予定表の表示名を入力してください。');name.focus();return;}
      params.p_name=name.value;
    }
    adminBusy(true);$('company-admin-error').textContent='';
    try{
      await shared.manage('invite',params);
      if(sameView(companyId,identity,generation)){$('company-invite-email').value='';name.value='';await adminList();}
    }catch(e){if(sameView(companyId,identity,generation))showAdminError(e.message);}
    finally{adminBusy(false);}
  };
  return {render};
};

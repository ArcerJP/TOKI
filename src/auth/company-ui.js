"use strict";
window.TokiCompanyUI=()=>{
  const shared=window.TokiShared,$=id=>document.getElementById(id);
  let pending=false,last='',view=0;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const button=(text,run)=>{const b=el('button',text);b.type='button';b.onclick=run;return b;};
  async function run(fn){if(pending)return;pending=true;$('company-error').textContent='';try{await fn();}catch(e){$('company-error').textContent=e.message;$('auth-message').textContent=e.message;}finally{pending=false;last='';render();}}
  function render(){
    if(!shared.enabled||!shared.companyAccess)return;
    const user=shared.user,company=shared.company,list=shared.companies;
    $('company-access').hidden=false;$('company-login').hidden=Boolean(user);$('company-signed-in').hidden=!user;
    $('company-current-user').textContent=user?.email||'';
    $('company-button').hidden=!company;$('company-button').title=company?'会社・アカウント（'+company.name+'）':'会社・アカウント';
    if(company?.role!=='admin')clearAdmin();
    if(!company)$('company-admin-status').textContent='';
    $('company-join').hidden=!user;$('company-code').disabled=pending;
    if(!user&&!$('company-code').value)$('company-code').value=shared.pendingCode;
    if(user&&!$('company-code').value&&shared.pendingCode)$('company-code').value=shared.pendingCode;
    const signature=JSON.stringify([user?.id,company?.id,list,pending]);if(last===signature)return;last=signature;
    const container=$('company-list');container.replaceChildren();
    for(const c of list){const row=el('div');row.className='company-choice';row.append(el('strong',c.name));
      if(c.status==='active')row.append(button('予定表を開く',()=>run(()=>shared.selectCompany(c.id))));
      else row.append(el('span',c.status==='pending'?'管理者の承認待ち':'参加が許可されていません'));
      container.append(row);
    }
    $('company-login').disabled=pending;$('company-join').disabled=pending;
    if(user&&!company)$('auth-message').textContent=list.some(c=>c.status==='active')?'開く会社を選んでください。':'会社コードで参加申請するか、管理者からの招待をご確認ください。';
    else if(!user)$('auth-message').textContent='Googleで本人確認後、招待・承認済みの会社だけにアクセスできます。';
  }
  $('company-login').onclick=()=>run(()=>shared.login($('company-code').value));
  $('company-join').onclick=()=>run(()=>shared.join($('company-code').value));
  $('company-refresh').onclick=()=>run(()=>shared.listCompanies());
  $('company-logout').onclick=()=>run(()=>shared.logout());
  function showAdminError(message){
    const error=$('company-admin-error');error.textContent=message;error.focus();
  }
  function clearAdmin(){
    $('company-admin').hidden=true;$('company-admin-controls').disabled=true;
    $('company-members').replaceChildren();$('company-invites').replaceChildren();
  }
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
      $('company-admin-status').textContent='団体の管理者';$('company-admin').hidden=false;adminBusy(pending);
      const action=async(kind,params)=>{
        if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;
        adminBusy(true);$('company-admin-error').textContent='';
        try{await shared.manage(kind,params);if(current())await adminList();}
        catch(e){if(current())showAdminError(e.code==='NETWORK'&&['remove_member','role','block'].includes(kind)
          ?'変更結果を確認できませんでした。接続を確認し、アカウント画面を開き直して参加者一覧を確認してください。':e.message);}
        finally{adminBusy(false);}
      };
      for(const m of data.members){const row=el('div');row.className='company-member';row.append(el('strong',m.name),el('span',m.email),el('small',({pending:'承認待ち',active:m.role==='admin'?'管理者':'メンバー',blocked:'アクセス停止'})[m.status]));
        if(m.status!=='active')row.append(button(m.status==='pending'?'参加を承認':'参加を再許可',()=>action('approve',{p_member:m.id})));
        else {const demote=m.role==='admin';row.append(button(demote?'一般メンバーに変更':'管理者に変更',()=>{
          if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;
          if(confirm(m.email+'を'+(demote?'一般メンバー':'管理者')+'に変更しますか？\n'+(demote?'対象者は、この団体の管理操作ができなくなります。':'他の参加者の権限は変わりません。')))return action('role',{p_member:m.id,p_role:demote?'member':'admin'});
        }));}
        if(m.status!=='blocked')row.append(button('アクセスを停止',()=>{if(pending||!current()||shared.company.role!=='admin'||!shared.online)return;if(confirm(m.email+'の会社へのアクセスを停止しますか？端末のオフラインデータは即時には消去できません。'))return action('block',{p_member:m.id});}));
        else {const remove=button('団体から削除',()=>{if(pending||!current())return;if(confirm(m.email+' を「'+company.name+'」の参加者一覧から削除しますか？\n予定表の人の行・可能時間・MTGは残ります。\nアクセス停止の記録も削除され、再参加には改めて招待・承認が必要です。'))return action('remove_member',{p_member:m.id});});remove.className='danger';row.append(remove);}
        $('company-members').append(row);
      }
      for(const invite of data.invites){const row=el('div');row.className='company-choice';row.append(el('span',invite.email+(Date.parse(invite.expiresAt)<=Date.now()?'（期限切れ）':'（招待済み）')),button('招待を取り消す',()=>action('cancel_invite',{p_email:invite.email})));$('company-invites').append(row);}
    }catch(e){if(current()){$('company-admin-status').textContent='権限を確認できませんでした';showAdminError(e.message);}}
  }
  $('company-button').onclick=adminList;
  $('company-dialog-close').onclick=()=>$('company-dialog').close();
  $('company-dialog').addEventListener('close',()=>{view++;clearAdmin();$('company-admin-status').textContent='';$('company-admin-error').textContent='';});
  $('company-switch').onclick=()=>{$('company-dialog').close();shared.leaveView();};
  $('company-dialog-logout').onclick=()=>{$('company-dialog').close();run(()=>shared.logout());};
  $('company-invite-button').onclick=async()=>{if(pending||shared.company?.role!=='admin')return;const companyId=shared.company.id,identity=shared.user.id,generation=view;adminBusy(true);$('company-admin-error').textContent='';try{await shared.manage('invite',{p_email:$('company-invite-email').value});if(sameView(companyId,identity,generation)){$('company-invite-email').value='';await adminList();}}catch(e){if(sameView(companyId,identity,generation))showAdminError(e.message);}finally{adminBusy(false);}};
  return {render};
};

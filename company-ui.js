"use strict";
window.TokiCompanyUI=()=>{
  const shared=window.TokiShared,$=id=>document.getElementById(id);
  let pending=false,last='';
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const button=(text,run)=>{const b=el('button',text);b.type='button';b.onclick=run;return b;};
  async function run(fn){if(pending)return;pending=true;$('company-error').textContent='';try{await fn();}catch(e){$('company-error').textContent=e.message;$('auth-message').textContent=e.message;}finally{pending=false;last='';render();}}
  function render(){
    if(!shared.enabled||!shared.companyAccess)return;
    const user=shared.user,company=shared.company,list=shared.companies;
    $('company-access').hidden=false;$('company-login').hidden=Boolean(user);$('company-signed-in').hidden=!user;
    $('company-current-user').textContent=user?.email||'';
    $('company-button').hidden=!company;$('company-button').textContent=company?.name||'会社・アカウント';
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
    $('company-login').disabled=pending;$('company-join').disabled=pending;$('company-create-button').disabled=pending;
    if(user&&!company)$('auth-message').textContent=list.some(c=>c.status==='active')?'開く会社を選んでください。':'会社コードで参加申請するか、管理者からの招待をご確認ください。';
    else if(!user)$('auth-message').textContent='Googleで本人確認後、招待・承認済みの会社だけにアクセスできます。';
  }
  $('company-login').onclick=()=>run(()=>shared.login($('company-code').value));
  $('company-join').onclick=()=>run(()=>shared.join($('company-code').value));
  $('company-refresh').onclick=()=>run(()=>shared.listCompanies());
  $('company-logout').onclick=()=>run(()=>shared.logout());
  $('company-create-button').onclick=()=>run(()=>shared.createCompany($('company-new-name').value));
  async function adminList(){
    const company=shared.company,d=$('company-dialog');if(!company)return;
    $('company-dialog-title').textContent=company.name;$('company-dialog-code').textContent=company.code;$('company-dialog-user').textContent=shared.user.email;
    $('company-admin').hidden=company.role!=='admin';$('company-admin-error').textContent='';
    $('company-members').replaceChildren();$('company-invites').replaceChildren();
    if(!d.open)d.showModal();
    if(company.role!=='admin')return;
    try{const data=await shared.manage('members');if(shared.company?.id!==company.id||!d.open)return;
      const action=async(kind,params)=>{if(pending)return;pending=true;try{await shared.manage(kind,params);await adminList();}catch(e){$('company-admin-error').textContent=e.message;}finally{pending=false;}};
      for(const m of data.members){const row=el('div');row.className='company-member';row.append(el('strong',m.name),el('span',m.email),el('small',({pending:'承認待ち',active:m.role==='admin'?'管理者':'メンバー',blocked:'アクセス停止'})[m.status]));
        if(m.status!=='active')row.append(button(m.status==='pending'?'参加を承認':'参加を再許可',()=>action('approve',{p_member:m.id})));
        else {row.append(button(m.role==='admin'?'一般メンバーに変更':'管理者に変更',()=>{if(confirm(m.email+'の権限を変更しますか？'))action('role',{p_member:m.id,p_role:m.role==='admin'?'member':'admin'});}));}
        if(m.status!=='blocked')row.append(button('アクセスを停止',()=>{if(confirm(m.email+'の会社へのアクセスを停止しますか？端末のオフラインデータは即時には消去できません。'))action('block',{p_member:m.id});}));
        $('company-members').append(row);
      }
      for(const invite of data.invites){const row=el('div');row.className='company-choice';row.append(el('span',invite.email+'（招待済み）'),button('招待を取り消す',()=>action('cancel_invite',{p_email:invite.email})));$('company-invites').append(row);}
    }catch(e){$('company-admin-error').textContent=e.message;}
  }
  $('company-button').onclick=adminList;
  $('company-dialog-close').onclick=()=>$('company-dialog').close();
  $('company-switch').onclick=()=>{$('company-dialog').close();shared.leaveView();};
  $('company-dialog-logout').onclick=()=>{$('company-dialog').close();run(()=>shared.logout());};
  $('company-invite-button').onclick=async()=>{if(pending)return;pending=true;try{await shared.manage('invite',{p_email:$('company-invite-email').value});$('company-invite-email').value='';await adminList();}catch(e){$('company-admin-error').textContent=e.message;}finally{pending=false;}};
  return {render};
};

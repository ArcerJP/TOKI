"use strict";
window.TokiCompanyUI=()=>{
  const shared=window.TokiShared,$=id=>document.getElementById(id);
  let pending=false,last='',view=0,entryUser=null,issued=[],issuedGuests=[],inviteGroups=[],extraLink=null;
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
    $('company-current-user').textContent=user?.email?'ログイン中：'+user.email:'';
    if((user?.id??null)!==entryUser){
      entryUser=user?.id??null;
      $('company-add').open=false;
      $('company-code').value='';$('company-entry-password').value='';$('company-entry-name').value='';
      $('company-entry').querySelectorAll('input[type="radio"]').forEach(radio=>{radio.checked=false;});
    }
    $('company-button').hidden=!company;$('company-button').title=company?'アカウント（'+company.name+'）':'アカウント';
    if(company?.role!=='admin')clearAdmin();
    if(!company)$('company-admin-status').textContent='';
    $('company-entry').hidden=!user;$('company-entry').disabled=pending;$('company-code').disabled=pending;
    if(user&&!$('company-code').value&&shared.pendingCode){
      $('company-code').value=shared.pendingCode;
      $('company-add').open=true;
    }
    updateEntry();
    const signature=JSON.stringify([user?.id,company?.id,list,pending]);if(last===signature)return;last=signature;
    const joined=$('company-list'),requests=$('company-entry-status');joined.replaceChildren();requests.replaceChildren();
    for(const c of list){
      const row=el('div');row.className='company-choice';row.append(el('strong',c.name));
      if(c.status==='active'){
        row.append(button('予定を開く',()=>run(()=>shared.selectCompany(c.id))));
        joined.append(row);
      }else{
        row.append(el('span',c.status==='pending'?'管理者の承認待ち':'参加が許可されていません'));
        requests.append(row);
      }
    }
    if(!joined.childElementCount)joined.append(el('p','参加中の組織はありません。'));
    $('company-login').disabled=pending;
    if(user&&!company)$('auth-message').textContent='';
    else if(!user)$('auth-message').textContent='Googleで本人確認後、招待・承認済みの組織だけにアクセスできます。';
  }
  $('company-login').onclick=()=>run(()=>shared.login(shared.pendingCode));
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
    const error=$('company-admin-error');error.textContent=message;error.focus({preventScroll:true});
  }
  function clearAdmin(){
    $('company-admin').hidden=true;$('company-admin-help').hidden=true;$('company-admin-controls').disabled=true;
    for(const id of ['company-admins','company-members','company-pending','company-invites','company-unused-pins','company-guests'])$(id).replaceChildren();
    $('company-guest-section').hidden=true;
    if(shared.company?.role!=='admin')clearCredentials();
  }
  function clearCredentials(){
    issued=[];issuedGuests=[];extraLink=null;inviteGroups=[];
    for(const id of ['company-invite-names','company-guest-name','company-guest-link'])$(id).value='';
    for(const id of ['company-invite-groups','company-guest-choices','company-issued-messages','company-guest-messages'])$(id).replaceChildren();
    for(const id of ['company-issued-pins','company-issued-guests','company-guest-output'])$(id).hidden=true;
    for(const id of ['company-pin-status','company-guests-status','company-guest-copy-status'])$(id).textContent='';
  }
  function groupChoices(groups,selected=[]){
    const field=el('fieldset');field.className='company-group-choices';
    field.append(el('legend','閲覧を許可するグループ'));
    if(!groups.length)field.append(el('small','選択できるグループはありません。'));
    for(const group of groups){
      const label=el('label'),box=el('input');box.type='checkbox';box.value=group.id;box.checked=selected.includes(group.id);
      label.append(box,el('span',group.name));field.append(label);
    }
    return field;
  }
  const chosenGroups=parent=>[...parent.querySelectorAll('input:checked')].map(input=>input.value);
  const forms={
    pins:{names:'company-invite-names',choices:'company-invite-groups',prefix:'company-invite',section:'company-issued-pins',messages:'company-issued-messages',status:'company-pin-status'},
    guests:{names:'company-guest-name',choices:'company-guest-choices',prefix:'company-guest',section:'company-issued-guests',messages:'company-guest-messages',status:'company-guests-status'}
  };
  const invitationNames=form=>$(form.names).value.split(/\r?\n/).map(name=>name.trim()).filter(Boolean);
  function renderChoices(form){
    const list=$(form.choices),selected=new Map([...list.children].map(row=>[row.dataset.name,{groups:chosenGroups(row),open:row.open}]));
    list.replaceChildren();
    for(const name of invitationNames(form).slice(0,100)){
      const row=el('details'),state=selected.get(name),summary=el('summary'),choices=groupChoices(inviteGroups,state?.groups);
      row.dataset.name=name;row.open=Boolean(state?.open);
      row.onchange=()=>summary.textContent=name+'の閲覧グループ（'+chosenGroups(row).length+'）';
      row.append(summary,choices);row.onchange();list.append(row);
    }
  }
  function invitationBatch(form){
    const names=invitationNames(form);
    if(!names.length||names.length>100||names.some(name=>name.length>40))
      throw Error('1〜100人の表示名を、1行に1人、40文字以内で入力してください。');
    return names.map((name,index)=>({name,groups:chosenGroups($(form.choices).children[index])}));
  }
  function addSeries(form){
    const prefix=$(form.prefix+'-prefix').value,start=$(form.prefix+'-from').value.trim(),end=$(form.prefix+'-to').value.trim();
    if(prefix.length>10||!/^[0-9]{1,15}$/.test(start)||!/^[0-9]{1,15}$/.test(end))
      throw Error('接頭辞は10文字以内、開始と終了は数字で入力してください。');
    const first=BigInt(start),last=BigInt(end);
    if(last<first||last-first>=100n)throw Error('連番は開始から終了まで100件以内で指定してください。');
    const width=/^0[0-9]/.test(start)||/^0[0-9]/.test(end)?Math.max(start.length,end.length):1;
    const names=new Set(invitationNames(form));
    for(let value=first;value<=last;value++)names.add(prefix+String(value).padStart(width,'0'));
    if(names.size>100)throw Error('表示名の入力欄には最大100人まで追加できます。');
    $(form.names).value=[...names].join('\n');renderChoices(form);
  }
  async function copyText(text,status,fallback){
    try{await navigator.clipboard.writeText(text);$(status).textContent='コピーしました。';}
    catch{fallback?.focus();fallback?.select();$(status).textContent='文面を選択してコピーしてください。';}
  }
  function renderIssued(form,items,company){
    const list=$(form.messages);
    list.replaceChildren();$(form.section).hidden=!items.length;
    for(const [i,invite] of items.entries()){
      const message=el('textarea'),label=el('label',invite.name);
      message.id=form.messages+'-'+i;label.htmlFor=message.id;message.rows=4;message.readOnly=true;
      message.value=form===forms.pins
        ? [invite.name+'さん、'+company.name+'からTOKIへの招待です。',shared.shareUrl(),
          '組織コード：'+company.code,'招待パスワード：'+invite.password,
          'Googleでログイン後、「招待パスワードで参加」を選んでください。'].join('\n')
        : [invite.name+'さん、'+company.name+'からTOKIへの招待です。',shared.guestUrl(invite.ticket),
          'このリンクでログインせずに参加できます。招待リンクは1回だけ使えます。'].join('\n');
      list.append(label,message,button(invite.name+'の招待をコピー',()=>copyText(message.value,form.status,message)));
    }
  }
  for(const form of Object.values(forms)){
    $(form.names).oninput=()=>renderChoices(form);
    $(form.prefix+'-series').onclick=()=>{try{$('company-admin-error').textContent='';addSeries(form);}catch(e){showAdminError(e.message);}};
  }
  for(const [id,form] of [['company-copy-pins',forms.pins],['company-copy-guests',forms.guests]]){
    $(id).onclick=()=>copyText([...$(form.messages).querySelectorAll('textarea')].map(node=>node.value).join('\n\n'),form.status);
  }
  $('company-copy-guest').onclick=()=>copyText($('company-guest-link').value,'company-guest-copy-status',$('company-guest-link'));

  const sameView=(companyId,userId,generation)=>$('company-dialog').open&&shared.company?.id===companyId&&shared.user?.id===userId&&view===generation;
  async function personAccess(personId){
    const companyId=shared.company?.id,userId=shared.user?.id;
    const current=()=>companyId&&userId&&shared.company?.id===companyId&&shared.company.role==='admin'&&shared.user?.id===userId;
    const check=()=>{if(!current()||!shared.online)throw Error('管理者の権限と接続を確認してください。');};
    check();
    const {members}=await shared.manage('members');
    if(!current())return null;
    const member=members.find(entry=>entry.personId===personId);
    if(member)return {role:member.role,active:member.status==='active',groupIds:member.groupIds||[],
      async save(groups){check();return shared.manage('set_group_access',{p_member:member.id,p_payload:groups});}};
    if(!shared.guestAdmin)return null;
    const {guests}=await shared.guestAdmin('list');
    if(!current())return null;
    const guest=guests.find(entry=>entry.personId===personId);
    return guest?{role:'guest',active:!guest.revoked,groupIds:guest.groupIds,
      async save(groups){check();return shared.guestAdmin('set_access',{p_guest:guest.id,p_access:{groups}});}}:null;
  }
  function personAccessChoices(form,board,access){
    const groups=groupChoices(board.groups,access.groupIds);
    form.append(groups);
    return ()=>access.save(chosenGroups(groups));
  }
  const adminBusy=value=>{pending=value;$('company-admin-controls').disabled=value||shared.company?.role!=='admin'||!shared.online;};
  const roleText=company=>({admin:'管理者',member:'一般',guest:'ゲスト'})[company.role];
  function renderOrganizations(company){
    const others=(shared.companies||[]).filter(entry=>entry.id!==company.id&&entry.status==='active');
    const current='表示中の組織：'+company.name+'（'+roleText(company)+'）';
    $('company-current-organization').textContent=current;
    $('company-current-organization').hidden=others.length>0;
    $('company-organization-summary').textContent=current;
    $('company-organization-picker').hidden=!others.length;
    const list=$('company-other-organizations');list.replaceChildren();
    for(const entry of others){
      const row=el('div');row.className='company-choice';
      row.append(el('strong',entry.name+'（'+roleText(entry)+'）'),button('開く',async()=>{
        if(!shared.online||pending)return;
        $('company-dialog').close();
        await run(()=>shared.selectCompany(entry.id));
      }));
      list.append(row);
    }
  }
  function renderParticipants(data,action,canAct){
    const scoped=Array.isArray(data.groups);
    const admins=data.members.filter(member=>member.role==='admin'&&member.status==='active').length;
    for(const id of ['company-admins','company-members','company-pending'])$(id).replaceChildren();
    for(const member of data.members){
      const row=el('div'),identity=el('div');row.className='company-member';identity.className='company-member-id';
      identity.append(el('strong',member.name),el('span',member.email));row.append(identity);
      const active=member.status==='active',admin=active&&member.role==='admin';
      if(active){
        const role=button(admin?'一般メンバーに変更':'管理者に変更',()=>{
          if(canAct()&&confirm(member.email+'を'+(admin?'一般メンバー':'管理者')+'に変更しますか？'))
            return action('role',{p_member:member.id,p_role:admin?'member':'admin'});
        });
        role.disabled=admin&&admins<2;row.append(role);
      }else{
        row.append(el('small',member.status==='pending'?'承認待ち':'アクセス停止'));
        if(!scoped||member.personId)row.append(button(member.status==='pending'?'参加を承認':'参加を再許可',()=>action('approve',{p_member:member.id})));
      }
      if(!admin&&member.status!=='pending'){
        const stop=button('アクセス停止',()=>{
          if(canAct()&&confirm(member.email+'の組織へのアクセスを停止しますか？'))return action('block',{p_member:member.id});
        });
        const remove=button('削除',()=>{
          if(canAct()&&confirm(member.email+'の組織への所属を削除します。予定表の行・可能時間・MTGは残ります。再参加には改めて招待・承認が必要です。'))
            return action('remove_member',{p_member:member.id});
        });
        stop.disabled=member.status==='blocked';remove.disabled=member.status!=='blocked';remove.className='danger';row.append(stop,remove);
      }
      if(scoped&&!member.personId){
        const fields=el('div'),label=el('label','予定表の表示名'),input=el('input');
        fields.className='company-member-settings';input.value=member.requestName||'';input.maxLength=40;label.append(input);fields.append(label);
        const choices=member.status==='pending'?groupChoices(data.groups):null;
        if(choices)fields.append(choices);
        fields.append(button(active?'人の行を作成':choices?'参加を承認':'参加を再許可',()=>{
          if(!input.value.trim()){showAdminError('予定表の表示名を入力してください。');input.focus();return;}
          return action(active?'assign_person':'approve',{p_member:member.id,p_name:input.value,...(choices&&{p_payload:chosenGroups(choices)})});
        }));
        row.append(fields);
      }
      $(admin?'company-admins':member.status==='pending'?'company-pending':'company-members').append(row);
    }
  }
  function renderInvites(data,company,action){
    const scoped=Array.isArray(data.groups),pins=data.pinInvites||[],batch=scoped&&Array.isArray(data.pinInvites);
    $('company-pin-invites').hidden=!batch;$('company-legacy-invite').hidden=batch;
    $('company-invite-name-label').hidden=!scoped;$('company-invite-name').hidden=!scoped;
    $('company-invites').replaceChildren();$('company-unused-pins').replaceChildren();
    for(const invite of data.invites||[]){
      const row=el('div');row.className='company-choice';row.append(el('span',(invite.displayName?invite.displayName+' · ':'')+invite.email),
        button('招待を取り消す',()=>action('cancel_invite',{p_email:invite.email})));$('company-invites').append(row);
    }
    if(!batch)return;
    inviteGroups=data.groups;renderChoices(forms.pins);
    const active=new Set(pins.map(invite=>invite.id));
    issued=issued.filter(invite=>invite.id?active.has(invite.id):pins.some(pin=>pin.name===invite.name));
    renderIssued(forms.pins,issued,company);
    for(const invite of pins){
      const row=el('div');row.className='company-choice';
      row.append(el('span',invite.name),button('招待を取り消す',()=>action('cancel_pin_invite',{p_member:invite.id})));
      $('company-unused-pins').append(row);
    }
  }
  function renderGuests(data,company,action,canAct){
    $('company-guests').replaceChildren();
    const unused=new Set(data.guests.filter(guest=>guest.unusedLink).map(guest=>guest.id));
    issuedGuests=issuedGuests.filter(invite=>unused.has(invite.id));renderIssued(forms.guests,issuedGuests,company);
    if(extraLink&&!unused.has(extraLink.id))extraLink=null;
    $('company-guest-output').hidden=!extraLink;
    $('company-guest-link').value=extraLink?shared.guestUrl(extraLink.ticket):'';
    for(const guest of data.guests){
      const row=el('div'),name=el('strong',guest.name);row.className='company-guest-row';name.title=guest.name;
      const issue=button('リンク発行',()=>{
        if(canAct()&&(!guest.unusedLink||confirm('未使用のリンクを取り消し、新しいリンクを発行しますか？')))
          return action('add_device',{p_guest:guest.id});
      });
      const stop=button(guest.personId?'アクセス停止':'招待を取り消す',()=>{
        if(canAct()&&confirm(guest.name+'の招待リンクと端末のアクセスを停止しますか？'))return action('revoke',{p_guest:guest.id});
      });
      stop.disabled=guest.revoked;
      const remove=button('削除',()=>{
        if(canAct()&&confirm(guest.name+'のゲスト行、可能時間、MTGへの参加を削除します。よろしいですか？'))
          return action('delete',{p_guest:guest.id});
      });
      remove.disabled=!guest.revoked;remove.className='danger';
      row.append(name,el('small',guest.revoked?'停止中':'登録 '+guest.devices),issue,stop,remove);
      $('company-guests').append(row);
    }
    $('company-guest-section').hidden=false;renderChoices(forms.guests);
  }
  async function adminList(){
    const company=shared.company,d=$('company-dialog');if(!company||!shared.user)return;
    const identity=shared.user.id,generation=++view,current=()=>sameView(company.id,identity,generation);
    const scrollTop=d.scrollTop;
    if(!d.open){
      d.querySelectorAll('details').forEach(node=>node.open=false);
      d.showModal();
    }
    $('company-dialog-user').textContent=shared.guest?shared.user.email:'ログイン中：'+shared.user.email;
    $('company-dialog-code').textContent=company.code||'';
    $('company-dialog-logout').textContent=shared.guest?'ゲスト利用を終了':'ログアウト';
    $('company-guest-login').hidden=!shared.guest;
    $('company-switch').hidden=Boolean(shared.guest);
    $('company-admin-error').textContent='';$('company-admin-status').textContent='権限を確認中…';
    renderOrganizations(company);
    try{
      await shared.listCompanies();if(!current())return;
      const selected=shared.company;renderOrganizations(selected);
      await renderReviews(selected,current);
      if(!current())return;
      if(selected.role!=='admin'){clearAdmin();$('company-admin-status').textContent=shared.guest?'ゲスト':'一般メンバー';return;}
      const data=await shared.manage('members');if(!current()||shared.company.role!=='admin')return;
      $('company-admin-status').textContent='組織の管理者';$('company-admin').hidden=false;$('company-admin-help').hidden=false;
      const canAct=()=>!pending&&current()&&shared.company.role==='admin'&&shared.online;
      const runAction=async(guest,kind,params)=>{
        if(!canAct())return;
        adminBusy(true);$('company-admin-error').textContent='';
        try{
          const result=guest?await shared.guestAdmin(kind,params):await shared.manage(kind,params);
          if(!current())return;
          if(result?.queued){
            await adminList();
            if(d.open&&shared.company?.id===company.id&&shared.user?.id===identity)$('company-admin-error').textContent='レビュー待ちとして登録しました。';
            return;
          }
          if(kind==='invite_batch'){issued=result.invitations;$(forms.pins.names).value='';}
          if(kind==='issue_batch'){issuedGuests=result.invitations;$(forms.guests.names).value='';}
          if(kind==='add_device'&&result.ticket){
            issuedGuests=issuedGuests.filter(invite=>invite.id!==result.id);extraLink=result;
          }
          if(kind==='invite'){$('company-invite-email').value='';$('company-invite-name').value='';}
          await adminList();
        }catch(e){if(current())showAdminError(e.code==='NETWORK'&&['remove_member','role','block','delete'].includes(kind)
          ?'変更結果を確認できませんでした。接続を確認してから参加者一覧を開き直してください。':e.message);}
        finally{adminBusy(false);}
      };
      const action=(kind,params)=>runAction(false,kind,params);
      const guestAction=(kind,params)=>runAction(true,kind,params);
      renderParticipants(data,action,canAct);renderInvites(data,company,action);
      $('company-issue-pins').onclick=()=>{try{return action('invite_batch',{p_payload:invitationBatch(forms.pins)});}catch(e){showAdminError(e.message);}};
      $('company-invite-button').onclick=()=>{
        const params={p_email:$('company-invite-email').value};
        if(!$('company-invite-name').hidden)params.p_name=$('company-invite-name').value;
        return action('invite',params);
      };
      $('company-guest-form').onsubmit=event=>{
        event.preventDefault();
        try{return guestAction('issue_batch',{p_access:invitationBatch(forms.guests)});}catch(e){showAdminError(e.message);}
      };
      if(Array.isArray(data.groups)&&shared.guestAdmin){
        try{
          const guests=await shared.guestAdmin('list');
          if(current()&&shared.company.role==='admin')renderGuests(guests,company,guestAction,canAct);
        }catch(e){if(current()&&e.code!=='CONFIG')showAdminError(e.message);}
      }
      adminBusy(pending);
    }catch(e){if(current()){clearAdmin();$('company-admin-status').textContent='権限を確認できませんでした';showAdminError(e.message);}}
    finally{if(current())d.scrollTop=scrollTop;}
  }
  $('company-button').onclick=()=>adminList();
  $('company-dialog-close').onclick=()=>$('company-dialog').close();
  $('company-dialog').addEventListener('close',()=>{
    view++;clearAdmin();clearCredentials();$('company-admin-status').textContent='';$('company-admin-error').textContent='';
    $('company-probation-note').hidden=true;
    $('company-review-actions').replaceChildren();$('company-review-actions').hidden=true;
  });
  $('company-switch').onclick=()=>{$('company-dialog').close();shared.leaveView();};
  $('company-guest-login').onclick=()=>{
    try{shared.linkGoogle();}catch(error){showAdminError(error.message);}
  };
  $('company-dialog-logout').onclick=()=>{
    if(shared.guest&&!confirm('この端末のゲスト利用を終了しますか？再び開くには新しい招待リンクが必要です。'))return;
    $('company-dialog').close();return run(()=>shared.logout());
  };
  async function renderReviews(company,current){
    const root=$('company-review-actions'),notice=$('company-probation-note');
    notice.hidden=true;root.hidden=true;root.replaceChildren();
    if(!company.managementWorkflows)return;
    const data=await shared.manage('review_list');
    if(!current())return;
    const format=value=>new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    if(company.role==='admin'&&data.probationUntil){
      notice.textContent='新任管理者の確認期間（'+format(data.probationUntil)+'まで）。招待・削除・権限や行の設定は保留し、翌朝9時以降の通知から24時間、元の管理者が一括拒否できます。';
      notice.hidden=false;
    }
    const linked=shared.reviewLink?.(),target=linked?.organization===company.id?linked.id:null;
    let anchor=null;
    const action=async(kind,id)=>{
      if(pending||!current()||!shared.online)return;
      adminBusy(true);$('company-admin-error').textContent='';
      try{
        const result=await shared.manage(kind,{p_member:id});
        if(!current())return;
        if(result?.invitations){
          const guest=result.invitations[0]?.ticket;
          if(guest)issuedGuests=result.invitations;else issued=result.invitations;
          $('company-admin').open=true;
          $(guest?'company-guest-section':'company-member-invitations').open=true;
          $(guest?'company-guest-section':'company-member-invitations').parentElement.open=true;
        }else if(result?.ticket){
          issuedGuests=issuedGuests.filter(invite=>invite.id!==result.id);extraLink=result;$('company-guests').parentElement.open=true;
        }
        await adminList();
        if(result?.queued)$('company-admin-error').textContent='レビュー待ちとして登録しました。';
      }catch(error){if(current())showAdminError(error.message);}
      finally{adminBusy(false);}
    };
    if(data.recovery){
      const {id,expires,acknowledged}=data.recovery,panel=el('details');panel.className='company-disclosure';
      panel.append(el('summary','管理者から一般メンバーになりました'),el('p',format(expires)+'まで、同じアカウントで管理者に復帰できます。'));
      if(!acknowledged)panel.append(button('変更を確認した',()=>action('review_acknowledge',id)));
      panel.append(button('管理者に戻る',()=>action('review_recover',id)));root.append(panel);
      if(target===id)anchor=panel;
    }
    if(data.renames?.length){
      const panel=el('details');panel.className='company-disclosure';panel.append(el('summary','名前の変更依頼（'+data.renames.length+'件）'));
      for(const item of data.renames){
        const row=el('div');row.className='company-choice';
        row.append(el('span',item.before+' → '+item.after),button('承認',()=>action('rename_approve',item.id)));
        panel.append(row);
        if(item.id===target){anchor=row;panel.open=true;}
      }
      root.append(panel);
    }
    for(const review of data.reviews||[]){
      const panel=el('details');panel.className='company-disclosure';
      const state={pending:review.deadline?'確認中':'通知待ち',rejected:'拒否済み',applied:'処理済み'}[review.state];
      panel.append(el('summary',review.day+' の管理操作（'+state+'）'));
      if(review.deadline&&review.state==='pending')panel.append(el('p','拒否できる期限 '+format(review.deadline)));
      const list=el('ul');
      for(const item of review.items){
        const row=el('li',item.summary+(item.state==='failed'?'（反映できませんでした）':''));
        if(item.canReveal)row.append(button('発行した招待を表示',()=>action('review_result',item.id)));
        list.append(row);
      }
      panel.append(list);
      if(review.canReject)panel.append(button('この日の操作を一括拒否',()=>action('review_reject',review.id)));
      root.append(panel);
      if(target===review.id)anchor=panel;
    }
    root.hidden=!root.childElementCount;
    if(target){
      shared.clearReviewLink?.();
      if(anchor){if(anchor.tagName==='DETAILS')anchor.open=true;requestAnimationFrame(()=>anchor.scrollIntoView?.({block:'nearest'}));}
      else showAdminError('この手続きは完了しているか、表示できません。');
    }
  }
  return {render,personAccess,personAccessChoices};
};

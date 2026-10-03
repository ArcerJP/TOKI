"use strict";
window.TokiGoogleImportUI=({context,apply,selected,canOpen})=>{
  const $=id=>document.getElementById(id),api=window.TokiGoogleCalendar,model=window.TokiCalendarImport;
  const dialog=$('google-import-dialog'),inputs=['google-import-person','google-time-min','google-time-max'];
  let loading=false,sdkReady=false,preview=null,base=null,operation=0,request=null;
  const error=message=>{$('google-import-error').textContent=message;};
  const invalidate=()=>{preview=null;$('google-import-preview').hidden=true;};
  function controls(){
    $('google-login').disabled=loading||!sdkReady||!api.configured;
    $('google-login').textContent=api.connected?'Googleアカウントを変更':'Googleでログイン';
    $('google-logout').hidden=!api.connected;$('google-logout').disabled=loading;
    $('google-preview-button').disabled=loading||!api.connected||!canOpen();
    $('google-apply-button').disabled=loading||!preview||!canOpen();
    for(const id of inputs)$(id).disabled=loading;
    if(!loading)$('google-login-status').textContent=api.connected?'Google連携済み':'未ログイン';
  }
  function current(){
    const state=context();
    if(state.pending||state.fingerprint!==base.fingerprint)throw Error('予定表が更新されています。取り込み画面を閉じて最新の予定を確認し、もう一度取得してください。');
    if(!canOpen())throw Error('接続を確認し、最新の予定を取得してから取り込んでください。');
    return state;
  }
  $('google-import-button').onclick=async()=>{
    if(!canOpen())return;
    base=context();if(base.pending)return;
    $('google-import-person').replaceChildren();
    base.board.people.forEach((name,index)=>{const option=document.createElement('option');option.value=index;option.textContent=name;$('google-import-person').append(option);});
    const week=window.TokiModel.weekDates(selected()),end=window.TokiModel.shiftDate(week[6],1);
    $('google-time-min').value=week[0]+'T00:00';$('google-time-max').value=end?end+'T00:00':week[6]+'T23:59';
    error('');invalidate();controls();dialog.showModal();
    const sequence=++operation;
    try{await api.load();if(sequence!==operation)return;sdkReady=true;controls();}
    catch(failure){if(sequence===operation)error(failure.message);}
  };
  $('close-google-import').onclick=()=>{if($('schedule-app').getAttribute('aria-busy')!=='true')dialog.close();};
  dialog.addEventListener('cancel',event=>{if($('schedule-app').getAttribute('aria-busy')==='true')event.preventDefault();});
  dialog.addEventListener('close',()=>{operation++;request?.abort();request=null;loading=false;preview=null;base=null;});
  for(const id of inputs)$(id).addEventListener('input',()=>{invalidate();error('');controls();});
  $('google-login').onclick=async()=>{
    error('');invalidate();const sequence=++operation;loading=true;controls();$('google-login-status').textContent='Googleログインを確認中…';
    try{await api.login();}catch(failure){if(sequence===operation)error(failure.message);}
    finally{if(sequence===operation){loading=false;controls();}}
  };
  $('google-logout').onclick=()=>{api.logout();invalidate();error('');controls();};
  const time=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  function renderPreview(){
    const {ranges,affected,personName,range}=preview.plan;
    const minutes=ranges.reduce((sum,r)=>sum+r.end-r.start,0);
    $('google-import-summary').textContent=`${personName}：${ranges.length}枠・計${minutes/60}時間を参加可能として反映します。既存の予定${affected}件の指定期間内を置き換えます。`;
    const rows=$('google-import-rows');rows.replaceChildren();
    for(let date=range.first;date&&date<=range.last;date=window.TokiModel.shiftDate(date,1)){
      const tr=document.createElement('tr'),day=document.createElement('th'),slots=document.createElement('td');day.scope='row';
      day.textContent=new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',weekday:'short',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
      slots.textContent=ranges.filter(r=>r.date===date).map(r=>`${time(r.start)}〜${time(r.end)}`).join('、')||'参加可能なし';
      tr.append(day,slots);rows.append(tr);
    }
    $('google-import-preview').hidden=false;
  }
  $('google-preview-button').onclick=async()=>{
    error('');invalidate();const sequence=++operation;
    try{
      current();const range=model.period($('google-time-min').value,$('google-time-max').value),person=Number($('google-import-person').value);
      loading=true;controls();$('google-login-status').textContent='予定ありの時間帯を取得中…';request=new AbortController();
      const busy=await api.fetchBusy(range,request.signal);if(sequence!==operation)return;
      const state=current();preview={plan:model.plan(state.board,person,range,busy),fingerprint:state.fingerprint};renderPreview();
    }catch(failure){if(sequence===operation)error(failure.message);}
    finally{if(sequence===operation){loading=false;request=null;controls();}}
  };
  $('google-apply-button').onclick=async()=>{
    if(!preview||loading)return;error('');
    try{
      current();loading=true;controls();
      if(await apply(preview.plan,preview.fingerprint))dialog.close();
      else {invalidate();error('保存できませんでした。画面を閉じて最新の予定を確認し、再度取り込んでください。');}
    }catch(failure){invalidate();error(failure.message);}
    finally{loading=false;controls();}
  };
  return {refresh:()=>{if(dialog.open)controls();}};
};

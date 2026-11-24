"use strict";
window.TokiGoogleImportUI=({context,apply,today,canOpen,canImportPerson=()=>true,linkGuest})=>{
  const $=id=>document.getElementById(id),api=window.TokiGoogleCalendar,model=window.TokiCalendarImport;
  const dialog=$('google-import-dialog'),inputs=['google-import-person','google-time-min','google-time-max'];
  const margin=$('google-import-margin'),marginInfo=$('google-import-margin-info'),marginHelp=$('google-import-margin-help');
  let loading=false,sdkReady=false,preview=null,base=null,operation=0,request=null;
  let calendars=[],chosen=new Set(),listReady=false;
  function error(message){
    const alert=$('google-import-error');alert.textContent=message;
    if(message)alert.scrollIntoView?.({block:'nearest'});
  }
  const invalidate=()=>{preview=null;$('google-import-preview').hidden=true;};
  function controls(){
    $('google-login').disabled=loading||(!linkGuest&&(!sdkReady||!api.configured));
    $('google-login').title=linkGuest?'Googleでログインし、現在の予定を一般メンバーとして引き継ぎます。':'';
    $('google-login').textContent=api.connected?'Googleアカウントを変更':'Googleでログイン';
    $('google-logout').hidden=!api.connected;$('google-logout').disabled=loading;
    $('google-preview-button').disabled=loading||!api.connected||!listReady||!chosen.size||!canOpen();
    $('google-apply-button').disabled=loading||!preview||Boolean(preview.problem)||!canOpen();
    margin.disabled=loading;
    for(const field of preview?.fields||[]){field.start.disabled=loading;field.end.disabled=loading;}
    for(const id of inputs)$(id).disabled=loading;
    $('google-calendars').hidden=!api.connected;
    $('google-calendar-options').disabled=loading||!listReady;
    $('google-calendars-refresh').disabled=loading||!api.connected;
    $('google-calendars-all').checked=calendars.length>0&&chosen.size===calendars.length;
    $('google-calendars-all').indeterminate=chosen.size>0&&chosen.size<calendars.length;
    $('google-calendar-count').textContent=listReady?`${chosen.size} / ${calendars.length}件を選択`:'一覧を取得してください';
    if(!loading){
      const primary=calendars.find(calendar=>calendar.primary)?.id;
      const email=/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(primary??'')?primary:null;
      $('google-login-status').textContent=api.connected?(email?`${email} 連携済み`:'Google連携済み'):'未ログイン';
    }
  }
  function resetCalendars(){calendars=[];chosen=new Set();listReady=false;$('google-calendar-list').replaceChildren();}
  async function loadCalendars(sequence){
    resetCalendars();invalidate();loading=true;controls();$('google-login-status').textContent='カレンダー一覧を取得中…';request=new AbortController();
    const items=await api.listCalendars(request.signal);if(sequence!==operation)return;
    calendars=items;chosen=new Set(calendars.map(c=>c.id));listReady=true;
    for(const calendar of calendars){
      const label=document.createElement('label'),checkbox=document.createElement('input'),name=document.createElement('span');
      label.className='google-calendar-choice';checkbox.type='checkbox';checkbox.value=calendar.id;checkbox.checked=true;
      name.textContent=calendar.name;label.append(checkbox,name);
      if(calendar.primary){const badge=document.createElement('small');badge.textContent='メイン';label.append(badge);}
      checkbox.addEventListener('change',()=>{if(checkbox.checked)chosen.add(calendar.id);else chosen.delete(calendar.id);invalidate();error('');controls();});
      $('google-calendar-list').append(label);
    }
    if(!calendars.length)error('取り込み対象のカレンダーがありません。祝日以外のカレンダーとGoogle側の共有設定を確認してください。');
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
    base.board.people.forEach((name,index)=>{
      if(!canImportPerson(index))return;
      const option=document.createElement('option');option.value=index;option.textContent=name;$('google-import-person').append(option);
    });
    const first=today(),M=window.TokiModel;
    $('google-time-min').value=first;$('google-time-max').value=M.shiftDate(first,7)||M.MAX_DATE;
    margin.value='0';marginHelp.hidden=true;marginInfo.setAttribute('aria-expanded','false');
    error('');invalidate();resetCalendars();controls();dialog.showModal();
    const sequence=++operation;
    try{if(!linkGuest){await api.load();if(sequence!==operation)return;sdkReady=true;if(api.connected)await loadCalendars(sequence);}}
    catch(failure){if(sequence===operation)error(failure.message);}
    finally{if(sequence===operation){loading=false;request=null;controls();}}
  };
  $('close-google-import').onclick=()=>{if($('schedule-app').getAttribute('aria-busy')!=='true')dialog.close();};
  dialog.addEventListener('cancel',event=>{if($('schedule-app').getAttribute('aria-busy')==='true')event.preventDefault();});
  dialog.addEventListener('close',()=>{operation++;request?.abort();request=null;loading=false;preview=null;base=null;resetCalendars();});
  for(const id of inputs)$(id).addEventListener('input',()=>{invalidate();error('');controls();});
  $('google-login').onclick=async()=>{
    if(linkGuest){
      try{linkGuest(true);}catch(failure){error(failure.message);}
      return;
    }
    error('');invalidate();resetCalendars();const sequence=++operation;loading=true;controls();$('google-login-status').textContent='Googleログインを確認中…';
    try{await api.login();if(sequence!==operation)return;await loadCalendars(sequence);}catch(failure){if(sequence===operation)error(failure.message);}
    finally{if(sequence===operation){loading=false;request=null;controls();}}
  };
  $('google-logout').onclick=()=>{api.logout();resetCalendars();invalidate();error('');controls();};
  $('google-calendars-refresh').onclick=async()=>{
    error('');const sequence=++operation;
    try{await loadCalendars(sequence);}catch(failure){if(sequence===operation)error(failure.message);}
    finally{if(sequence===operation){loading=false;request=null;controls();}}
  };
  $('google-calendars-all').addEventListener('change',()=>{
    chosen=new Set($('google-calendars-all').checked?calendars.map(c=>c.id):[]);
    for(const checkbox of $('google-calendar-list').querySelectorAll('input'))checkbox.checked=chosen.has(checkbox.value);
    invalidate();error('');controls();
  });
  const time=window.TokiAvailability.time;
  function updatePreview(){
    const {source,fields}=preview,groups=new Map();
    const parsed=fields.map(field=>{
      const slot={date:field.date,start:model.clockMinutes(field.start.value),end:model.clockMinutes(field.end.value)};
      const issue=source.check(slot);
      if(!issue){
        if(!groups.has(slot.date))groups.set(slot.date,[]);
        groups.get(slot.date).push(slot);
      }
      return {field,slot,issue};
    });
    const draft=[];let invalid=false;
    for(const {field,slot,issue} of parsed){
      const problem=issue||((groups.get(slot.date)||[]).some(other=>other!==slot&&slot.start<other.end&&other.start<slot.end)?'同じ日の可能時間が重なっています。':'');
      field.message.textContent=problem;field.message.hidden=!problem;
      for(const input of [field.start,field.end])input.setAttribute('aria-invalid',String(Boolean(problem)));
      if(problem)invalid=true;else draft.push(slot);
    }
    preview.draft=draft;
    preview.problem=invalid?'入力した時刻を確認してください。':draft.length>source.capacity?'予定の上限（全員合計2000件）を超えます。取得期間を短くしてください。':'';
    const notice=$('google-import-time-error');notice.textContent=preview.problem;notice.hidden=!preview.problem;
    const minutes=draft.reduce((sum,r)=>sum+r.end-r.start,0),hours=Math.floor(minutes/60),remainder=minutes%60;
    const duration=[hours&&`${hours}時間`,remainder&&`${remainder}分`].filter(Boolean).join('')||'0分';
    $('google-import-summary').textContent=`${preview.calendarCount}件のカレンダーから、${source.personName}：${draft.length}枠・計${duration}を可能時間として反映します。既存の予定${source.affected}件の指定期間内を置き換えます。`;
    controls();
  }
  function renderPreview(){
    const state=preview,{ranges,range}=state.source,trim=Number(margin.value),days=new Map();
    preview.fields=[];
    for(const [index,slot] of ranges.entries()){
      const edited=preview.edits.get(index);
      if(!edited&&slot.end-slot.start<=2*trim)continue;
      const entry={index,start:edited?.start??time(slot.start+trim),end:edited?.end??time(slot.end-trim)};
      if(!days.has(slot.date))days.set(slot.date,[]);
      days.get(slot.date).push(entry);
    }
    const rows=$('google-import-rows');rows.replaceChildren();
    const formatter=new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',weekday:'short',timeZone:'UTC'});
    for(let date=range.first;date&&date<=range.last;date=window.TokiModel.shiftDate(date,1)){
      const tr=document.createElement('tr'),day=document.createElement('th'),slots=document.createElement('td');day.scope='row';
      day.textContent=formatter.format(new Date(date+'T00:00:00Z'));
      const entries=days.get(date)||[];
      if(!entries.length)slots.textContent='可能時間なし';
      for(const [number,entry] of entries.entries()){
        const row=document.createElement('div'),message=document.createElement('small');
        row.className='import-time-row';message.className='import-time-error error';message.id='google-import-time-'+entry.index;
        const field={date,message};
        for(const [key,label] of [['start','開始時刻'],['end','終了時刻']]){
          const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='off';
          input.className='import-time-input';input.value=entry[key];
          input.setAttribute('aria-label',`${day.textContent} ${number+1}枠目の${label}`);
          input.setAttribute('aria-describedby',`google-import-time-help ${message.id}`);
          if(key==='end')row.append('〜');
          row.append(input);field[key]=input;
          input.addEventListener('input',()=>{
            if(preview!==state)return;
            state.edits.set(entry.index,{start:field.start.value,end:field.end.value});updatePreview();
          });
          input.addEventListener('blur',()=>{
            if(preview!==state)return;
            const minute=model.clockMinutes(input.value);
            if(minute===null||input.value===time(minute))return;
            input.value=time(minute);state.edits.set(entry.index,{start:field.start.value,end:field.end.value});
          });
        }
        row.append(message);slots.append(row);preview.fields.push(field);
      }
      tr.append(day,slots);rows.append(tr);
    }
    $('google-import-preview').hidden=false;
    updatePreview();
  }
  margin.onchange=()=>{if(preview&&!loading)renderPreview();};
  marginInfo.onclick=()=>{
    marginHelp.hidden=!marginHelp.hidden;marginInfo.setAttribute('aria-expanded',String(!marginHelp.hidden));
  };
  $('google-preview-button').onclick=async()=>{
    error('');invalidate();const sequence=++operation;
    try{
      current();
      const start=$('google-time-min').value,end=$('google-time-max').value,person=Number($('google-import-person').value);
      if(!start||!end)throw Error('取得開始日と取得終了日を入力してください。');
      const range=model.period(start+'T00:00',end+'T00:00');
      if(!$('google-import-person').value||!canImportPerson(person))throw Error('取り込み先の人を確認してください。');
      if(!listReady||!chosen.size)throw Error('取り込むカレンダーを1つ以上選択してください。');
      const calendarIds=calendars.filter(c=>chosen.has(c.id)).map(c=>c.id);
      loading=true;controls();$('google-login-status').textContent='予定ありの時間帯を取得中…';request=new AbortController();
      const busy=await api.fetchBusy(range,calendarIds,request.signal);if(sequence!==operation)return;
      const state=current();preview={source:model.prepare(state.board,person,range,busy),fingerprint:state.fingerprint,calendarCount:calendarIds.length,edits:new Map()};
      renderPreview();
      const heading=$('google-import-preview-title');
      heading.focus({preventScroll:true});heading.scrollIntoView?.({block:'start'});
    }catch(failure){
      if(sequence!==operation)return;
      const unavailable=calendars.filter(calendar=>failure.calendarIds?.includes(calendar.id)).map(calendar=>calendar.name);
      error(unavailable.length?`取得できなかったカレンダー「${unavailable.join('」「')}」。Google側の閲覧権限を確認するか、該当するチェックを外して再度取り込んでください。`:failure.message);
    }
    finally{if(sequence===operation){loading=false;request=null;controls();}}
  };
  $('google-apply-button').onclick=async()=>{
    if(!preview||loading||preview.problem)return;error('');
    try{
      current();if(!canImportPerson(preview.source.person))throw Error('取り込み先の人を確認してください。');
      const plan=preview.source.build(preview.draft);loading=true;controls();
      if(await apply(plan,preview.fingerprint))dialog.close();
      else error('保存できませんでした。画面を閉じて最新の予定を確認し、再度取り込んでください。');
    }catch(failure){error(failure.message);}
    finally{loading=false;controls();}
  };
  return {refresh:()=>{if(dialog.open)controls();}};
};

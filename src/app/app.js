"use strict";
(async () => {
  await window.TOKI_DATA_READY;
  const $ = id => document.getElementById(id);
  let {people,dates,availability} = window.TOKI_DATA;
  const shared=window.TokiShared;
  const M=window.TokiModel,A=window.TokiAvailability,S=window.TokiSchedule;
  let rowDrag=null,googleImportUI=null,meetingMenu=null,pendingLocalBoard=null,mobile=null,groupView=null,companyUI=null,desktopMonth=null;
  let desktopEntry=false,desktopTarget=null;
  let groups=[],rowMetadata=null,access=null,ready=!shared.enabled,busy=false,revision=null,pendingBoard=null,lastSaveError='',accountGeneration=0;
  let initializing=shared.enabled;
  $("schedule-app").hidden=shared.enabled;
  $("auth-gate").hidden=true;
  $("app-loading").hidden=!initializing;
  $("copy-link").hidden=!shared.enabled||Boolean(shared.guest);
  const START=480, END=1440, SPAN=END-START, KEY="toki-availability-v3",LEGACY_KEY="toki-availability-2026-v1";
  const colors=["#2b7558","#367f88","#526ab1","#896899"];
  const minute=t=>{const [h,m]=t.split(":").map(Number);return h*60+m;};
  const time=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const label=d=>new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short",timeZone:"UTC"}).format(new Date(d+"T00:00:00Z"));
  const clone=o=>JSON.parse(JSON.stringify(o));
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
  let events=[],meetings=[],displayBars=new Map();
  const snapshot=()=>M.clone({schemaVersion:4,people,groups,events,meetings,...(rowMetadata&&{rows:rowMetadata})});
  const assign=value=>{
    const board=S.migrate(value);
    ({people,groups,events,meetings}=board);
    rowMetadata=board.rows??null;
  };
  const canManage=()=>!access||access.role==='admin';
  const isPlace=person=>rowMetadata?.[person]?.kind==='place';
  const linkedPerson=()=>access?.personId?(rowMetadata?.findIndex(row=>row.id===access.personId)??-1):-1;
  const ownPerson=()=>['member','guest'].includes(access?.role)?linkedPerson():-1;
  const canManagePlaces=()=>access?.role!=='guest';
  const canInspectPersonAccess=()=>ready&&access?.role==='admin'&&shared.company?.role==='admin'&&Boolean(shared.user);
  const canRequestRename=(kind,id)=>access?.role==='member'&&access.managementWorkflows===true&&id!==null&&
    (kind==='person'?id===ownPerson():kind==='place'?isPlace(id):groups.some(group=>group.id===id));
  const canOpenRoster=(kind,id)=>canManage()||(kind==='place'&&canManagePlaces()&&(id===null?canAddPlace():isPlace(id)))||canRequestRename(kind,id);
  const memberMeetingsEnabled=()=>access?.memberMeetings===true;
  const canScheduleMeeting=group=>canManage()||
    (access?.role==='member'&&memberMeetingsEnabled()&&groups.some(entry=>entry.id===group));
  const canEditMeeting=id=>{
    const meeting=meetings.find(entry=>entry.id===id);
    return Boolean(meeting&&canScheduleMeeting(meeting.group));
  };
  const canEditPerson=person=>canManage()||person===ownPerson()||(canManagePlaces()&&isPlace(person));
  const canEditRow=key=>key.startsWith('g:')?canScheduleMeeting(key.slice(2)):canEditPerson(Number(key.slice(2)));
  const canAddPlace=()=>canManagePlaces()&&(!access||canManage()||groups.length>0);
  const canImport=()=>people.some((_,person)=>!isPlace(person)&&canEditPerson(person));
  const dialogOpen=()=>Boolean(document.querySelector("dialog[open]"));
  const viewScope=()=>shared.enabled?(shared.scope||'shared'):'local';
  const prefKey=name=>`toki-view-v1:${viewScope()}:${name}`;
  let excludedGroups={};
  try{const saved=JSON.parse(localStorage.getItem(prefKey('excluded'))||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))excludedGroups=saved;}catch{}
  const manualExclusions=id=>Array.isArray(excludedGroups[id])?excludedGroups[id].filter(n=>typeof n==='string'):[];
  const bulkModes=new Set();
  const bulkCache=new Map();
  function bulkExcluded(id){
    if(bulkCache.has(id))return bulkCache.get(id);
    const group=groups.find(entry=>entry.id===id);
    const value=bulkModes.size&&group&&groupView?.visible(id)
      ?S.bulkExclusions({people,groups,events,meetings,rows:rowMetadata},group,selected,bulkModes,manualExclusions(id)):[];
    bulkCache.set(id,value);
    return value;
  }
  const excluded=(id,date=selected)=>[...new Set([...manualExclusions(id),...(date===selected?bulkExcluded(id):[])])];
  function toggleMember(group,name){
    if(drag||rowDrag?.active||busy||bulkExcluded(group).includes(name))return;
    const values=new Set(manualExclusions(group));
    if(values.has(name))values.delete(name);else values.add(name);
    Object.defineProperty(excludedGroups,group,{value:[...values],writable:true,enumerable:true,configurable:true});
    try{localStorage.setItem(prefKey('excluded'),JSON.stringify(excludedGroups));}catch{}
    render();
  }
  function fillBulkOptions(container){
    container.replaceChildren();
    const choices=[['all','全員除外'],['unavailable','全日不可除外'],['most','最多枠に絞る'],['least','最少枠に絞る']];
    for(const [id,title] of choices){
      const option=el('label'),input=el('input');
      input.type='checkbox';input.checked=bulkModes.has(id);
      input.onchange=()=>{
        if(input.checked){
          if(id==='most')bulkModes.delete('least');
          if(id==='least')bulkModes.delete('most');
          bulkModes.add(id);
        }else bulkModes.delete(id);
        render();
      };
      option.append(input,document.createTextNode(title));container.append(option);
    }
  }
  let collapsed=new Set();
  try{collapsed=new Set(JSON.parse(localStorage.getItem(prefKey('collapsed'))||"[]"));}catch{}
  availability.forEach((days,person)=>days.forEach((value,d)=>value.split(",").filter(Boolean).forEach((range,n)=>{const [start,end]=range.split("-").map(minute);events.push({id:`seed-${person}-${d}-${n}`,person,date:dates[d],start,end});})));
  function today(){
    const now=new Date();
    return [String(now.getFullYear()).padStart(4,'0'),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  }
  let selected=today(), pickerMonth, undo=[], redo=[], drag=null, toastTimer, loadFailed=false;
  let duplication=null;
  try{if(!shared.enabled){const raw=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);if(raw){const saved=JSON.parse(raw);const board=saved.version===3?saved.board:M.upgrade(saved.version===2?saved.board:{people,dates,events:saved.events});if(!M.valid(board))throw Error("Invalid saved data");assign(board);}}}
  catch{loadFailed=true;$("save-status").textContent="保存データを読めませんでした";}
  function toast(message){$("toast").textContent=message;$("toast").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").hidden=true,3500);}
  function localSaveError(message){lastSaveError=message;$("save-status").textContent="未保存・変更を反映していません";$("roster-error").textContent=message;$("meeting-error").textContent=message;toast(message);return false;}
  function persist(board){try{localStorage.setItem(KEY,JSON.stringify({version:3,board}));$("save-status").textContent="このブラウザーに保存済み";return true;}catch{return localSaveError("このブラウザーに保存できませんでした。保存領域やブラウザーの設定を確認して、もう一度お試しください。");}}
  const writable=()=>ready&&(!shared.enabled||shared.online);
  const editable=()=>!busy&&writable()&&!rowDrag?.active;
  function setBusy(value){
    busy=value;const disabled=value||!writable();
    $("schedule-app").setAttribute('aria-busy',String(value));
    $("schedule-app").classList.toggle('read-only',shared.enabled&&!shared.online);
    $("roster-form").querySelectorAll("button").forEach(b=>b.disabled=value);
    for(const id of ['add-person','add-manual-person','add-group','remove-row','confirm-remove','detach-place'])$(id).disabled=disabled;
    $('add-person').textContent=access?'＋ 場所・外部予定を追加':'＋ 人を追加';
    $('add-person').disabled=disabled||!canAddPlace();
    $('add-person').hidden=!canManagePlaces();
    $('add-manual-person').hidden=!access||!canManage();
    $('place-help').hidden=!access||!canManagePlaces();
    $('add-group').hidden=!canManage();
    $("roster-form").querySelector('button[type="submit"]').disabled=disabled;
    $("meeting-dialog").querySelectorAll('.release-member').forEach(button=>button.disabled=disabled);
    $("export-availability").disabled=!ready||(!people.length&&!groups.length);
    $("export-meetings").disabled=!ready||!groups.length;
    $("google-import-button").disabled=disabled||!canImport()||navigator.onLine===false;
    $("undo").disabled=disabled||!undo.length;$("redo").disabled=disabled||!redo.length;
    $("chart").querySelectorAll('.row-drag-handle').forEach(button=>button.disabled=disabled);
    $("chart").querySelectorAll('.bottom-add').forEach(button=>{
      const action=$(button.dataset.addAction);
      button.hidden=action.hidden;
      button.disabled=action.hidden||action.disabled;
      button.textContent=action.textContent;
    });
    if(ready&&shared.enabled&&!shared.online&&!busy)$("save-status").textContent='オフライン・閲覧のみ';
    googleImportUI?.refresh();
    meetingMenu?.refresh();
    refreshDuplicatePicker();
    mobile?.refresh();
  }
  function connectionState({online,fetchedAt}){
    if(!online){cancelDrag();rowDrag?.cancel();}
    const note=$("connection-status");note.hidden=online;
    note.textContent='オフライン・閲覧のみ。接続が戻ると最新の予定を取得します。'+(fetchedAt?' 最終取得：'+new Date(fetchedAt).toLocaleString('ja-JP'):'');
    setBusy(busy);
    if(ready&&!busy&&!pendingBoard)$("save-status").textContent=online?'共有保存・同期中':'オフライン・閲覧のみ';
  }
  async function saveNext(next,{handleScheduleBusy=false}={}){
    lastSaveError='';
    if(!editable())return false;
    if(Array.isArray(next))next={...snapshot(),events:next};
    if(!M.valid(next)){toast("入力内容を確認してください。");return false;}
    if(!shared.enabled){
      if(pendingLocalBoard)return localSaveError("別タブで予定が更新されています。編集画面を閉じ、最新の内容を確認してからもう一度編集してください。");
      if(!persist(next))return false;
      assign(next);return true;
    }
    const generation=accountGeneration,previousStatus=$("save-status").textContent;
    setBusy(true);$("save-status").textContent="共有先に保存中…";
    try{
      const saved=await shared.save(next,revision);if(generation!==accountGeneration)return false;
      if(saved?.queued){$("save-status").textContent="管理操作はレビュー待ち";return 'queued';}
      assign(saved.payload);access=saved.access??null;revision=saved.version;$("save-status").textContent="共有保存済み";return true;
    }
    catch(error){
      if(generation!==accountGeneration)return false;
      if(handleScheduleBusy&&error.code==='SCHEDULE_BUSY'){$("save-status").textContent=previousStatus;throw error;}
      lastSaveError=error.message;$("save-status").textContent="未保存・最新の予定を確認してください";
      $("meeting-error").textContent=error.message;$("roster-error").textContent=error.message;toast(error.message);await shared.refresh();return false;
    }
    finally{if(generation===accountGeneration)setBusy(false);}
  }
  function recordChange(before){undo.push(before);if(undo.length>80)undo.shift();redo=[];render();}
  async function commit(next,message){
    const before=snapshot();
    const removesPrivateMeeting=before.meetings.some(meeting=>meeting.limitedParticipants&&!next.meetings.some(entry=>entry.id===meeting.id));
    const outcome=await saveNext(next);
    if(!outcome){applyPending();return false;}
    if(outcome==='queued'){toast('レビュー待ちとして登録しました');applyPending();return true;}
    if(removesPrivateMeeting){undo=[];redo=[];render();toast(message+'。この操作は元に戻せません。');}
    else{recordChange(before);toast(message);}
    applyPending();return true;
  }
  async function history(direction){if(!editable())return;const from=direction==="undo"?undo:redo,to=direction==="undo"?redo:undo;if(!from.length)return;const before=snapshot(),outcome=await saveNext(clone(from.at(-1)));if(!outcome){applyPending();return;}if(outcome==='queued'){toast('レビュー待ちとして登録しました');applyPending();return;}to.push(before);from.pop();render();toast(direction==="undo"?"元に戻しました":"やり直しました");applyPending();}
  function receiveBoard(board){
    if(board.version<=revision)return;
    const payload=board.payload;
    if(!M.valid(payload)){$("auth-message").textContent="共有データの形式を確認できません。再読み込みしてください。";$("auth-retry").hidden=false;return;}
    const changed=revision!==null;
    const nextAccess=board.access??null;
    const revoked=changed&&['member','guest'].includes(nextAccess?.role)&&
      (access?.role!==nextAccess.role||access.personId!==nextAccess.personId||
        groups.some(group=>!payload.groups.some(next=>next.id===group.id))||
        rowMetadata?.some(row=>!payload.rows.some(next=>next.id===row.id)));
    if(revoked)resetView();
    else if(busy||drag||meetingMenu?.pressing||rowDrag?.active||mobile?.interacting||desktopMonth?.interacting||dialogOpen()){pendingBoard=board;$("save-status").textContent="他のメンバーが更新しました";return;}
    assign(payload);access=nextAccess;revision=board.version;undo=[];redo=[];ready=true;
    if(!changed||revoked){try{excludedGroups=JSON.parse(localStorage.getItem(prefKey('excluded'))||'{}');collapsed=new Set(JSON.parse(localStorage.getItem(prefKey('collapsed'))||'[]'));}catch{excludedGroups={};collapsed=new Set();}}
    $("app-loading").hidden=true;$("auth-gate").hidden=true;$("schedule-app").hidden=false;$("save-status").textContent="共有保存済み";render();if(changed)toast("他のメンバーの変更を反映しました");
  }
  function applyPending(){
    if(busy||drag||meetingMenu?.pressing||rowDrag?.active||mobile?.interacting||desktopMonth?.interacting||dialogOpen())return;
    if(pendingBoard){const board=pendingBoard;pendingBoard=null;receiveBoard(board);}
    if(pendingLocalBoard){assign(pendingLocalBoard);pendingLocalBoard=null;undo=[];redo=[];render();toast('別タブの変更を反映しました');}
  }
  const dateMoves=[['previous',-1],['next',1],['previous-week',-7],['next-week',7]];
  const desktopDate=offset=>desktopEntry?window.TokiMobileModel.shiftMonth(selected,offset):M.shiftDate(selected,offset);
  function renderDates(){
    $('date-select').textContent='▾ '+label(selected);
    $('date-select').setAttribute('aria-label','日付を選択：'+label(selected));
    for(const [id,offset] of dateMoves){
      $(id).hidden=desktopEntry&&Math.abs(offset)===7;
      $(id).disabled=!desktopDate(offset);
    }
    $('previous').setAttribute('aria-label',desktopEntry?'前の月':'前の日');
    $('next').setAttribute('aria-label',desktopEntry?'次の月':'次の日');
  }
  function selectDate(date){if(!M.validDate(date)||drag||rowDrag?.active||desktopMonth?.interacting||dialogOpen())return;selected=date;render();}
  function monthAt(month,offset){
    const date=new Date(month+'-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth()+offset);
    const key=date.toISOString().slice(0,7);
    return key>=M.MIN_DATE.slice(0,7)&&key<=M.MAX_DATE.slice(0,7)?key:null;
  }
  function chooseDate(date){
    $('date-picker').close();
    selectDate(date);
    mobile?.jumpToDate(date);
    desktopMonth?.jump(date);
  }
  const canAdjustTime=source=>source.kind==='availability'
    ?canEditPerson(source.person):source.kind==='meeting'&&source.person===null&&canEditMeeting(source.id);
  const canSaveTime=source=>editable()&&canAdjustTime(source);
  function canDuplicate(source){
    if(!canSaveTime(source))return false;
    if(source.kind==='availability'||canManage())return true;
    const meeting=meetings.find(entry=>entry.id===source.id),group=groups.find(entry=>entry.id===meeting.group);
    return !meeting.limitedParticipants&&meeting.members.every(person=>group.members.includes(person));
  }
  async function adjustMenuTime(source,to,fingerprint){
    if(!canSaveTime(source))throw Error('この時間帯を編集できません。');
    if(to.end<=to.start)throw Error('終了時刻は開始時刻より後にしてください。');
    const current=snapshot();
    if(pendingBoard||pendingLocalBoard||JSON.stringify(current)!==fingerprint)
      throw Error('予定表が更新されました。画面を閉じ、最新の予定から操作してください。');
    const availability=source.kind==='availability';
    const next=availability
      ?window.TokiMobileModel.applyMonthEdit(current,{person:source.person,date:source.date,from:source,to})
      :S.adjustMeeting(current,source.id,to);
    if(!await commit(next,availability?'可能時間を変更しました':'MTGの時間を変更しました'))
      throw Error(lastSaveError||'変更を保存できませんでした。');
  }
  function refreshDuplicatePicker(){
    const saving=Boolean(duplication?.saving);
    $('date-picker').setAttribute('aria-busy',String(saving));
    $('close-date-picker').disabled=saving;
    $('confirm-duplicate').disabled=!duplication||saving||!canDuplicate(duplication.source)||!duplication.dates.size;
  }
  function dateButtonState(button,date){
    const blocked=duplication?.blocked.has(date);
    button.toggleAttribute('data-duplicate-warning',Boolean(blocked));
    button.setAttribute('aria-label',label(date)+(blocked?'（複製できませんでした）':''));
    button.setAttribute('aria-pressed',String(duplication?duplication.dates.has(date):date===selected));
  }
  function toggleDuplicateDate(button,date){
    const {dates}=duplication;
    if(dates.has(date))dates.delete(date);else dates.add(date);
    dateButtonState(button,date);
    $('duplicate-count').textContent=dates.size+'日を選択';
    refreshDuplicatePicker();
  }
  function renderMonth(focusDate=selected){
    const first=new Date(pickerMonth+'-01T00:00:00Z'),last=new Date(first);
    last.setUTCMonth(first.getUTCMonth()+1,0);
    $('picker-month').textContent=first.getUTCFullYear()+'年 '+(first.getUTCMonth()+1)+'月';
    $('previous-month').disabled=!monthAt(pickerMonth,-1);
    $('next-month').disabled=!monthAt(pickerMonth,1);
    const cells=$('picker-days');cells.replaceChildren();
    for(let i=0;i<first.getUTCDay();i++)cells.append(el('span'));
    const current=today();
    for(let number=1;number<=last.getUTCDate();number++){
      const date=pickerMonth+'-'+String(number).padStart(2,'0');
      const button=el('button',null,String(number));
      button.type='button';button.disabled=!M.validDate(date)||date===duplication?.date;button.dataset.date=date;button.tabIndex=-1;
      dateButtonState(button,date);
      if(date===current)button.setAttribute('aria-current','date');
      button.onclick=()=>{
        if(!duplication)chooseDate(date);
        else if(!duplication.saving){
          cells.querySelector('button[tabindex="0"]').tabIndex=-1;
          button.tabIndex=0;
          toggleDuplicateDate(button,date);
        }
      };cells.append(button);
    }
    const focus=cells.querySelector(`button[data-date="${focusDate}"]:enabled`)||cells.querySelector('button:enabled');
    focus.tabIndex=0;
    return focus;
  }
  function openDatePicker(){
    if(!ready||drag||rowDrag?.active||dialogOpen())return;
    duplication=null;
    showPickerMode();
    pickerMonth=selected.slice(0,7);
    const input=$('picker-direct-date');
    input.value=selected;input.min=M.MIN_DATE;input.max=M.MAX_DATE;
    const focus=renderMonth();
    $('date-picker').showModal();focus.focus();
  }
  function showPickerMode(){
    $('date-picker-title').textContent=duplication?'他の日に複製':'日付を選択';
    if(duplication)$('date-picker').setAttribute('aria-describedby','duplicate-source');
    else $('date-picker').removeAttribute('aria-describedby');
    $('duplicate-source').hidden=!duplication;
    $('duplicate-actions').hidden=!duplication;
    $('picker-form').hidden=Boolean(duplication);
    refreshDuplicatePicker();
  }
  function openDuplicatePicker(source){
    if(!canDuplicate(source)||drag||dialogOpen())return;
    const board=snapshot(),range=source.kind==='availability'?source:board.meetings.find(m=>m.id===source.id);
    if(!range)return;
    duplication={source,date:range.date,dates:new Set(),blocked:new Set(),saving:false};
    pickerMonth=range.date.slice(0,7);
    const name=source.kind==='availability'?board.people[source.person]+'の可能時間':board.groups.find(g=>g.id===range.group).name+'のMTG';
    $('duplicate-source').textContent=name+'　'+A.formatDay(range.date,[range]);
    $('duplicate-count').textContent='0日を選択';
    $('duplicate-result').hidden=true;
    $('duplicate-warning').hidden=true;
    showPickerMode();
    const focus=renderMonth(M.shiftDate(range.date,1));
    $('date-picker').showModal();focus.focus();
  }
  async function saveDuplicateDates(state,dates,result){
    if(duplication!==state||pendingBoard||pendingLocalBoard)throw Error('予定表が更新されました。画面を閉じ、最新の予定から操作してください。');
    const plan=S.duplicateDates(snapshot(),state.source,dates);
    result.existing.push(...plan.existing);result.blocked.push(...plan.blocked);
    if(!plan.added.length)return;
    try{
      if(!await saveNext(plan.board,{handleScheduleBusy:true}))throw Error(lastSaveError||'複製を保存できませんでした。');
      result.added.push(...plan.added);
    }catch(error){
      if(error.code!=='SCHEDULE_BUSY')throw error;
      // The server can see reservations in groups that the current account cannot view.
      if(plan.added.length===1){result.blocked.push(plan.added[0]);return;}
      const middle=Math.ceil(plan.added.length/2);
      await saveDuplicateDates(state,plan.added.slice(0,middle),result);
      await saveDuplicateDates(state,plan.added.slice(middle),result);
    }
  }
  $('confirm-duplicate').onclick=async()=>{
    const state=duplication;
    if(!state||state.saving||!canDuplicate(state.source)||!state.dates.size)return;
    const before=snapshot(),result={added:[],existing:[],blocked:[]};
    let failure='';
    state.saving=true;refreshDuplicatePicker();
    try{await saveDuplicateDates(state,[...state.dates],result);}
    catch(error){failure=error.message;}
    if(duplication!==state||!$('date-picker').open)return;
    state.saving=false;
    if(result.added.length)recordChange(before);
    const summary=[result.added.length&&result.added.length+'日に複製しました。',result.existing.length&&result.existing.length+'日は登録済みです。'].filter(Boolean).join(' ');
    if(!failure&&!result.blocked.length){$('date-picker').close();toast(summary);return;}
    for(const date of [...result.added,...result.existing])state.dates.delete(date);
    state.blocked=new Set(result.blocked);
    $('duplicate-count').textContent=state.dates.size+'日を選択';
    $('duplicate-result').textContent=summary;$('duplicate-result').hidden=!summary;
    const warning=$('duplicate-warning');
    warning.textContent=[result.blocked.length&&'⚠ 複製できなかった日　'+result.blocked.sort().map(label).join('、'),failure&&'⚠ '+failure].filter(Boolean).join('\n');
    warning.hidden=false;
    renderMonth(document.activeElement?.dataset.date);
    refreshDuplicatePicker();
    warning.focus();
  };
  for(const [id,offset] of [['previous-month',-1],['next-month',1]])$(id).onclick=()=>{
    if(duplication?.saving)return;
    const month=monthAt(pickerMonth,offset);
    if(month){pickerMonth=month;renderMonth();}
  };
  $('picker-days').onkeydown=e=>{
    const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
    if(!offset||!e.target.dataset.date||duplication?.saving)return;
    e.preventDefault();
    let date=M.shiftDate(e.target.dataset.date,offset);
    if(duplication&&date===duplication.date)date=M.shiftDate(date,offset);
    if(!date)return;
    if(date.slice(0,7)!==pickerMonth){pickerMonth=date.slice(0,7);renderMonth(date).focus();return;}
    e.target.tabIndex=-1;
    const button=$('picker-days').querySelector(`button[data-date="${date}"]`);
    button.tabIndex=0;button.focus();
  };
  $('close-date-picker').onclick=()=>{if(!duplication?.saving)$('date-picker').close();};
  $('date-picker').addEventListener('cancel',event=>{if(duplication?.saving)event.preventDefault();});
  $('date-picker').addEventListener('close',()=>{
    if($('date-picker').open)return;
    duplication=null;
    $('duplicate-source').textContent='';$('duplicate-result').textContent='';$('duplicate-warning').textContent='';
    showPickerMode();
  });
  $('picker-today').onclick=()=>{if(!duplication)chooseDate(today());};
  $('picker-form').onsubmit=e=>{
    e.preventDefault();
    if(duplication)return;
    const date=$('picker-direct-date').value;
    if(M.validDate(date))chooseDate(date);
  };
  function chartFor(date,interactive=true){
    const board=snapshot(),chart=el('div','chart'),rows=M.rows(board,interactive?collapsed:new Set()).filter(row=>!interactive||!groupView||groupView.visible(row.group?.id||row.context||'@unassigned'));
    const own=ownPerson();
    if(interactive&&own>=0&&!rows.some(row=>row.person===own))rows.unshift({key:'p:'+own,name:people[own],person:own,context:null});
    if(interactive)displayBars=new Map();
    chart.style.setProperty('--people-count',rows.length||1);
    const head=el('div','chart-header'),day=el('div','date-row'),times=el('div','time-row');
    day.append(el('div','name-heading','名前'),el('div','date-label',label(date)));times.append(el('div','name-heading','可能時間'));
    const ticks=el('div','times');for(let m=START;m<END;m+=30)ticks.append(el('div','time-tick '+(m%60===0?'hour':''),time(m)));times.append(ticks);head.append(day,times);chart.append(head);
    rows.forEach(({name,person,group,nested,key,context})=>{
      const inactive=Boolean(nested&&excluded(context).includes(name));
      const row=el('div','person-row'+(group?' group-row':'')+(nested?' member-row':'')+(inactive?' excluded-member':''));
      row.style.setProperty('--person-color',group?S.color(group.id,groups):colors[Math.floor(person/4)%colors.length]);
      if(interactive){row.dataset.name=name;row.dataset.context=group?group.id:(context||'');if(group)row.dataset.group=group.id;else row.dataset.person=person;}
      const nameCell=el('div','person-name');
      if(interactive&&canManage()){const handle=el('button','row-drag-handle','⋮⋮');handle.type='button';handle.setAttribute('aria-label',name+(group?'のグループを移動':'の行を移動'));handle.title='ドラッグで移動／上下キーで並べ替え';nameCell.append(handle);}
      if(group&&interactive){const toggle=el('button','group-toggle',collapsed.has(group.id)?'▸':'▾');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed.has(group.id)));toggle.setAttribute('aria-label',group.name+(collapsed.has(group.id)?'を展開':'を折りたたむ'));toggle.onclick=()=>{if(drag||rowDrag?.active)return;if(collapsed.has(group.id))collapsed.delete(group.id);else collapsed.add(group.id);try{localStorage.setItem(prefKey('collapsed'),JSON.stringify([...collapsed]));}catch{}render();};nameCell.append(toggle);}
      else nameCell.append(el('span','person-dot'));
      const kind=group?'group':isPlace(person)?'place':'person',id=group?group.id:person;
      const canOpen=interactive&&canOpenRoster(kind,id);
      const nameLabel=el(canOpen?'button':'span','row-name',name);
      if(canOpen){nameLabel.type='button';nameLabel.title=name+'を編集・削除';nameLabel.setAttribute('aria-label',name+'を編集・削除');nameLabel.onclick=()=>openRoster(kind,id,context);}
      nameCell.append(nameLabel);
      if(isPlace(person))nameCell.append(el('span','group-size','場所・外部'));
      if(group)nameCell.append(el('span','group-size',S.participants(board,group.id,excluded(group.id)).length+'/'+group.members.length));
      if(nested&&interactive){const toggle=el('button','member-active-toggle',inactive?'−':'✓');toggle.type='button';toggle.setAttribute('aria-pressed',String(!inactive));toggle.setAttribute('aria-label',name+'を'+groups.find(g=>g.id===context).name+(inactive?'の対象に戻す':'の対象から一時除外'));toggle.title=inactive?'この端末で対象に戻す':'この端末で一時除外（取り消し線）';toggle.disabled=bulkExcluded(context).includes(name);toggle.onclick=()=>toggleMember(context,name);nameCell.insertBefore(toggle,nameLabel);}
      const track=el('div','timeline');track.dataset.row=key;
      if(interactive){track.tabIndex=0;track.setAttribute('role','group');track.setAttribute('aria-label',name+(group?'の共通の可能時間。クリック・ドラッグ、または両端を縮めてMTGを登録':'の可能時間。空き枠をクリック・ドラッグで追加'));}
      const list=S.ranges(board,key,date,group?excluded(group.id):[]).map(range=>({...range,date,row:key,kind:group?'common':'availability',person,group:group?.id}));
      for(const meeting of meetings.filter(m=>m.date===date&&(group?m.group===group.id:m.members.includes(person))))list.push({...meeting,row:key,kind:'meeting',inGroup:Boolean(group)});
      list.sort((a,b)=>a.start-b.start||a.end-b.end);const lanes=[];
      list.forEach((event,index)=>{
        const displayId=key+':'+date+':'+index;if(interactive)displayBars.set(displayId,event);
        let lane=lanes.findIndex(end=>end<=event.start);if(lane<0)lane=lanes.length;lanes[lane]=event.end;
        const bar=el(interactive?'button':'div','event '+event.kind+(event.kind==='meeting'&&!group?' locked-meeting':''));if(interactive)bar.type='button';bar.dataset.id=displayId;
        if(event.kind==='meeting')bar.style.setProperty('--person-color',S.color(event.group,groups));
        bar.style.left=((event.start-START)/SPAN*100)+'%';bar.style.width=((event.end-event.start)/SPAN*100)+'%';if(lane)bar.style.top=(5+lane*33)+'px';
        const title=event.kind==='meeting'?(group?[event.members.map(p=>people[p]).join('，'),'MTG'].filter(Boolean).join(' '):groups.find(g=>g.id===event.group)?.name+' MTG'):'可能時間';
        bar.append(el('span','event-title',title),el('span','event-time',time(event.start)+'–'+time(event.end)));
        bar.title=name+' / '+title+' '+time(event.start)+'〜'+time(event.end)+(event.kind!=='common'?' ／ 長押しで操作':'');bar.setAttribute('aria-label',name+' '+title+' '+time(event.start)+'から'+time(event.end));
        if(interactive&&event.kind!=='common'){bar.setAttribute('aria-haspopup','dialog');bar.setAttribute('aria-controls','meeting-menu');}
        if(interactive){
          if(event.kind==='meeting'?group&&canEditMeeting(event.id):canEditRow(key))['start','end'].forEach(side=>{const handle=el('span','resize-handle '+side);handle.dataset.resize=side;handle.setAttribute('aria-hidden','true');bar.append(handle);});
          bar.addEventListener('click',e=>{if(suppressClick){e.preventDefault();return;}if(event.kind==='meeting'&&group)openMeeting(event.id);});
        }
        track.append(bar);
      });
      if(lanes.length>1)track.style.minHeight=(lanes.length*33+10)+'px';
      if(!list.length)track.append(el('span','empty-label',group?'共通の可能時間なし':'可能時間なし'));
      row.append(nameCell,track);chart.append(row);
    });
    if(interactive&&!rows.length){const empty=el('p','group-view-empty','表示するグループがありません。「表示グループ」から選択してください。');chart.append(empty);}
    if(interactive&&canManagePlaces()){
      const add=el('div','bottom-add-row'),actions=el('div','bottom-add-actions');
      for(const id of ['add-person','add-group','add-manual-person']){
        const button=el('button','bottom-add');
        button.type='button';
        button.dataset.addAction=id;
        button.onclick=()=>$(id).click();
        actions.append(button);
      }
      add.append(actions);chart.append(add);
    }
    return chart;
  }
  function scheduleCount(){
    const shown=M.rows(snapshot()).filter(row=>groupView?.visible(row.group?.id||row.context||'@unassigned'));
    const people=new Set(shown.flatMap(row=>row.group?[]:[row.person]));
    if(ownPerson()>=0)people.add(ownPerson());
    return shown.filter(row=>row.group).length+'グループ・'+people.size+'人';
  }
  const entryContext=()=>({board:snapshot(),date:selected,ready,busy,writable:editable(),fingerprint:JSON.stringify(snapshot())});
  function renderDesktopEntry(){
    const entry=$('desktop-entry'),person=$('desktop-entry-person');
    entry.hidden=!desktopEntry;person.hidden=!desktopEntry;
    $('chart-panel').hidden=desktopEntry;
    $('desktop-entry-view').setAttribute('aria-pressed',String(desktopEntry));
    $('desktop-schedule-view').setAttribute('aria-pressed',String(!desktopEntry));
    $('group-view-button').hidden=desktopEntry;$('bulk-exclude').hidden=desktopEntry;
    if(!desktopEntry||!ready||!desktopMonth){if(desktopMonth)desktopMonth.node.hidden=true;return;}
    const ctx=entryContext(),targets=window.TokiMobileModel.entryRows(ctx.board,canEditPerson);
    const target=targets.find(entry=>entry.key===desktopTarget)??targets.find(entry=>entry.person===linkedPerson())??targets.find(entry=>!isPlace(entry.person))??targets[0];
    desktopTarget=target?.key??null;
    person.replaceChildren(...targets.map(entry=>Object.assign(el('option',null,entry.name),{value:entry.key})));
    person.value=desktopTarget??'';person.disabled=!target||busy;
    desktopMonth.render(ctx,target?.person??-1);
  }
  function render(){
    if(rowDrag?.active||desktopMonth?.interacting)return;
    bulkCache.clear();
    document.querySelector('.member-count').textContent=scheduleCount();
    const scroll=$('chart-scroll'),x=scroll.scrollLeft,y=scroll.scrollTop;
    $('chart').replaceWith(Object.assign(chartFor(selected),{id:'chart'}));scroll.scrollLeft=x;scroll.scrollTop=y;
    renderDates();renderDesktopEntry();fillBulkOptions($('bulk-exclude').querySelector('.bulk-options'));
    setBusy(busy);groupView?.refresh();
  }
  function openMeeting(id){
    if(busy||!ready||rowDrag?.active)return;const meeting=meetings.find(m=>m.id===id);if(!meeting)return;
    $("meeting-title").textContent=(groups.find(g=>g.id===meeting.group)?.name||'グループ')+' MTG';
    $("meeting-time").textContent=label(meeting.date)+' '+time(meeting.start)+'〜'+time(meeting.end);
    $("meeting-members").replaceChildren();$("meeting-error").textContent='';
    if(meeting.limitedParticipants)$("meeting-members").append(el('li',null,'閲覧範囲外の対象者も参加しています。'));
    for(const person of meeting.members){const item=el('li'),name=el('span',null,people[person]);item.append(name);
      if(canEditMeeting(id)){
        const button=el('button','release-member','✖');button.type='button';button.disabled=!writable();button.setAttribute('aria-label',people[person]+'をMTGから外して可能時間に戻す');
        button.onclick=async()=>{if(!editable()||!canEditMeeting(id))return;try{if(await commit(S.release(snapshot(),id,{person}),'対象者の可能時間を戻しました')){if(meetings.some(m=>m.id===id))openMeeting(id);else $("meeting-dialog").close();}}catch(error){$("meeting-error").textContent=error.message;}};
        item.append(button);
      }
      $("meeting-members").append(item);
    }
    if(!$("meeting-dialog").open)$("meeting-dialog").showModal();
  }
  $("close-meeting").onclick=()=>{if(!busy)$("meeting-dialog").close();};
  $("meeting-dialog").addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $("undo").onclick=()=>history("undo");$("redo").onclick=()=>history("redo");
  $('date-select').onclick=openDatePicker;
  for(const [id,offset] of dateMoves)$(id).onclick=()=>selectDate(desktopDate(offset));
  for(const [id,entry] of [['desktop-entry-view',true],['desktop-schedule-view',false]])$(id).onclick=async()=>{
    if(busy||drag||rowDrag?.active||desktopMonth?.interacting||fullscreenPending)return;
    if(entry&&fullscreen){await exitScheduleFullscreen();if(fullscreen)return;}
    desktopEntry=entry;render();
  };
  $('desktop-entry-person').onchange=event=>{desktopTarget=event.currentTarget.value;renderDesktopEntry();};
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&drag){cancelDrag();return;}if(document.querySelector("dialog[open]")||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();history(e.shiftKey?"redo":"undo");}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();history("redo");}});
  let suppressClick=false;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function at(track,x){const r=track.getBoundingClientRect();return START+(x-r.left)/r.width*SPAN;}
  function snap(m){return Math.round(m/30)*30;}
  $("chart-scroll").addEventListener('pointerdown',e=>{
    if(e.button!==0||!editable())return;const track=e.target.closest('.timeline');if(!track)return;
    if(!canEditRow(track.dataset.row))return;
    const bar=e.target.closest('.event'),event=bar?displayBars.get(bar.dataset.id):null,side=e.target.dataset.resize;
    if(event?.kind==='meeting'&&(!event.inGroup||!canEditMeeting(event.id)))return;
    if(!event&&track.dataset.row.startsWith('g:')){toast('⚠️可能時間がありません');return;}
    drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,track,row:track.dataset.row,event,bar,mode:event?(side||(event.kind==='common'?'reserve':'move')):'create',origin:at(track,e.clientX),moved:false};
    if(event?.kind==='meeting')drag.available=S.meetingAvailability(snapshot(),event.id);
  });
  $("chart-scroll").addEventListener('dblclick',async event=>{
    const bar=event.target.closest('.event.availability');
    const range=bar&&displayBars.get(bar.dataset.id);
    if(event.button!==0||!range||drag||dialogOpen()||!canEditPerson(range.person)||!editable())return;
    const boundary=snap(at(bar.closest('.timeline'),event.clientX));
    if(boundary<=range.start||boundary>=range.end)return;
    event.preventDefault();
    try{await commit(S.splitPerson(snapshot(),range.person,range.date,range,boundary),'可能時間を分割しました');}
    catch(error){toast(error.message);}
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointer)return;const d=drag;
    if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
    if(!d.moved){d.moved=true;document.body.classList.add('dragging');d.bar?.classList.add('drag-source');d.preview=el('div','drag-preview');try{$('chart-scroll').setPointerCapture(e.pointerId);}catch{}}
    e.preventDefault();const track=d.track;let start,end;const cursor=at(track,e.clientX),restricted=d.event&&d.event.kind!=='availability';
    if(d.event?.kind==='meeting')({start,end}=S.meetingDragRange(d.event,d.mode,d.origin,cursor));
    else if(d.mode==='create'||d.mode==='reserve'){const a=clamp(Math.floor(d.origin/30)*30,START,END-30),b=clamp(snap(cursor),START,END);start=Math.min(a,b);end=Math.max(a+30,b);}
    else if(d.mode==='move'){const duration=d.event.end-d.event.start;start=clamp(d.event.start+snap(cursor-d.origin),START,END-duration);end=start+duration;}
    else if(d.mode==='start'){start=clamp(snap(cursor),restricted?d.event.start:START,d.event.end);end=d.event.end;}
    else{start=d.event.start;end=clamp(snap(cursor),start,restricted?d.event.end:END);}
    d.start=start;d.end=end;track.append(d.preview);d.preview.style.left=((start-START)/SPAN*100)+'%';d.preview.style.width=Math.max(0.25,(end-start)/SPAN*100)+'%';
    d.preview.textContent=start===end?(d.event?.kind==='common'?'全体をMTGにする':d.event?.kind==='meeting'?'MTGを解除':'削除'):time(start)+'–'+time(end);
    if(d.mode==='reserve'){let invalid=false;try{S.meetingSelection(d.event,d.origin,cursor);}catch{invalid=true;}d.preview.classList.toggle('invalid',invalid);d.preview.textContent=invalid?'⚠️可能時間がありません':'MTG '+time(start)+'–'+time(end);}
    if(d.event?.kind==='meeting'){
      const invalid=start<START||end>END||(start<end&&A.subtract([{start,end}],d.available).length>0);
      d.preview.classList.toggle('invalid',invalid);if(invalid)d.preview.textContent='⚠️可能時間がありません';
      const left=clamp(start,START,END),right=clamp(end,START,END);d.preview.style.left=((left-START)/SPAN*100)+'%';d.preview.style.width=Math.max(0.25,(right-left)/SPAN*100)+'%';
    }
    const scroll=$('chart-scroll'),rect=scroll.getBoundingClientRect();if(e.clientX>rect.right-35)scroll.scrollLeft+=14;else if(e.clientX<rect.left+130)scroll.scrollLeft-=14;
  },{passive:false});
  function cancelDrag(){if(!drag)return;drag.preview?.remove();drag.bar?.classList.remove("drag-source");try{$("chart-scroll").releasePointerCapture(drag.pointer);}catch{}drag=null;document.body.classList.remove("dragging");}
  document.addEventListener('pointerup',async e=>{
    if(!drag||e.pointerId!==drag.pointer)return;const d=drag;cancelDrag();
    try{
      if(d.moved||d.mode==='reserve'){suppressClick=true;setTimeout(()=>suppressClick=false,0);}
      if(d.mode==='reserve'){
        const range=S.meetingSelection(d.event,d.origin,d.moved?at(d.track,e.clientX):d.origin);
        await commit(S.reserve(snapshot(),d.event.group,selected,[range],excluded(d.event.group)),'対象メンバーのMTGを登録しました');
      }else if(d.moved){
        if(d.event?.kind==='meeting')Object.assign(d,S.meetingDragRange(d.event,d.mode,d.origin,at(d.track,e.clientX)));
        if(d.mode==='create')await commit(S.editPerson(snapshot(),Number(d.row.slice(2)),selected,[],[{start:d.start,end:d.end}]),'可能時間を追加しました');
        else if(d.start!==d.event.start||d.end!==d.event.end){
          const to=d.start<d.end?[{start:d.start,end:d.end}]:[];
          if(d.event.kind==='common')await commit(S.reserve(snapshot(),d.event.group,selected,A.subtract([d.event],to),excluded(d.event.group)),'対象メンバーのMTGを登録しました');
          else if(d.event.kind==='meeting')await commit(S.adjustMeeting(snapshot(),d.event.id,{start:d.start,end:d.end}),d.start===d.end?'MTGを削除し、対象者全員の可能時間を復元しました':'MTGの時間を変更し、対象者の可能時間に反映しました');
          else await commit(S.editPerson(snapshot(),d.event.person,selected,[d.event],to),to.length?'可能時間を変更しました':'可能時間を削除しました');
        }
      }else if(!d.event){const start=clamp(Math.floor(d.origin/30)*30,START,END-30);await commit(S.editPerson(snapshot(),Number(d.row.slice(2)),selected,[],[{start,end:start+30}]),'可能時間を追加しました');}
    }catch(error){toast(error.message);}finally{applyPending();}
  });
  document.addEventListener("pointercancel",cancelDrag);window.addEventListener("blur",cancelDrag);
  function buildPrint(scope='current'){
    $('print-area').replaceChildren();if(!ready)return;
    (scope==='week'?M.weekDates(selected):[selected]).forEach(date=>{const section=el('section','print-day'),heading=el('div','print-heading');heading.append(el('h2',null,'可能時間｜'+label(date)),el('span',null,'TOKI / '+people.length+'人'));section.append(heading,chartFor(date,false),el('p','print-footer','緑の枠：可能時間 ／ 色付きの枠：MTG ／ 目盛り：30分刻み'));$('print-area').append(section);});
  }
  let printScope="current";
  $("print-button").onclick=()=>$("print-dialog").showModal();$("close-print").onclick=()=>$("print-dialog").close();
  $("print-form").onsubmit=e=>{e.preventDefault();printScope=$("print-scope").value;buildPrint(printScope);$("print-dialog").close();window.print();};window.addEventListener("beforeprint",()=>buildPrint(printScope));window.addEventListener("afterprint",()=>{printScope="current";});
  window.addEventListener("storage",e=>{if(shared.enabled||e.key!==KEY)return;try{const saved=JSON.parse(e.newValue);if(saved?.version===3&&M.valid(saved.board)){pendingLocalBoard=saved.board;mobile?.refresh();if($("google-import-dialog").open)return;if(busy||dialogOpen()||drag||rowDrag?.active||meetingMenu?.pressing||mobile?.interacting||desktopMonth?.interacting){toast("別タブで予定が更新されています。操作を終了すると最新の内容を反映します。");return;}applyPending();}}catch{}});
  document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("close",applyPending));
  let rosterKind,rosterId,rosterContext;
  async function changeRoster(action,params,message){
    if(pendingBoard)throw Error('予定表が更新されました。画面を閉じてからやり直してください。');
    const generation=accountGeneration;
    setBusy(true);
    try{
      const result=await shared.changeRoster(action,params,revision);
      if(generation!==accountGeneration||result.left)return false;
      if(result.queued){toast('レビュー待ちとして登録しました');return true;}
      assign(result.board.payload);
      access=result.board.access;
      revision=result.board.version;
      undo=[];redo=[];
      if(result.id){
        const createdIndex=rowMetadata.findIndex(row=>row.id===result.id);
        const assigned=groups.filter(group=>group.members.includes(createdIndex));
        if(assigned.length)assigned.forEach(group=>groupView.show(group.id));else groupView.show('@unassigned');
      }
      render();toast(message);return true;
    }catch(error){
      if(generation===accountGeneration&&['CONFLICT','DENIED'].includes(error.code))await shared.refresh();
      throw error;
    }finally{if(generation===accountGeneration)setBusy(false);}
  }
  function openRoster(kind,id,context=null){
    if(!editable()||!canOpenRoster(kind,id))return;
    rosterKind=kind;rosterId=id;rosterContext=context;
    const group=kind==='group'?groups.find(g=>g.id===id):null;
    const label=kind==='group'?'グループ':kind==='place'?'場所・外部予定':'人';
    const request=canRequestRename(kind,id),readOnly=!request&&kind==='place'&&id!==null&&!canManage();
    $("roster-title").textContent=label+(id===null?'を追加':readOnly?'の操作':'を編集');
    $("roster-name-label").textContent=kind==='group'?"グループ名":kind==='place'?'場所・外部予定の名前':"名前";
    $("roster-name").value=kind==='group'?(group?.name||""):(id===null?"":people[id]);
    $("membership-label").textContent=kind==='group'?"所属する人（複数選択可）":"所属グループ（複数選択可）";
    const choices=kind==='group'?people.map((name,i)=>({name,value:String(i),checked:group?.members.includes(i)})):groups.map(g=>({name:g.name,value:g.id,checked:id!==null&&g.members.includes(id)}));
    $("roster-name").readOnly=readOnly;$("roster-submit").hidden=readOnly;$("roster-submit").textContent=request?'変更を依頼':'保存';
    $("roster-membership").hidden=request||readOnly;
    $("membership-options").replaceChildren();choices.forEach(c=>{const label=el("label","membership-option"),input=el("input");input.type="checkbox";input.value=c.value;input.checked=Boolean(c.checked);input.disabled=request||readOnly;label.append(input,document.createTextNode(c.name));$("membership-options").append(label);});
    if(!choices.length)$("membership-options").append(el("p","empty-members",kind==='group'?"人は後から追加できます。":"グループはまだありません。"));
    $("roster-error").textContent="";$("roster-delete-confirm").hidden=true;$("remove-row").hidden=id===null||!canManage()&&kind!=='place';
    $('roster-access').hidden=id===null||kind!=='person'||!canInspectPersonAccess();
    $('detach-place').hidden=!(access&&kind==='place'&&id!==null&&context);
    $("roster-dialog").showModal();$("roster-name").focus();
  }
  $("add-person").onclick=()=>openRoster(access?'place':'person',null);$("add-group").onclick=()=>openRoster("group",null);
  $("add-manual-person").onclick=()=>openRoster('person',null);
  $('roster-access').onclick=()=>{
    if(rosterKind!=='person'||rosterId===null||!canInspectPersonAccess())return;
    const person=rosterId,name=people[person];
    $('roster-dialog').close();void mobile.openPersonAccess({person,name});
  };
  $('place-help').querySelector('button').onclick=e=>e.currentTarget.setAttribute('aria-expanded',String(e.currentTarget.getAttribute('aria-expanded')!=='true'));
  ["close-roster","cancel-roster"].forEach(id=>$(id).onclick=()=>{if(!busy)$("roster-dialog").close();});
  $("roster-form").onsubmit=async e=>{e.preventDefault();if(!editable())return;
    try{const selected=[...$("membership-options").querySelectorAll("input:checked")].map(i=>i.value);
      if(canRequestRename(rosterKind,rosterId)){
        const kind=rosterKind,id=kind==='group'?rosterId:rowMetadata[rosterId].id;
        const generation=accountGeneration;
        setBusy(true);
        try{
          await shared.manage('rename_request',{p_name:$('roster-name').value,p_payload:{kind,id}});
          if(generation===accountGeneration){$('roster-dialog').close();toast('名前の変更依頼を登録しました');}
        }catch(error){
          if(generation===accountGeneration)throw error;
        }finally{if(generation===accountGeneration){setBusy(false);applyPending();}}
        return;
      }
      if(access&&rosterKind!=='group'&&rosterId===null){
        const place=rosterKind==='place';
        if(!place&&!canManage())return;
        if(place&&!canManage()&&!selected.length)throw Error('追加先のグループを選択してください。');
        if(await changeRoster(place?'add_place':'add_person',{p_name:$("roster-name").value,p_payload:{groups:selected}},place?'場所・外部予定を追加しました':'人を追加しました'))$("roster-dialog").close();
        return;
      }
      if(!canManage()||access&&rosterKind==='person'&&rosterId===null)return;
      const createdGroupId=rosterKind==='group'&&rosterId===null?crypto.randomUUID():null;
      const next=rosterKind==='group'?M.setGroup(snapshot(),createdGroupId??rosterId,$("roster-name").value,selected.map(Number)):M.setPerson(snapshot(),rosterId,$("roster-name").value,selected);
      if(await commit(next,rosterId===null?"追加しました":"更新しました")){if(createdGroupId)groupView.show(createdGroupId);$("roster-dialog").close();}
    }catch(error){$("roster-error").textContent=error.message;}
  };
  $("remove-row").onclick=()=>{const group=rosterKind==='group',name=group?groups.find(g=>g.id===rosterId).name:people[rosterId],count=events.filter(e=>group?e.group===rosterId:e.person===rosterId).length;
    $("roster-delete-message").textContent=group?`${name}を削除し、このグループのMTGを解除して対象者の可能時間を戻します。所属する人は残ります。`:
      access?(rosterKind==='place'?`「${name}」を完全に削除します。すべてのグループから外れ、空き時間${count}件とMTGでの場所の確保が削除されます。この操作は元に戻せません。`:
        `「${name}」を削除します。アカウントがひも付いている場合は組織から脱退となります。この行の空き時間${count}件とMTGへの参加が削除されます。この操作は元に戻せません。`):
        `${name}と予定${count}件、すべてのグループへの所属を削除します。「元に戻す」で復元できます。`;
    $("roster-delete-confirm").hidden=false;
  };
  $("cancel-remove").onclick=()=>$("roster-delete-confirm").hidden=true;
  $("confirm-remove").onclick=async()=>{
    if(!editable())return;
    try{
      if(access&&rosterKind!=='group'){
        if(!canManage()&&!isPlace(rosterId))return;
        if(await changeRoster('remove_row',{p_member:rowMetadata[rosterId].id},'削除しました'))$("roster-dialog").close();
      }else if(canManage()){
        const next=rosterKind==='group'?S.removeGroup(snapshot(),rosterId):M.removePerson(snapshot(),rosterId);
        if(await commit(next,"削除しました。「元に戻す」で復元できます。"))$("roster-dialog").close();
      }
    }catch(error){$("roster-error").textContent=error.code==='DENIED'&&rosterKind==='place'?'この場所・外部予定を完全に削除する権限がありません。グループから外すか、管理者にご相談ください。':error.message;}
  };
  $('detach-place').onclick=async()=>{
    if(!editable()||!access||!rosterContext||!isPlace(rosterId))return;
    try{if(await changeRoster('detach_place',{p_member:rowMetadata[rosterId].id,p_payload:rosterContext},'このグループから外しました'))$('roster-dialog').close();}
    catch(error){$('roster-error').textContent=error.message;}
  };

  $("auth-retry").onclick=()=>location.reload();
  $("copy-link").onclick=async()=>{
    try{await navigator.clipboard.writeText(shared.shareUrl());toast("組織URLをコピーしました");}
    catch{$("share-url").value=shared.shareUrl();$("share-dialog").showModal();$("share-url").select();}
  };
  $("close-share").onclick=()=>$("share-dialog").close();
  document.addEventListener('click',event=>{
    for(const menu of document.querySelectorAll('#schedule-app .toolbar-menu[open],#mobile-app .toolbar-menu[open]')){
      if(!menu.contains(event.target)||event.target.closest('.toolbar-menu-panel > button'))menu.open=false;
    }
  });
  const fullscreenRoot=document.documentElement,fullscreenButton=$("fullscreen-button");
  let fullscreen=false,nativeFullscreen=false,fullscreenPending=false,pageScroll=[0,0];
  function setFullscreen(value){
    fullscreen=value;fullscreenRoot.classList.toggle("schedule-fullscreen",value);
    const name=value?"全画面表示を終了":"スケジュールを全画面表示";
    fullscreenButton.setAttribute("aria-label",name);fullscreenButton.setAttribute("aria-pressed",String(value));fullscreenButton.title=name;
    if(!value){nativeFullscreen=false;window.scrollTo(...pageScroll);fullscreenButton.focus({preventScroll:true});}
  }
  async function exitScheduleFullscreen(){
    if(fullscreenPending)return;
    if(document.fullscreenElement===fullscreenRoot){
      try{await document.exitFullscreen();}catch{toast("右上の終了ボタン、またはEscキーでもう一度終了してください。");return;}
    }
    if(fullscreen)setFullscreen(false);
  }
  fullscreenButton.onclick=async()=>{
    if(fullscreenPending||drag||rowDrag?.active)return;
    if(fullscreen){await exitScheduleFullscreen();return;}
    pageScroll=[window.scrollX,window.scrollY];setFullscreen(true);
    // Keep the viewport-sized layout when native fullscreen is unavailable (e.g. an embedded browser).
    if(fullscreenRoot.requestFullscreen&&document.fullscreenEnabled){
      fullscreenPending=true;fullscreenButton.disabled=true;
      try{await fullscreenRoot.requestFullscreen();nativeFullscreen=document.fullscreenElement===fullscreenRoot;}
      catch{nativeFullscreen=false;}
      finally{fullscreenPending=false;fullscreenButton.disabled=false;}
    }
  };
  document.addEventListener("fullscreenchange",()=>{
    if(document.fullscreenElement===fullscreenRoot){nativeFullscreen=true;}
    else if(fullscreen&&nativeFullscreen)setFullscreen(false);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&fullscreen&&!dialogOpen()&&!drag&&!rowDrag?.active&&!fullscreenPending){event.preventDefault();exitScheduleFullscreen();}
  },true);
  meetingMenu=window.TokiMeetingMenu({root:$("chart-scroll"),resolve:bar=>displayBars.get(bar.dataset.id),board:snapshot,canOpen:()=>ready&&!busy&&!rowDrag?.active&&!dialogOpen(),canDelete:target=>editable()&&(target.kind==='availability'?canEditPerson(target.person):canEditMeeting(target.id)),onOpen:cancelDrag,release:target=>commit(S.release(snapshot(),target.id,target.person===null?{}:{person:target.person}),target.person===null?'MTGを削除し、対象者全員の可能時間を復元しました':'この人のMTGを削除し、可能時間を復元しました'),removeAvailability:target=>commit(S.editPerson(snapshot(),target.person,target.date,[target],[]),'可能時間を削除しました'),canAdjustTime,canSaveTime,adjustTime:adjustMenuTime,canDuplicate,openDuplicate:openDuplicatePicker,notify:toast,settled:applyPending});
  rowDrag=window.TokiRowDrag({scroll:$("chart-scroll"),board:snapshot,canStart:()=>canManage()&&editable()&&!drag&&!dialogOpen(),commit,settled:applyPending,notify:toast,moveBetweenGroups:false});
  window.TokiAvailabilityUI({board:snapshot,today,excluded,notify:toast,canOpen:()=>ready&&!drag&&!rowDrag?.active});
  window.TokiMeetingExportUI({board:snapshot,today,notify:toast,canOpen:()=>ready&&!busy&&!drag&&!rowDrag?.active&&!dialogOpen()});
  googleImportUI=window.TokiGoogleImportUI({
    context:()=>({board:snapshot(),fingerprint:JSON.stringify(snapshot()),pending:Boolean(pendingBoard||pendingLocalBoard)}),
    today,
    linkGuest:shared.linkGoogle,
    canOpen:()=>editable()&&!drag&&canImport()&&navigator.onLine!==false,
    canImportPerson:person=>!isPlace(person)&&canEditPerson(person),
    apply:async(plan,fingerprint)=>{
      if(pendingBoard||pendingLocalBoard||JSON.stringify(snapshot())!==fingerprint)throw Error('予定表が更新されています。画面を閉じ、最新の予定を確認してから再取得してください。');
      if(!await commit(plan.board,'Googleカレンダーの空き時間を可能時間として反映しました'))throw Error(lastSaveError||'保存できませんでした。接続と最新の予定を確認して、もう一度お試しください。');
      selected=plan.range.first;render();return true;
    }
  });
  groupView=window.TokiGroupView({context:()=>({scope:viewScope(),board:snapshot(),ready,showAll:Boolean(shared.guest),prompt:mobile?.shouldPromptGroups}),change:render});
  companyUI=window.TokiCompanyUI();
  const editEntry=async(next,message,fingerprint)=>{
    if(pendingBoard||pendingLocalBoard||JSON.stringify(snapshot())!==fingerprint)throw Error('予定表が更新されました。画面を閉じ、最新の予定から編集してください。');
    if(!await commit(next,message))throw Error(lastSaveError||'保存できませんでした。接続と最新の予定を確認して、もう一度お試しください。');
    return true;
  };
  mobile=window.TokiMobileUI({
    context:entryContext,
    interacting:()=>Boolean(drag||rowDrag?.active||desktopMonth?.interacting),
    selectDate,today,openDatePicker,openDuplicatePicker,canDuplicate,canAdjustTime,canSaveTime,adjustTime:adjustMenuTime,excluded,toggleMember,openRoster,openMeeting,exitFullscreen:exitScheduleFullscreen,
    canManage,canEditRow,ownPerson,linkedPerson,isPlace,
    memberMeetingsEnabled,canScheduleMeeting,canEditMeeting,
    canInspectPersonAccess,canOpenRoster,
    personAccess:companyUI.personAccess,personAccessChoices:companyUI.personAccessChoices,
    visibleGroup:id=>groupView.visible(id),openGroupView:()=>groupView.open(),refreshGroupView:()=>groupView.refresh(),
    commit:editEntry,
    fillBulkOptions,bulkExcluded,scheduleCount,
    notify:toast,settled:applyPending
  });
  desktopMonth=window.TokiMobileMonth({
    context:entryContext,today,canEditRow,instantMouse:true,commit:editEntry,notify:toast,
    openAvailability:mobile.openAvailability,openMeeting:mobile.openMeeting,
    settled:()=>{applyPending();if(desktopEntry)render();}
  });
  $('desktop-entry').append(desktopMonth.node);
  window.addEventListener('online',()=>setBusy(busy));window.addEventListener('offline',()=>setBusy(busy));
  function resetView(){
    accountGeneration++;ready=false;busy=false;pendingBoard=null;pendingLocalBoard=null;revision=null;undo=[];redo=[];duplication=null;
    bulkModes.clear();bulkCache.clear();desktopEntry=false;desktopTarget=null;desktopMonth?.reset();
    access=null;
    cancelDrag();rowDrag?.cancel();exitScheduleFullscreen();
    assign({schemaVersion:4,people:[],groups:[],events:[],meetings:[]});displayBars.clear();
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    for(const id of ['chart','print-area','membership-options','meeting-members','google-import-rows','meeting-export-groups','company-members','company-invites','export-person','google-import-person','group-view-choices'])$(id)?.replaceChildren();
    for(const id of ['roster-name','share-url','company-invite-email','company-invite-name'])$(id).value='';
    for(const id of ['meeting-title','meeting-time','meeting-menu-title','meeting-menu-time','meeting-menu-scope','meeting-menu-creator','google-import-summary','company-dialog-code','company-dialog-user'])if($(id))$(id).textContent='';
    document.querySelectorAll('textarea').forEach(n=>{n.value='';});
    $("schedule-app").hidden=true;$("mobile-app").hidden=true;$("auth-gate").hidden=initializing;
    $("app-loading").hidden=!initializing;
    mobile?.reset();mobile?.refresh();
  }
  if(shared.enabled){
    try{await shared.initialize({
      board:receiveBoard,
      account:()=>{companyUI.render();mobile?.refresh();},
      reset:resetView,
      warning:toast,
      state:connectionState,
      error:error=>{
        $("auth-message").textContent=error.message;$("auth-retry").hidden=false;
        if(error.code==="LINK"){ready=false;$("schedule-app").hidden=true;$("auth-gate").hidden=initializing;}
      }
    });}
    catch(error){$("auth-message").textContent=error.message;$("auth-retry").hidden=false;}
    finally{initializing=false;$("app-loading").hidden=true;$("auth-gate").hidden=ready;}
  }
  render();
  const linkedReview=shared.reviewLink?.();
  if(ready&&linkedReview&&linkedReview.organization===shared.company?.id){
    if($('group-view-dialog').open)$('group-view-dialog').close();
    $('company-button').click();
  }
  if(ready&&shared.takeGuestImport?.()){
    if($('group-view-dialog').open)$('group-view-dialog').close();
    $('google-import-button').click();
    toast('Googleカレンダーの閲覧を許可すると、取り込みを続けられます。');
  }
  if(loadFailed)toast("保存データを読み込めないため、元の予定を表示しています。");
})();

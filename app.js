"use strict";
(async () => {
  await window.TOKI_DATA_READY;
  const $ = id => document.getElementById(id);
  let {people,dates,availability} = window.TOKI_DATA;
  const shared=window.TokiShared;
  const M=window.TokiModel,A=window.TokiAvailability,S=window.TokiSchedule;
  let rowDrag=null,googleImportUI=null,pendingLocalBoard=null;
  let groups=[],ready=!shared.enabled,busy=false,revision=null,pendingBoard=null;
  $("schedule-app").hidden=shared.enabled;
  $("auth-gate").hidden=!shared.enabled;
  $("copy-link").hidden=!shared.enabled;
  if(shared.enabled)$("storage-note").textContent="共有URLを知っている人は全員の予定を編集できます。変更は約5秒ごとに同期します。同時更新の上書きを防止します。";
  const START=480, END=1440, SPAN=END-START, KEY="toki-availability-v3",LEGACY_KEY="toki-availability-2026-v1",VIEW_KEY="toki-selected-date";
  const colors=["#2b7558","#367f88","#526ab1","#896899"];
  const minute=t=>{const [h,m]=t.split(":").map(Number);return h*60+m;};
  const time=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const label=d=>new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"short",timeZone:"UTC"}).format(new Date(d+"T00:00:00Z"));
  const clone=o=>JSON.parse(JSON.stringify(o));
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
  let events=[],meetings=[],displayBars=new Map();
  const snapshot=()=>M.clone({schemaVersion:4,people,groups,events,meetings});
  const assign=value=>{const board=S.migrate(value);people=M.clone(board.people);groups=M.clone(board.groups);events=M.clone(board.events);meetings=M.clone(board.meetings);};
  const dialogOpen=()=>Boolean(document.querySelector("dialog[open]"));
  let excludedGroups={};
  try{const saved=JSON.parse(localStorage.getItem('toki-excluded-members')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))excludedGroups=saved;}catch{}
  const excluded=id=>Array.isArray(excludedGroups[id])?excludedGroups[id].filter(n=>typeof n==='string'):[];
  function toggleMember(group,name){if(drag||rowDrag?.active||busy)return;const values=new Set(excluded(group));if(values.has(name))values.delete(name);else values.add(name);excludedGroups[group]=[...values];try{localStorage.setItem('toki-excluded-members',JSON.stringify(excludedGroups));}catch{}render();}
  let collapsed=new Set();
  try{collapsed=new Set(JSON.parse(localStorage.getItem("toki-collapsed-groups")||"[]"));}catch{}
  availability.forEach((days,person)=>days.forEach((value,d)=>value.split(",").filter(Boolean).forEach((range,n)=>{const [start,end]=range.split("-").map(minute);events.push({id:`seed-${person}-${d}-${n}`,person,date:dates[d],start,end});})));
  let selected=dates[0], undo=[], redo=[], drag=null, toastTimer, loadFailed=false;
  try{const savedDate=localStorage.getItem(VIEW_KEY);if(M.validDate(savedDate))selected=savedDate;}catch{}
  try{if(!shared.enabled){const raw=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);if(raw){const saved=JSON.parse(raw);const board=saved.version===3?saved.board:M.upgrade(saved.version===2?saved.board:{people,dates,events:saved.events});if(!M.valid(board))throw Error("Invalid saved data");assign(board);}}}
  catch{loadFailed=true;$("save-status").textContent="保存データを読めませんでした";}
  function toast(message){$("toast").textContent=message;$("toast").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").hidden=true,3500);}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({version:3,board:snapshot()}));$("save-status").textContent="このブラウザーに保存済み";}catch{$("save-status").textContent="保存できません（この画面のみ）";toast("自動保存できません。閉じる前にPDF出力してください。");}}
  const writable=()=>ready&&(!shared.enabled||shared.online);
  const editable=()=>!busy&&writable()&&!rowDrag?.active;
  function setBusy(value){
    busy=value;const disabled=value||!writable();
    $("schedule-app").setAttribute('aria-busy',String(value));
    $("schedule-app").classList.toggle('read-only',shared.enabled&&!shared.online);
    $("roster-form").querySelectorAll("button").forEach(b=>b.disabled=value);
    for(const id of ['add-person','add-group','remove-row','confirm-remove'])$(id).disabled=disabled;
    $("roster-form").querySelector('button[type="submit"]').disabled=disabled;
    $("meeting-dialog").querySelectorAll('.release-member').forEach(button=>button.disabled=disabled);
    $("export-availability").disabled=!ready||(!people.length&&!groups.length);
    $("google-import-button").disabled=disabled||!people.length||navigator.onLine===false;
    $("undo").disabled=disabled||!undo.length;$("redo").disabled=disabled||!redo.length;
    $("chart").querySelectorAll('.row-drag-handle,.bottom-add').forEach(button=>button.disabled=disabled);
    if(ready&&shared.enabled&&!shared.online&&!busy)$("save-status").textContent='オフライン・閲覧のみ';
    googleImportUI?.refresh();
  }
  function connectionState({online,fetchedAt}){
    if(!online){cancelDrag();rowDrag?.cancel();}
    const note=$("connection-status");note.hidden=online;
    note.textContent='オフライン・閲覧のみ。接続が戻ると最新の予定を取得します。'+(fetchedAt?' 最終取得：'+new Date(fetchedAt).toLocaleString('ja-JP'):'');
    setBusy(busy);
    if(ready&&!busy&&!pendingBoard)$("save-status").textContent=online?'共有保存・同期中':'オフライン・閲覧のみ';
  }
  async function saveNext(next){
    if(!editable())return false;
    if(Array.isArray(next))next={...snapshot(),events:next};
    if(!M.valid(next)){toast("入力内容を確認してください。");return false;}
    if(!shared.enabled){assign(next);persist();return true;}
    setBusy(true);$("save-status").textContent="共有先に保存中…";
    try{const saved=await shared.save(next,revision);assign(saved.payload);revision=saved.version;$("save-status").textContent="共有保存済み";return true;}
    catch(error){$("save-status").textContent="未保存・最新の予定を確認してください";$("meeting-error").textContent=error.message;$("roster-error").textContent=error.message;toast(error.message);await shared.refresh();return false;}
    finally{setBusy(false);}
  }
  async function commit(next,message){const before=snapshot();if(!await saveNext(next))return false;undo.push(before);if(undo.length>80)undo.shift();redo=[];render();toast(message);applyPending();return true;}
  async function history(direction){if(!editable())return;const from=direction==="undo"?undo:redo,to=direction==="undo"?redo:undo;if(!from.length)return;const before=snapshot();if(!await saveNext(clone(from.at(-1)))){applyPending();return;}to.push(before);from.pop();render();toast(direction==="undo"?"元に戻しました":"やり直しました");applyPending();}
  function receiveBoard(board){
    if(board.version<=revision)return;
    const payload=board.payload;
    if(!M.valid(payload)){$("auth-message").textContent="共有データの形式を確認できません。再読み込みしてください。";$("auth-retry").hidden=false;return;}
    if(busy||drag||rowDrag?.active||dialogOpen()){pendingBoard=board;$("save-status").textContent="他のメンバーが更新しました";return;}
    const changed=revision!==null;assign(payload);revision=board.version;undo=[];redo=[];ready=true;
    $("auth-gate").hidden=true;$("schedule-app").hidden=false;$("save-status").textContent="共有保存済み";render();if(changed)toast("他のメンバーの変更を反映しました");
  }
  function applyPending(){
    if(busy||drag||rowDrag?.active||dialogOpen())return;
    if(pendingBoard){const board=pendingBoard;pendingBoard=null;receiveBoard(board);}
    if(pendingLocalBoard){assign(pendingLocalBoard);pendingLocalBoard=null;undo=[];redo=[];render();toast('別タブの変更を反映しました');}
  }
  function options(target,values,text){values.forEach((v,i)=>{const option=el("option",null,text(v,i));option.value=v;target.append(option);});}
  function renderDates(){const week=M.weekDates(selected);$("date-select").replaceChildren();options($("date-select"),week,label);$("date-select").value=selected;$("week-range").textContent=`${label(week[0])} — ${label(week[6])}`;for(const [id,offset] of [["previous",-1],["next",1],["previous-week",-7],["next-week",7]])$(id).disabled=!M.shiftDate(selected,offset);}
  function selectDate(date){if(!M.validDate(date)||drag||rowDrag?.active||dialogOpen())return;selected=date;try{localStorage.setItem(VIEW_KEY,date);}catch{}render();}
  function chartFor(date,interactive=true){
    const board=snapshot(),chart=el('div','chart'),rows=M.rows(board,interactive?collapsed:new Set());
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
      if(interactive){const handle=el('button','row-drag-handle','⋮⋮');handle.type='button';handle.setAttribute('aria-label',name+(group?'のグループを移動':'の行を移動'));handle.title='ドラッグで移動／上下キーで並べ替え';nameCell.append(handle);}
      if(group&&interactive){const toggle=el('button','group-toggle',collapsed.has(group.id)?'▸':'▾');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed.has(group.id)));toggle.setAttribute('aria-label',group.name+(collapsed.has(group.id)?'を展開':'を折りたたむ'));toggle.onclick=()=>{if(drag||rowDrag?.active)return;if(collapsed.has(group.id))collapsed.delete(group.id);else collapsed.add(group.id);try{localStorage.setItem('toki-collapsed-groups',JSON.stringify([...collapsed]));}catch{}render();};nameCell.append(toggle);}
      else nameCell.append(el('span','person-dot'));
      const nameLabel=el(interactive?'button':'span','row-name',name);
      if(interactive){nameLabel.type='button';nameLabel.title=name+'を編集・削除';nameLabel.setAttribute('aria-label',name+'を編集・削除');nameLabel.onclick=()=>openRoster(group?'group':'person',group?group.id:person);}
      nameCell.append(nameLabel);
      if(group)nameCell.append(el('span','group-size',S.participants(board,group.id,excluded(group.id)).length+'/'+group.members.length));
      if(nested&&interactive){const toggle=el('button','member-active-toggle',inactive?'−':'✓');toggle.type='button';toggle.setAttribute('aria-pressed',String(!inactive));toggle.setAttribute('aria-label',name+(inactive?'を':'を')+groups.find(g=>g.id===context).name+(inactive?'の対象に戻す':'の対象から一時除外'));toggle.title=inactive?'この端末で対象に戻す':'この端末で一時除外（取り消し線）';toggle.onclick=()=>toggleMember(context,name);nameCell.append(toggle);}
      const track=el('div','timeline');track.dataset.row=key;
      if(interactive){track.tabIndex=0;track.setAttribute('role','group');track.setAttribute('aria-label',name+(group?'の共通の可能時間。両端を縮めてMTGを登録':'の可能時間。空き枠をクリック・ドラッグで追加'));}
      const list=S.ranges(board,key,date,group?excluded(group.id):[]).map(range=>({...range,date,row:key,kind:group?'common':'availability',person,group:group?.id}));
      for(const meeting of meetings.filter(m=>m.date===date&&(group?m.group===group.id:m.members.includes(person))))list.push({...meeting,row:key,kind:'meeting',inGroup:Boolean(group)});
      list.sort((a,b)=>a.start-b.start||a.end-b.end);const lanes=[];
      list.forEach((event,index)=>{
        const displayId=key+':'+date+':'+index;if(interactive)displayBars.set(displayId,event);
        let lane=lanes.findIndex(end=>end<=event.start);if(lane<0)lane=lanes.length;lanes[lane]=event.end;
        const bar=el(interactive?'button':'div','event '+event.kind+(event.kind==='meeting'&&!group?' locked-meeting':''));if(interactive)bar.type='button';bar.dataset.id=displayId;
        if(event.kind==='meeting')bar.style.setProperty('--person-color',S.color(event.group,groups));
        bar.style.left=((event.start-START)/SPAN*100)+'%';bar.style.width=((event.end-event.start)/SPAN*100)+'%';if(lane)bar.style.top=(5+lane*33)+'px';
        const title=event.kind==='meeting'?(group?event.members.map(p=>people[p]).join('，')+' MTG':groups.find(g=>g.id===event.group)?.name+' MTG'):'可能時間';
        bar.append(el('span','event-title',title),el('span','event-time',time(event.start)+'–'+time(event.end)));
        bar.title=name+' / '+title+' '+time(event.start)+'〜'+time(event.end);bar.setAttribute('aria-label',name+' '+title+' '+time(event.start)+'から'+time(event.end));
        if(interactive){
          if(event.kind!=='meeting'||group)['start','end'].forEach(side=>{const handle=el('span','resize-handle '+side);handle.dataset.resize=side;handle.setAttribute('aria-hidden','true');bar.append(handle);});
          bar.addEventListener('click',e=>{if(suppressClick){e.preventDefault();return;}if(event.kind==='meeting'&&group)openMeeting(event.id);});
        }
        track.append(bar);
      });
      if(lanes.length>1)track.style.minHeight=(lanes.length*33+10)+'px';
      if(!list.length)track.append(el('span','empty-label',group?'共通の可能時間なし':'可能時間なし'));
      row.append(nameCell,track);chart.append(row);
    });
    if(interactive){const add=el('div','bottom-add-row'),button=el('button','bottom-add','＋ 人を追加');button.type='button';button.onclick=()=>openRoster('person',null);add.append(button);chart.append(add);}
    return chart;
  }
  function render(){if(rowDrag?.active)return;document.querySelector(".member-count").textContent=`${people.length}人 · ${groups.length}グループ`;const scroll=$("chart-scroll"),x=scroll.scrollLeft,y=scroll.scrollTop;$("chart").replaceWith(Object.assign(chartFor(selected),{id:"chart"}));scroll.scrollLeft=x;scroll.scrollTop=y;renderDates();setBusy(busy);const list=events.filter(e=>e.date===selected);$("day-summary").textContent=`${new Set(list.filter(e=>e.person!==undefined).map(e=>e.person)).size}/${people.length}人 · ${list.length}枠`;}
  function openMeeting(id){
    if(busy||!ready||rowDrag?.active)return;const meeting=meetings.find(m=>m.id===id);if(!meeting)return;
    $("meeting-title").textContent=(groups.find(g=>g.id===meeting.group)?.name||'グループ')+' MTG';
    $("meeting-time").textContent=label(meeting.date)+' '+time(meeting.start)+'〜'+time(meeting.end);
    $("meeting-members").replaceChildren();$("meeting-error").textContent='';
    for(const person of meeting.members){const item=el('li'),name=el('span',null,people[person]),button=el('button','release-member','✖');button.type='button';button.disabled=!writable();button.setAttribute('aria-label',people[person]+'をMTGから外して可能時間に戻す');button.onclick=async()=>{if(!editable())return;try{if(await commit(S.release(snapshot(),id,{person}),'対象者の可能時間を戻しました')){if(meetings.some(m=>m.id===id))openMeeting(id);else $("meeting-dialog").close();}}catch(error){$("meeting-error").textContent=error.message;}};item.append(name,button);$("meeting-members").append(item);}
    if(!$("meeting-dialog").open)$("meeting-dialog").showModal();
  }
  $("close-meeting").onclick=()=>{if(!busy)$("meeting-dialog").close();};
  $("meeting-dialog").addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $("undo").onclick=()=>history("undo");$("redo").onclick=()=>history("redo");
  $("date-select").onchange=e=>selectDate(e.target.value);for(const [id,offset] of [["previous",-1],["next",1],["previous-week",-7],["next-week",7]])$(id).onclick=()=>selectDate(M.shiftDate(selected,offset));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&drag){cancelDrag();return;}if(document.querySelector("dialog[open]")||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();history(e.shiftKey?"redo":"undo");}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();history("redo");}});
  let suppressClick=false;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function at(track,x){const r=track.getBoundingClientRect();return START+(x-r.left)/r.width*SPAN;}
  function snap(m){return Math.round(m/30)*30;}
  $("chart-scroll").addEventListener('pointerdown',e=>{
    if(e.button!==0||!editable())return;const track=e.target.closest('.timeline');if(!track)return;
    const bar=e.target.closest('.event'),event=bar?displayBars.get(bar.dataset.id):null,side=e.target.dataset.resize;
    if(event&&event.kind!=='availability'&&!side)return;
    if(!event&&track.dataset.row.startsWith('g:'))return;
    drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,track,row:track.dataset.row,event,bar,mode:event?(side||'move'):'create',origin:at(track,e.clientX),moved:false};
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.pointer)return;const d=drag;
    if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;
    if(!d.moved){d.moved=true;document.body.classList.add('dragging');d.bar?.classList.add('drag-source');d.preview=el('div','drag-preview');try{$('chart-scroll').setPointerCapture(e.pointerId);}catch{}}
    e.preventDefault();let track=d.track;if(d.mode==='move'){const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.timeline');if(hit)track=hit;}
    d.row=track.dataset.row;let start,end;const cursor=at(d.track,e.clientX),restricted=d.event&&d.event.kind!=='availability';
    if(d.mode==='create'){const a=clamp(Math.floor(d.origin/30)*30,START,END-30),b=clamp(snap(cursor),START,END);start=Math.min(a,b);end=Math.max(a+30,b);}
    else if(d.mode==='move'){const duration=d.event.end-d.event.start;start=clamp(d.event.start+snap(cursor-d.origin),START,END-duration);end=start+duration;}
    else if(d.mode==='start'){start=clamp(snap(cursor),restricted?d.event.start:START,d.event.end);end=d.event.end;}
    else{start=d.event.start;end=clamp(snap(cursor),start,restricted?d.event.end:END);}
    d.start=start;d.end=end;track.append(d.preview);d.preview.style.left=((start-START)/SPAN*100)+'%';d.preview.style.width=Math.max(0.25,(end-start)/SPAN*100)+'%';
    d.preview.textContent=start===end?(d.event?.kind==='common'?'全体をMTGにする':d.event?.kind==='meeting'?'MTGを解除':'削除'):time(start)+'–'+time(end);
    const scroll=$('chart-scroll'),rect=scroll.getBoundingClientRect();if(e.clientX>rect.right-35)scroll.scrollLeft+=14;else if(e.clientX<rect.left+130)scroll.scrollLeft-=14;
  },{passive:false});
  function cancelDrag(){if(!drag)return;drag.preview?.remove();drag.bar?.classList.remove("drag-source");try{$("chart-scroll").releasePointerCapture(drag.pointer);}catch{}drag=null;document.body.classList.remove("dragging");}
  document.addEventListener('pointerup',async e=>{
    if(!drag||e.pointerId!==drag.pointer)return;const d=drag;cancelDrag();
    try{
      if(d.moved){
        suppressClick=true;setTimeout(()=>suppressClick=false,0);
        if(!d.row.startsWith('p:')&&d.event?.kind==='availability')throw Error('個人の可能時間は人の行へ移動してください。');
        if(d.mode==='create')await commit(S.editPerson(snapshot(),Number(d.row.slice(2)),selected,[],[{start:d.start,end:d.end}]),'可能時間を追加しました');
        else if(d.start!==d.event.start||d.end!==d.event.end||d.row!==d.event.row){
          const to=d.start<d.end?[{start:d.start,end:d.end}]:[];
          if(d.event.kind==='common')await commit(S.reserve(snapshot(),d.event.group,selected,A.subtract([d.event],to),excluded(d.event.group)),'対象メンバーのMTGを登録しました');
          else if(d.event.kind==='meeting')await commit(S.release(snapshot(),d.event.id,{start:d.start,end:d.end}),'MTGを短縮し、可能時間を戻しました');
          else if(d.row!==d.event.row&&to.length)await commit(S.movePersonRange(snapshot(),d.event.person,Number(d.row.slice(2)),selected,d.event,to[0]),'可能時間を移動しました');
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
  window.addEventListener("storage",e=>{if(shared.enabled||e.key!==KEY)return;try{const saved=JSON.parse(e.newValue);if(saved?.version===3&&M.valid(saved.board)){if($("google-import-dialog").open){pendingLocalBoard=saved.board;return;}if(dialogOpen()||drag||rowDrag?.active){toast("別タブで変更されています。この画面の編集を保存すると上書きされます。");return;}assign(saved.board);undo=[];redo=[];render();toast("別タブの変更を反映しました");}}catch{}});
  document.querySelectorAll("dialog").forEach(dialog=>dialog.addEventListener("close",applyPending));
  let rosterKind,rosterId;
  function openRoster(kind,id){
    if(!editable())return;rosterKind=kind;rosterId=id;
    const group=kind==='group'?groups.find(g=>g.id===id):null;
    $("roster-title").textContent=(kind==='group'?"グループ":"人")+(id===null?"を追加":"を編集");
    $("roster-name-label").textContent=kind==='group'?"グループ名":"名前";
    $("roster-name").value=kind==='group'?(group?.name||""):(id===null?"":people[id]);
    $("membership-label").textContent=kind==='group'?"所属する人（複数選択可）":"所属グループ（複数選択可）";
    const choices=kind==='group'?people.map((name,i)=>({name,value:String(i),checked:group?.members.includes(i)})):groups.map(g=>({name:g.name,value:g.id,checked:id!==null&&g.members.includes(id)}));
    $("membership-options").replaceChildren();choices.forEach(c=>{const label=el("label","membership-option"),input=el("input");input.type="checkbox";input.value=c.value;input.checked=Boolean(c.checked);label.append(input,document.createTextNode(c.name));$("membership-options").append(label);});
    if(!choices.length)$("membership-options").append(el("p","empty-members",kind==='group'?"人は後から追加できます。":"グループはまだありません。"));
    $("roster-error").textContent="";$("roster-delete-confirm").hidden=true;$("remove-row").hidden=id===null;
    $("roster-dialog").showModal();$("roster-name").focus();
  }
  $("add-person").onclick=()=>openRoster("person",null);$("add-group").onclick=()=>openRoster("group",null);
  ["close-roster","cancel-roster"].forEach(id=>$(id).onclick=()=>{if(!busy)$("roster-dialog").close();});
  $("roster-form").onsubmit=async e=>{e.preventDefault();if(!editable())return;
    try{const selected=[...$("membership-options").querySelectorAll("input:checked")].map(i=>i.value);
      const next=rosterKind==='group'?M.setGroup(snapshot(),rosterId??crypto.randomUUID(),$("roster-name").value,selected.map(Number)):M.setPerson(snapshot(),rosterId,$("roster-name").value,selected);
      if(await commit(next,rosterId===null?"追加しました":"更新しました"))$("roster-dialog").close();
    }catch(error){$("roster-error").textContent=error.message;}
  };
  $("remove-row").onclick=()=>{const group=rosterKind==='group',name=group?groups.find(g=>g.id===rosterId).name:people[rosterId],count=events.filter(e=>group?e.group===rosterId:e.person===rosterId).length;
    $("roster-delete-message").textContent=group?`${name}を削除し、このグループのMTGを解除して対象者の可能時間を戻します。所属する人は残ります。`:`${name}と予定${count}件、すべてのグループへの所属を削除します。「元に戻す」で復元できます。`;
    $("roster-delete-confirm").hidden=false;
  };
  $("cancel-remove").onclick=()=>$("roster-delete-confirm").hidden=true;
  $("confirm-remove").onclick=async()=>{if(!editable())return;try{const next=rosterKind==='group'?S.removeGroup(snapshot(),rosterId):M.removePerson(snapshot(),rosterId);if(await commit(next,"削除しました。「元に戻す」で復元できます。"))$("roster-dialog").close();}catch(error){$("roster-error").textContent=error.message;}};

  $("auth-retry").onclick=()=>location.reload();
  $("copy-link").onclick=async()=>{
    try{await navigator.clipboard.writeText(shared.shareUrl());toast("共有URLをコピーしました");}
    catch{$("share-url").value=shared.shareUrl();$("share-dialog").showModal();$("share-url").select();}
  };
  $("close-share").onclick=()=>$("share-dialog").close();
  $("hint-button").onclick=()=>{if(!drag&&!rowDrag?.active)$("hint-dialog").showModal();};
  $("close-hint").onclick=()=>$("hint-dialog").close();
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
  rowDrag=window.TokiRowDrag({scroll:$("chart-scroll"),board:snapshot,canStart:()=>editable()&&!drag&&!dialogOpen(),commit,settled:applyPending,notify:toast,moveBetweenGroups:false});
  window.TokiAvailabilityUI({board:snapshot,selected:()=>selected,excluded,notify:toast,canOpen:()=>ready&&!drag&&!rowDrag?.active});
  googleImportUI=window.TokiGoogleImportUI({
    context:()=>({board:snapshot(),fingerprint:JSON.stringify(snapshot()),pending:Boolean(pendingBoard||pendingLocalBoard)}),
    selected:()=>selected,
    canOpen:()=>editable()&&!drag&&people.length>0&&navigator.onLine!==false,
    apply:async(plan,fingerprint)=>{
      if(pendingBoard||pendingLocalBoard||JSON.stringify(snapshot())!==fingerprint)throw Error('予定表が更新されています。画面を閉じ、最新の予定を確認してから再取得してください。');
      if(await commit(plan.board,'Googleカレンダーの空き時間を可能時間として反映しました')){selected=plan.range.first;render();return true;}
      return false;
    }
  });
  window.addEventListener('online',()=>setBusy(busy));window.addEventListener('offline',()=>setBusy(busy));
  if(shared.enabled){
    try{await shared.initialize({
      board:receiveBoard,
      warning:toast,
      state:connectionState,
      error:error=>{
        $("auth-message").textContent=error.message;$("auth-retry").hidden=false;
        if(error.code==="LINK"){ready=false;$("schedule-app").hidden=true;$("auth-gate").hidden=false;}
      }
    });}
    catch(error){$("auth-message").textContent=error.message;$("auth-retry").hidden=false;}
  }
  render();if(loadFailed)toast("保存データを読み込めないため、元の予定を表示しています。");
})();

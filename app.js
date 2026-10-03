"use strict";
(async () => {
  await window.TOKI_DATA_READY;
  const $ = id => document.getElementById(id);
  let {people,dates,availability} = window.TOKI_DATA;
  const shared=window.TokiShared;
  let signedIn=false,ready=!shared.enabled,busy=false,revision=null,pendingBoard=null;
  $("schedule-app").hidden=shared.enabled;
  $("auth-gate").hidden=!shared.enabled;
  $("logout").hidden=!shared.enabled;
  $("shared-link").hidden=shared.enabled;
  if(shared.enabled)$("storage-note").textContent="変更は共有保存され、他のメンバーにも反映されます。同時に変更された場合は上書きを防止します。";
  const START=480, END=1440, SPAN=END-START, KEY="toki-availability-2026-v1";
  const colors=["#2b7558","#367f88","#526ab1","#896899"];
  const minute=t=>{const [h,m]=t.split(":").map(Number);return h*60+m;};
  const time=m=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
  const label=d=>new Intl.DateTimeFormat("ja-JP",{month:"long",day:"numeric",weekday:"short"}).format(new Date(d+"T12:00:00"));
  const clone=o=>JSON.parse(JSON.stringify(o));
  const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
  let events=[];
  availability.forEach((days,person)=>days.forEach((value,d)=>value.split(",").filter(Boolean).forEach((range,n)=>{const [start,end]=range.split("-").map(minute);events.push({id:`seed-${person}-${d}-${n}`,person,date:dates[d],start,end,title:"参加可能",detail:""});})));
  let selected=dates[0], editing=null, undo=[], redo=[], drag=null, toastTimer, loadFailed=false;
  const valid=e=>e&&typeof e.id==="string"&&Number.isInteger(e.person)&&e.person>=0&&e.person<16&&dates.includes(e.date)&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=START&&e.end<=END&&e.end>e.start&&typeof e.title==="string"&&e.title.length<=100&&typeof e.detail==="string"&&e.detail.length<=2000;
  try{const raw=shared.enabled?null:localStorage.getItem(KEY);if(raw!==null){const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.events)||!saved.events.every(valid)||new Set(saved.events.map(e=>e.id)).size!==saved.events.length)throw Error("Invalid saved data");events=saved.events;}}
  catch{loadFailed=true;$("save-status").textContent="保存データを読めませんでした";}
  function toast(message){$("toast").textContent=message;$("toast").hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").hidden=true,3500);}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({version:1,events}));$("save-status").textContent="このブラウザーに保存済み";}catch{$("save-status").textContent="保存できません（この画面のみ）";toast("自動保存できません。閉じる前にPDF出力してください。");}}
  const editable=()=>!busy&&ready&&(!shared.enabled||signedIn);
  function setBusy(value){busy=value;$("event-form").querySelector('button[type="submit"]').disabled=value;$("delete-button").disabled=value;$("add-button").disabled=value||!ready;$("undo").disabled=value||!undo.length;$("redo").disabled=value||!redo.length;}
  async function saveNext(next){
    if(!editable())return false;
    if(!shared.enabled){events=next;persist();return true;}
    setBusy(true);$("save-status").textContent="共有先に保存中…";
    try{const saved=await shared.save({people,dates,events:next},revision);events=saved.payload.events;revision=saved.version;$("save-status").textContent="共有保存済み";return true;}
    catch(error){$("save-status").textContent="未保存・最新の予定を確認してください";$("form-error").textContent=error.message;toast(error.message);await shared.refresh();return false;}
    finally{setBusy(false);}
  }
  async function commit(next,message){const before=clone(events);if(!await saveNext(next))return false;undo.push(before);if(undo.length>80)undo.shift();redo=[];render();toast(message);applyPending();return true;}
  async function history(direction){if(!editable())return;const from=direction==="undo"?undo:redo,to=direction==="undo"?redo:undo;if(!from.length)return;const before=clone(events);if(!await saveNext(clone(from.at(-1)))){applyPending();return;}to.push(before);from.pop();render();toast(direction==="undo"?"元に戻しました":"やり直しました");applyPending();}
  function receiveBoard(board){
    if(!signedIn||board.version<=revision)return;
    const payload=board.payload;
    if(!payload||!Array.isArray(payload.people)||payload.people.length!==16||!payload.people.every(n=>typeof n==='string'&&n.length>0&&n.length<=40)||JSON.stringify(payload.dates)!==JSON.stringify(dates)||!Array.isArray(payload.events)||!payload.events.every(valid)){$("auth-message").textContent="共有データの形式を確認できません。管理者に連絡してください。";return;}
    if(busy||drag||$("event-dialog").open){pendingBoard=board;$("save-status").textContent="他のメンバーが更新しました";return;}
    const changed=revision!==null;events=clone(payload.events);people=[...payload.people];revision=board.version;undo=[];redo=[];ready=true;
    $("event-person").replaceChildren();options($("event-person"),people.map((_,i)=>i),i=>people[i]);
    $("auth-gate").hidden=true;$("schedule-app").hidden=false;$("save-status").textContent="共有保存済み";render();if(changed)toast("他のメンバーの変更を反映しました");
  }
  function applyPending(){if(pendingBoard&&!busy&&!drag&&!$("event-dialog").open){const board=pendingBoard;pendingBoard=null;receiveBoard(board);}}
  function options(target,values,text){values.forEach((v,i)=>{const option=el("option",null,text(v,i));option.value=v;target.append(option);});}
  options($("date-select"),dates,d=>`2026年 ${label(d)}`);options($("event-date"),dates,d=>label(d));options($("event-person"),people.map((_,i)=>i),i=>people[i]);
  function chartFor(date,interactive=true){
    const chart=el("div","chart"),head=el("div","chart-header"),day=el("div","date-row"),times=el("div","time-row");
    day.append(el("div","name-heading","名前"),el("div","date-label",`2026年 ${label(date)}`));
    times.append(el("div","name-heading","参加可能時間"));const ticks=el("div","times");
    for(let m=START;m<END;m+=30)ticks.append(el("div",`time-tick ${m%60===0?"hour":""}`,time(m)));
    times.append(ticks);head.append(day,times);chart.append(head);
    people.forEach((name,person)=>{
      const row=el("div","person-row");row.style.setProperty("--person-color",colors[Math.floor(person/4)]);
      const nameCell=el("div","person-name");nameCell.append(el("span","person-dot"),document.createTextNode(name));
      const track=el("div","timeline");track.dataset.person=person;
      if(interactive){track.tabIndex=0;track.setAttribute("role","group");track.setAttribute("aria-label",`${name}の予定。Enterで追加`);track.addEventListener("keydown",e=>{if(e.target===track&&e.key==="Enter"){e.preventDefault();openEditor(null,{person});}});}
      const list=events.filter(e=>e.person===person&&e.date===date).sort((a,b)=>a.start-b.start||a.end-b.end);const lanes=[];
      list.forEach(event=>{
        let lane=lanes.findIndex(end=>end<=event.start);if(lane<0)lane=lanes.length;lanes[lane]=event.end;
        const bar=el(interactive?"button":"div","event");if(interactive)bar.type="button";bar.dataset.id=event.id;
        bar.style.left=`${(event.start-START)/SPAN*100}%`;bar.style.width=`${(event.end-event.start)/SPAN*100}%`;if(lane)bar.style.top=`${5+lane*33}px`;
        bar.append(el("span","event-title",event.title||"参加可能"),el("span","event-time",`${time(event.start)}–${time(event.end)}`));
        bar.title=`${name} / ${event.title}\n${time(event.start)}〜${time(event.end)}${event.detail?"\n"+event.detail:""}`;bar.setAttribute("aria-label",`${name} ${event.title} ${time(event.start)}から${time(event.end)}${event.detail?" "+event.detail:""}`);
        if(interactive){["start","end"].forEach(side=>{const handle=el("span",`resize-handle ${side}`);handle.dataset.resize=side;handle.setAttribute("aria-hidden","true");bar.append(handle);});bar.addEventListener("click",e=>{if(suppressClick){e.preventDefault();return;}openEditor(event);});}
        track.append(bar);
      });
      if(lanes.length>1)track.style.minHeight=`${lanes.length*33+10}px`;
      if(!list.length)track.append(el("span","empty-label","参加不可 / 登録なし"));
      row.append(nameCell,track);chart.append(row);
    });return chart;
  }
  function render(){const scroll=$("chart-scroll"),x=scroll.scrollLeft,y=scroll.scrollTop;$("chart").replaceWith(Object.assign(chartFor(selected),{id:"chart"}));scroll.scrollLeft=x;scroll.scrollTop=y;$("date-select").value=selected;$("previous").disabled=selected===dates[0];$("next").disabled=selected===dates.at(-1);$("undo").disabled=!undo.length;$("redo").disabled=!redo.length;const list=events.filter(e=>e.date===selected);$("day-summary").textContent=`${new Set(list.map(e=>e.person)).size}/16人 · ${list.length}枠`;}
  function openEditor(event=null,defaults={}){if(!editable())return;editing=event?.id||null;$("dialog-title").textContent=editing?"予定を編集":"予定を追加";$("event-title").value=event?.title??"参加可能";$("event-detail").value=event?.detail??"";$("event-person").value=event?.person??defaults.person??0;$("event-date").value=event?.date??selected;$("event-start").value=time(event?.start??defaults.start??540);const end=event?.end??defaults.end??600;$("event-end").value=end===1440?"00:00":time(end);$("delete-button").hidden=!editing;$("form-error").textContent="";$("event-dialog").showModal();$("event-title").focus();$("event-title").select();}
  $("event-form").addEventListener("submit",async e=>{e.preventDefault();if(!editable())return;const start=minute($("event-start").value),rawEnd=minute($("event-end").value),end=rawEnd===0?1440:rawEnd;if(!Number.isFinite(start)||!Number.isFinite(end)||start<START||end>END||end<=start){$("form-error").textContent="8:00〜24:00の範囲で、終了を開始より後にしてください。";return;}const event={id:editing||`event-${Date.now()}-${Math.random().toString(36).slice(2)}`,person:Number($("event-person").value),date:$("event-date").value,start,end,title:$("event-title").value.trim()||"参加可能",detail:$("event-detail").value.trim()};const next=clone(events);if(editing)next[next.findIndex(x=>x.id===editing)]=event;else next.push(event);selected=event.date;if(await commit(next,editing?"予定を更新しました":"予定を追加しました"))$("event-dialog").close();});
  ["close-dialog","cancel-dialog"].forEach(id=>$(id).onclick=()=>$("event-dialog").close());
  $("delete-button").onclick=async()=>{if(await commit(events.filter(e=>e.id!==editing),"予定を削除しました。元に戻すで復元できます。"))$("event-dialog").close();};
  $("add-button").onclick=()=>openEditor();$("undo").onclick=()=>history("undo");$("redo").onclick=()=>history("redo");
  $("date-select").onchange=e=>{selected=e.target.value;render();};$("previous").onclick=()=>{selected=dates[dates.indexOf(selected)-1];render();};$("next").onclick=()=>{selected=dates[dates.indexOf(selected)+1];render();};
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&drag){cancelDrag();return;}if(document.querySelector("dialog[open]")||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();history(e.shiftKey?"redo":"undo");}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();history("redo");}});
  let suppressClick=false;
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function at(track,x){const r=track.getBoundingClientRect();return START+(x-r.left)/r.width*SPAN;}
  function snap(m){return Math.round(m/30)*30;}
  $("chart-scroll").addEventListener("pointerdown",e=>{if(e.button!==0||!editable())return;const track=e.target.closest(".timeline");if(!track)return;const bar=e.target.closest(".event"),event=bar?events.find(x=>x.id===bar.dataset.id):null;drag={pointer:e.pointerId,x:e.clientX,y:e.clientY,track,person:Number(track.dataset.person),event,bar,mode:event?(e.target.dataset.resize||"move"):"create",origin:at(track,e.clientX),moved:false};});
  document.addEventListener("pointermove",e=>{if(!drag||e.pointerId!==drag.pointer)return;const d=drag;if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;if(!d.moved){d.moved=true;document.body.classList.add("dragging");d.bar?.classList.add("drag-source");d.preview=el("div","drag-preview");try{$("chart-scroll").setPointerCapture(e.pointerId);}catch{}}e.preventDefault();let track=d.track;if(d.mode==="move"){const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest(".timeline");if(hit)track=hit;}d.person=Number(track.dataset.person);let start,end;const cursor=at(d.track,e.clientX);
    if(d.mode==="create"){const a=clamp(Math.floor(d.origin/30)*30,START,END-30),b=clamp(snap(cursor),START,END);start=Math.min(a,b);end=Math.max(a+30,b);}
    else if(d.mode==="move"){const duration=d.event.end-d.event.start;start=clamp(d.event.start+snap(cursor-d.origin),START,END-duration);end=start+duration;}
    else if(d.mode==="start"){start=clamp(snap(cursor),START,d.event.end-1);end=d.event.end;}
    else{start=d.event.start;end=clamp(snap(cursor),start+1,END);}
    d.start=start;d.end=end;track.append(d.preview);d.preview.style.left=`${(start-START)/SPAN*100}%`;d.preview.style.width=`${(end-start)/SPAN*100}%`;d.preview.textContent=`${time(start)}–${time(end)}`;
    const s=$("chart-scroll"),r=s.getBoundingClientRect();if(e.clientX>r.right-35)s.scrollLeft+=14;else if(e.clientX<r.left+130)s.scrollLeft-=14;
  },{passive:false});
  function cancelDrag(){if(!drag)return;drag.preview?.remove();drag.bar?.classList.remove("drag-source");try{$("chart-scroll").releasePointerCapture(drag.pointer);}catch{}drag=null;document.body.classList.remove("dragging");}
  document.addEventListener("pointerup",async e=>{if(!drag||e.pointerId!==drag.pointer)return;const d=drag;cancelDrag();if(d.moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);if(d.mode==="create")openEditor(null,{person:d.person,start:d.start,end:d.end});else if(d.start!==d.event.start||d.end!==d.event.end||d.person!==d.event.person)await commit(events.map(item=>item.id===d.event.id?{...item,start:d.start,end:d.end,person:d.person}:item),"予定を変更しました");applyPending();}else if(!d.event){const start=clamp(Math.floor(d.origin/30)*30,START,END-30);openEditor(null,{person:d.person,start,end:start+30});}});
  document.addEventListener("pointercancel",cancelDrag);window.addEventListener("blur",cancelDrag);
  function buildPrint(scope="current"){$("print-area").replaceChildren();if(!ready)return;(scope==="all"?dates:[selected]).forEach(date=>{const section=el("section","print-day"),heading=el("div","print-heading");heading.append(el("h2",null,`参加できる時間｜2026年 ${label(date)}`),el("span",null,"TOKI / 16人"));section.append(heading,chartFor(date,false));const notes=el("div","print-notes");events.filter(e=>e.date===date&&(e.detail||e.title!=="参加可能")).sort((a,b)=>a.person-b.person||a.start-b.start).forEach(e=>notes.append(el("p","print-note",`${people[e.person]} ${time(e.start)}–${time(e.end)}｜${e.title}${e.detail?"\n"+e.detail:""}`)));section.append(notes,el("p","print-footer","色のついた枠：参加可能　／　目盛り：30分刻み　／　時刻は各予定の記載を優先"));$("print-area").append(section);});}
  let printScope="current";
  $("print-button").onclick=()=>$("print-dialog").showModal();$("close-print").onclick=()=>$("print-dialog").close();
  $("print-form").onsubmit=e=>{e.preventDefault();printScope=$("print-scope").value;buildPrint(printScope);$("print-dialog").close();window.print();};window.addEventListener("beforeprint",()=>buildPrint(printScope));window.addEventListener("afterprint",()=>{printScope="current";});
  window.addEventListener("storage",e=>{if(shared.enabled||e.key!==KEY)return;try{const saved=JSON.parse(e.newValue);if(saved?.version===1&&Array.isArray(saved.events)&&saved.events.every(valid)){if($("event-dialog").open||drag){toast("別タブで変更されています。この画面の編集を保存すると上書きされます。");return;}events=saved.events;undo=[];redo=[];render();toast("別タブの変更を反映しました");}}catch{}});
  $("event-dialog").addEventListener("close",applyPending);
  $("login-form").addEventListener("submit",async e=>{
    e.preventDefault();$("login-submit").disabled=true;$("auth-message").textContent="ログイン中…";
    try{await shared.signIn($("login-email").value.trim(),$("login-password").value);}
    catch(error){$("auth-message").textContent=error.message;}
    finally{$("login-password").value="";$("login-submit").disabled=false;}
  });
  async function logout(){try{await shared.signOut();}catch(error){toast(error.message);}}
  $("logout").onclick=logout;$("gate-logout").onclick=logout;$("auth-retry").onclick=()=>shared.refresh();
  if(shared.enabled){
    $("login-submit").disabled=true;
    try{await shared.initialize({
      auth:user=>{
        signedIn=Boolean(user);ready=false;revision=null;pendingBoard=null;events=[];undo=[];redo=[];cancelDrag();
        $("event-dialog").close();$("print-dialog").close();$("print-area").replaceChildren();$("chart").replaceChildren();
        $("schedule-app").hidden=true;$("auth-gate").hidden=false;$("login-form").hidden=signedIn;$("auth-signed-in").hidden=!signedIn;
        $("auth-message").textContent=signedIn?"共有の予定を読み込み中…":"";
      },
      board:receiveBoard,
      connection:status=>{if(ready&&!busy)$("save-status").textContent=status==="接続中"?"共有保存・同期中":"再接続中（15秒ごとに確認）";},
      error:error=>{
        if(error.code==="MEMBER"){ready=false;events=[];undo=[];redo=[];pendingBoard=null;$("event-dialog").close();$("print-dialog").close();$("print-area").replaceChildren();$("chart").replaceChildren();$("schedule-app").hidden=true;$("auth-gate").hidden=false;}
        $("auth-message").textContent=error.message;if(ready)$("save-status").textContent="接続を確認してください";
      }
    });$("login-submit").disabled=false;}
    catch(error){$("auth-message").textContent=error.message;}
  }
  render();if(loadFailed)toast("保存データを読み込めないため、元の予定を表示しています。");
})();

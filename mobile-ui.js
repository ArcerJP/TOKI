"use strict";
window.TokiMobileUI = function (bridge) {
  const M=window.TokiModel,A=window.TokiAvailability,S=window.TokiSchedule,H=window.TokiMobileModel;
  const $=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,run,label=text,cls='')=>{const n=el('button',cls,text);n.type='button';n.setAttribute('aria-label',label);n.onclick=run;return n;};
  function navIcon(name){
    const paths={schedule:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h3 M8 17h6',members:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-2a7 7 0 0 1 14 0v2 M17 4a4 4 0 0 1 0 8 M19 15a5 5 0 0 1 3 5',export:'M12 15V3 M7 8l5-5 5 5 M4 13v8h16v-8',more:'M4 11h2v2H4z M11 11h2v2h-2z M18 11h2v2h-2z'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','mob-nav-icon');path.setAttribute('d',paths[name]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.7');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;
  }
  const rangeText=r=>`${A.time(r.start)}～${A.time(r.end)}`;
  const dayMeetings=(board,date,test)=>board.meetings.filter(m=>m.date===date&&test(m)).sort((a,b)=>a.start-b.start||a.end-b.end);
  const dayText=date=>A.formatDay(date,[]).replace(/：$/,'');
  const scope=window.TokiShared.enabled?(window.TOKI_CONFIG?.boardId||'shared'):'local';
  const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key+':'+scope))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key+':'+scope,JSON.stringify(value));}catch{}}};
  const storedHidden=storage.get('toki-mobile-hidden-groups',[]);
  const savedFolded=storage.get('toki-mobile-folded',null);
  let hidden=new Set(Array.isArray(storedHidden)?storedHidden:[]),folded=new Set(Array.isArray(savedFolded)?savedFolded:[]),initialFolds=Array.isArray(savedFolded);
  let page='schedule',view=storage.get('toki-mobile-view','list')==='table'?'table':'list',compact=false,full=false;
  let draft=null,gesture=null,refreshFrame=0,lastFocus=null,editorNodes=null,lastRender='';
  const root=$('mobile-app'),header=el('div','mob-header'),content=el('div','mob-content'),nav=el('nav','mob-nav');
  nav.setAttribute('aria-label','メインメニュー');root.append(header,content,nav);
  const narrow=matchMedia('(max-width: 767px)'),tablet=matchMedia('(max-width: 1023px) and (pointer: coarse)');
  function rememberFocus(){lastFocus=document.activeElement;}
  function recoverFocus(){if(lastFocus?.isConnected&&!lastFocus.closest('[hidden]'))lastFocus.focus({preventScroll:true});else root.querySelector('button')?.focus({preventScroll:true});}
  function dialog(title,wide=false){
    const d=el('dialog','mob-dialog'+(wide?' mob-editor':'')),head=el('div','mob-dialog-head'),h=el('h2',null,title);
    h.id='mob-title-'+crypto.randomUUID();d.setAttribute('aria-labelledby',h.id);
    head.append(h,button('閉じる',()=>d.close()));d.append(head);document.body.append(d);
    d.addEventListener('close',()=>{bridge.settled();mode();refresh();recoverFocus();if(!wide)d.remove();});
    rememberFocus();return {d,head,h};
  }
  function openShared(id){rememberFocus();$(id).click();}
  function toggleFold(id){if(folded.has(id))folded.delete(id);else folded.add(id);storage.set('toki-mobile-folded',[...folded]);render();}
  function mode(){
    if(document.querySelector('dialog[open]')||bridge.context().busy||bridge.interacting())return;
    const next=narrow.matches||tablet.matches;if(next===compact)return;
    compact=next;document.documentElement.dataset.ui=compact?'compact':'desktop';
    if(compact)bridge.exitFullscreen();else{full=false;root.classList.remove('mob-full');}
    render();
  }
  narrow.addEventListener('change',mode);tablet.addEventListener('change',mode);
  function mutationButton(text,run,label=text,cls=''){
    const b=button(text,run,label,cls);b.disabled=!bridge.context().writable;return b;
  }
  function editButton(key,name){const b=button(bridge.context().writable?'編集':'確認',()=>openEditor(key),name+'の時間を編集','mob-text-button');b.disabled=bridge.context().busy;return b;}
  function render(){
    const ctx=bridge.context();root.hidden=!compact||!ctx.ready;if(!compact||!ctx.ready)return;
    if(!initialFolds){folded=new Set(ctx.board.groups.map(g=>g.id));initialFolds=true;}
    const signature=JSON.stringify([ctx.fingerprint,ctx.date,ctx.writable,ctx.busy,page,view,full,[...hidden],[...folded],ctx.board.groups.map(g=>bridge.excluded(g.id)),...['save-status','connection-status','pwa-status','install-app','update-app','undo','redo','google-import-button'].map(id=>[$(id).textContent,$(id).hidden,$(id).disabled])]);
    if(signature===lastRender)return;lastRender=signature;
    const previousScroll=root.querySelector('.mob-table-scroll'),tablePosition=previousScroll?[previousScroll.scrollLeft,previousScroll.scrollTop]:[0,0];
    const active=root.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
    const board=ctx.board;
    header.replaceChildren();const brand=el('div','mob-brand');brand.append(el('strong',null,'TOKI'),el('span','mob-status',$('save-status').textContent));header.append(brand);
    const notice=$('connection-status');if(!notice.hidden)header.append(el('p','mob-notice',notice.textContent));
    if(!$('update-app').hidden)header.append(button('最新版に更新',()=>openShared('update-app')));
    content.replaceChildren();
    if(page==='schedule'){
      const datebar=el('div','mob-datebar');const prev=button('‹',()=>bridge.selectDate(M.shiftDate(ctx.date,-1)),'前の日');prev.disabled=!M.shiftDate(ctx.date,-1);
      const next=button('›',()=>bridge.selectDate(M.shiftDate(ctx.date,1)),'次の日');next.disabled=!M.shiftDate(ctx.date,1);
      datebar.append(prev,button(ctx.date.slice(0,4)+'年 '+dayText(ctx.date)+' ▾',openDates,'日付を選択'),next);header.append(datebar);
      const tools=el('div','mob-viewbar'),seg=el('div','mob-segments');
      for(const [id,name] of [['list','一覧'],['table','表']]){const b=button(name,()=>{view=id;storage.set('toki-mobile-view',id);render();});b.setAttribute('aria-pressed',String(view===id));seg.append(b);}
      tools.append(seg,button(`表示グループ ${board.groups.filter(g=>!hidden.has(g.id)).length}/${board.groups.length} ▾`,openFilter,'表示グループを選択'));
      header.append(tools);
      if(view==='table')renderTable(board,ctx.date);else renderList(board,ctx.date);
    }else if(page==='members')renderMembers(board);
    else if(page==='export'){
      content.append(el('h1',null,'書き出し'),el('p','mob-muted','対象と期間を選んでコピーできます。'));
      actionCard('可能時間書き出し','人・グループの可能時間をコピー','export-availability');
      actionCard('MTG一括書き出し','対象グループとMTG参加者ごとにコピー','export-meetings');
      actionCard('PDF出力','予定表を印刷・PDFで保存','print-button');
      content.append(el('p','mob-note','表示グループのチェックは書き出しに影響しません。MTG書き出しは全グループが初期選択されます。'));
    }else{
      content.append(el('h1',null,'その他'));
      actionCard('Googleカレンダーから取り込む','メインカレンダーの空き時間だけを反映','google-import-button');
      if(!$('copy-link').hidden)actionCard('共有URLをコピー','同じ予定表をほかの端末で開く','copy-link');
      const history=el('div','mob-actions');for(const [id,name] of [['undo','↶ 元に戻す'],['redo','↷ やり直す']]){const b=button(name,()=>openShared(id));b.disabled=$(id).disabled;history.append(b);}content.append(history);
      if(!$('install-app').hidden)actionCard('アプリをインストール','ホーム画面から開く','install-app');
      content.append(el('p','mob-note','iPhone：Safariの共有メニュー →「ホーム画面に追加」でアプリとして使えます。'));
      if(!$('pwa-status').hidden)content.append(el('p','mob-note',$('pwa-status').textContent));
      const help=el('section','mob-card');help.append(el('h2',null,'💡 スマホの操作'));
      const list=el('ul');for(const text of ['一覧・表はスクロールして閲覧。予定は「編集」から変更します。','編集画面では、まず時間を選択。±30分のボタンでも調整できます。「保存」まで予定は変わりません。','タイムラインは「スクロール」が標準。「範囲選択・開始・終了・移動」を選ぶとドラッグで調整できます。','グループの可能時間は対象者の共通時間。MTGは登録済みの対象者全員の可能時間内で調整します。','対象から外した人は取り消し線で表示。既存のMTGの対象者は変わりません。','MTGの「⋯」から削除・時間のコピー。削除すると可能時間を復元します。','表示グループ・一時除外はこの端末だけに保存します。オフラインの共有予定は閲覧のみです。'])list.append(el('li',null,text));help.append(list);content.append(help);
    }
    nav.replaceChildren();for(const [id,name] of [['schedule','予定'],['members','メンバー'],['export','書き出し'],['more','その他']]){
      const b=button('',()=>{page=id;full=false;root.classList.remove('mob-full');window.scrollTo(0,0);render();},name);b.append(navIcon(id),el('span',null,name));b.setAttribute('aria-current',id===page?'page':'false');nav.append(b);
    }
    if(active)Array.from(root.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===active)?.focus({preventScroll:true});
    const tableScroll=root.querySelector('.mob-table-scroll');if(tableScroll){tableScroll.scrollLeft=tablePosition[0];tableScroll.scrollTop=tablePosition[1];}
  }
  function actionCard(title,desc,id){const b=button('',()=>openShared(id),title,'mob-action-card');b.append(el('strong',null,title),el('span','mob-muted',desc),el('span','mob-chevron','›'));b.disabled=$(id).disabled;content.append(b);}
  function openDates(){
    const {d}=dialog('日付を選択');let anchor=bridge.context().date;const week=el('div'),controls=el('div','mob-actions');
    const renderWeek=()=>{week.replaceChildren();M.weekDates(anchor).forEach(date=>{const b=button(dayText(date),()=>{d.close();bridge.selectDate(date);});b.setAttribute('aria-current',date===bridge.context().date?'date':'false');week.append(b);});};
    week.className='mob-week';controls.append(button('≪ 前の週',()=>{anchor=M.shiftDate(anchor,-7)||anchor;renderWeek();}),button('次の週 ≫',()=>{anchor=M.shiftDate(anchor,7)||anchor;renderWeek();}));d.append(controls,week);
    const label=el('label',null,'日付を直接選択'),input=el('input');input.type='date';input.min=M.MIN_DATE;input.max=M.MAX_DATE;input.value=anchor;label.append(input);d.append(label,button('この日に移動',()=>{if(M.validDate(input.value)){d.close();bridge.selectDate(input.value);}}));
    d.append(button('今日',()=>{const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;d.close();bridge.selectDate(date);}));renderWeek();d.showModal();
  }
  function openFilter(){
    const {d}=dialog('表示グループ');d.append(el('p','mob-note','チェックを外すとグループとその中の人を非表示にします。予定・MTGの対象者・書き出しは変わりません。'));
    const choices=el('div','mob-checks'),board=bridge.context().board,selection=new Set(hidden),allLabel=el('label'),all=el('input');all.type='checkbox';allLabel.append(all,document.createTextNode('すべて選択'));
    const updateAll=()=>{const inputs=[...choices.querySelectorAll('input')];all.checked=inputs.every(i=>i.checked);all.indeterminate=!all.checked&&inputs.some(i=>i.checked);};
    const set=(id,checked)=>{if(checked)selection.delete(id);else selection.add(id);updateAll();};
    const add=(id,name)=>{const l=el('label'),i=el('input');i.type='checkbox';i.checked=!selection.has(id);i.dataset.group=id;i.onchange=()=>set(id,i.checked);l.append(i,document.createTextNode(name));choices.append(l);};
    for(const g of board.groups)add(g.id,g.name);add('@unassigned','未所属');
    all.onchange=()=>{choices.querySelectorAll('input').forEach(i=>{i.checked=all.checked;if(all.checked)selection.delete(i.dataset.group);else selection.add(i.dataset.group);});updateAll();};
    const allBox=el('div','mob-checks');allBox.append(allLabel);updateAll();d.append(allBox,choices,button('適用',()=>{hidden=selection;storage.set('toki-mobile-hidden-groups',[...hidden]);d.close();render();},undefined,'mob-primary'));d.showModal();
  }
  function meetingLabel(board,m,inGroup){return inGroup?m.members.map(p=>board.people[p]).join('、')+' MTG':(board.groups.find(g=>g.id===m.group)?.name||'グループ')+' MTG';}
  function showError(container,message){let error=container.querySelector('.mob-error');if(!error){error=el('p','mob-error');error.setAttribute('role','alert');container.append(error);}error.textContent=message;}
  let hold=null;
  const cancelHold=()=>{if(hold)clearTimeout(hold.timer);hold=null;};
  document.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>5)cancelHold();});
  for(const type of ['pointerup','pointercancel','scroll'])document.addEventListener(type,cancelHold,true);
  window.addEventListener('blur',cancelHold);
  function holdAction(node,run){
    let suppress=false;
    node.addEventListener('pointerdown',e=>{cancelHold();suppress=false;if(e.button!==0||e.isPrimary===false)return;hold={x:e.clientX,y:e.clientY,timer:setTimeout(()=>{hold=null;if(node.isConnected&&!document.querySelector('dialog[open]')){suppress=true;run();}},600)};});
    node.addEventListener('contextmenu',e=>{e.preventDefault();cancelHold();if(!document.querySelector('dialog[open]')){suppress=true;run();}});
    node.addEventListener('click',e=>{if(suppress){e.preventDefault();e.stopImmediatePropagation();suppress=false;}},true);
  }
  function availabilityActions(person,range){
    const ctx=bridge.context(),{d}=dialog(ctx.board.people[person]+'の可能時間');d.append(el('p',null,A.formatDay(ctx.date,[range])));
    d.append(mutationButton('削除',async()=>{try{if(await bridge.commit(S.editPerson(ctx.board,person,ctx.date,[range],[]),'可能時間を削除しました',ctx.fingerprint))d.close();}catch(e){showError(d,e.message);}},undefined,'mob-danger'),button('時間をコピー',()=>copy(A.formatDay(ctx.date,[range]),d)));d.showModal();
  }
  function personCard(board,person,date,group=null){
    const name=board.people[person],card=el('section','mob-person'),head=el('div','mob-rowhead');
    const excluded=group&&bridge.excluded(group.id).includes(name);head.append(el('h3',excluded?'mob-excluded':'',name));
    if(excluded)head.append(el('span','mob-tag','対象外'));
    head.append(editButton('p:'+person,name));card.append(head);
    const times=S.personRanges(board,person,date),timesNode=el('div','mob-times');
    if(!times.length)timesNode.textContent='可能時間なし';
    for(const range of times){const b=button(rangeText(range)+' ⋯',()=>availabilityActions(person,range),name+' '+rangeText(range)+'の操作','mob-range-action');holdAction(b,()=>availabilityActions(person,range));timesNode.append(b);}card.append(timesNode);
    for(const m of dayMeetings(board,date,m=>m.members.includes(person)))card.append(meetingLine(board,m,person));
    if(group){const b=button(excluded?'対象に戻す':'対象から一時除外',()=>bridge.toggleMember(group.id,name),name+(excluded?'を対象に戻す':'を対象から一時除外'),'mob-exclude');b.setAttribute('aria-pressed',String(excluded));card.append(b);}
    return card;
  }
  function meetingLine(board,m,person=null){
    const row=el('div','mob-meeting');row.style.setProperty('--meeting-color',S.color(m.group,board.groups));
    const label=el('div');label.append(el('strong',null,rangeText(m)),el('span',null,meetingLabel(board,m,person===null)));
    row.append(label,button('⋯',()=>openMeetingActions(m.id,person),meetingLabel(board,m,person===null)+' '+rangeText(m)+'の操作','mob-more-button'));holdAction(row,()=>openMeetingActions(m.id,person));return row;
  }
  function renderList(board,date){
    let count=0;
    for(const group of board.groups.filter(g=>!hidden.has(g.id))){
      count++;const card=el('section','mob-card'),head=el('div','mob-rowhead'),heading=el('h2',null,group.name);head.append(heading);
      head.append(editButton('g:'+group.id,group.name));card.append(head);
      const members=S.participants(board,group.id,bridge.excluded(group.id)),ranges=S.ranges(board,'g:'+group.id,date,bridge.excluded(group.id));
      card.append(el('p','mob-caption',`共通の可能時間 · 対象 ${members.length}/${group.members.length}人`));
      card.append(el('p','mob-times mob-common',!members.length?'対象者がいません':ranges.length?ranges.map(rangeText).join(' / '):'共通の可能時間なし'));
      for(const meeting of dayMeetings(board,date,m=>m.group===group.id))card.append(meetingLine(board,meeting));
      const toggle=button(`${folded.has(group.id)?'▸':'▾'} メンバー ${group.members.length}人`,()=>toggleFold(group.id),group.name+'のメンバー表示','mob-fold');toggle.setAttribute('aria-expanded',String(!folded.has(group.id)));card.append(toggle);
      if(!folded.has(group.id)){card.append(el('p','mob-note','一時除外はこの端末のみ。所属・既存MTGは変わりません。'));for(const person of group.members)card.append(personCard(board,person,date,group));}
      content.append(card);
    }
    const unassigned=M.rows(board).filter(r=>r.person!==undefined&&!r.context);
    if(!hidden.has('@unassigned')&&unassigned.length){count++;const card=el('section','mob-card');card.append(el('h2',null,'未所属'));for(const row of unassigned)card.append(personCard(board,row.person,date));content.append(card);}
    if(!count)content.append(el('p','mob-empty',board.people.length?'表示対象がありません。「表示グループ」で選択してください。':'まだメンバーがいません。下の「メンバー」から追加してください。'));
  }
  function renderTable(board,date){
    const head=el('div','mob-rowhead');head.append(el('p','mob-note','横にスクロール。名前をタップして編集。'),button(full?'⛶ 全画面終了':'⛶ 全画面表示',()=>{full=!full;root.classList.toggle('mob-full',full);render();}));content.append(head);
    const scroll=el('div','mob-table-scroll'),table=el('table','mob-table'),thead=el('thead'),tr=el('tr');table.setAttribute('aria-label',dayText(date)+'の比較表');
    tr.append(el('th',null,'名前'));const day=el('th',null,dayText(date));day.colSpan=32;tr.append(day);thead.append(tr);const times=el('tr');times.append(el('th',null,'可能時間'));
    for(let m=480;m<1440;m+=30)times.append(el('th',null,A.time(m)));thead.append(times);table.append(thead);const tbody=el('tbody');
    for(const row of H.rows(board,[...hidden],folded).filter(r=>!hidden.has('@unassigned')||r.group||r.context)){
      const r=el('tr',row.group?'mob-group-tr':''),name=el('th'),b=button(row.name,()=>openEditor(row.key),row.name+'の時間を編集');b.disabled=bridge.context().busy;name.append(b);
      if(row.context&&bridge.excluded(row.context).includes(row.name))b.classList.add('mob-excluded');r.append(name);
      const td=el('td');td.colSpan=32;const track=el('div','mob-table-track');
      const available=S.ranges(board,row.key,date,row.group?bridge.excluded(row.group.id):[]);
      for(const range of available){const bar=el('span','mob-table-bar',rangeText(range));bar.style.left=(range.start-480)/30*44+'px';bar.style.width=(range.end-range.start)/30*44+'px';track.append(bar);}
      const mtgs=dayMeetings(board,date,m=>row.group?m.group===row.group.id:m.members.includes(row.person)),lanes=[];
      for(const m of mtgs){let lane=lanes.findIndex(end=>end<=m.start);if(lane<0)lane=lanes.length;lanes[lane]=m.end;const bar=el('span','mob-table-bar mob-table-mtg',meetingLabel(board,m,Boolean(row.group))+' '+rangeText(m));bar.style.background=S.color(m.group,board.groups);bar.style.left=(m.start-480)/30*44+'px';bar.style.width=(m.end-m.start)/30*44+'px';bar.style.top=7+lane*38+'px';track.append(bar);}track.style.minHeight=Math.max(48,lanes.length*38+14)+'px';
      td.append(track);r.append(td);tbody.append(r);
    }
    table.append(tbody);scroll.append(table);content.append(scroll);
  }
  function renderMembers(board){
    content.append(el('h1',null,'メンバー'));const add=el('div','mob-actions');add.append(mutationButton('＋ 人を追加',()=>bridge.openRoster('person',null)),mutationButton('＋ グループ',()=>bridge.openRoster('group',null)));content.append(add);
    content.append(el('p','mob-note','名前・所属は「編集」。↑↓で並べ替えできます。ここでは非表示のグループも表示します。'));
    for(const [index,g] of board.groups.entries()){
      const card=el('section','mob-card'),head=el('div','mob-rowhead');head.append(el('h2',null,g.name),mutationButton('編集',()=>bridge.openRoster('group',g.id),g.name+'の設定を編集'));card.append(head);
      const controls=el('div','mob-actions');for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.reorderGroup(board,g.id,board.groups[index+delta].id,delta>0)),g.name+(delta<0?'を上へ':'を下へ'));b.disabled||=index+delta<0||index+delta>=board.groups.length;controls.append(b);}card.append(controls);
      for(const [i,p] of g.members.entries()){
        const row=el('div','mob-member-setting');row.append(el('span',null,board.people[p]),mutationButton('編集',()=>bridge.openRoster('person',p),board.people[p]+'の名前・所属を編集'));
        for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.placePerson(board,p,{group:g.id,target:g.members[i+delta],after:delta>0})),board.people[p]+(delta<0?'を上へ':'を下へ'));b.disabled||=i+delta<0||i+delta>=g.members.length;row.append(b);}card.append(row);
      }content.append(card);
    }
    const people=M.rows(board).filter(r=>r.person!==undefined&&!r.context);if(people.length){const card=el('section','mob-card');card.append(el('h2',null,'未所属'));for(const [index,row] of people.entries()){const line=el('div','mob-member-setting');line.append(el('span',null,row.name),mutationButton('編集',()=>bridge.openRoster('person',row.person),row.name+'の名前・所属を編集'));for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.reorderPeople(board,row.person,people[index+delta].person,delta>0)),row.name+(delta<0?'を上へ':'を下へ'));b.disabled||=index+delta<0||index+delta>=people.length;line.append(b);}card.append(line);}content.append(card);}
    content.append(mutationButton('＋ 人を追加',()=>bridge.openRoster('person',null),'一覧の末尾から人を追加'));
  }
  async function reorder(board,make){try{await bridge.commit(make(),'並び順を変更しました',JSON.stringify(board));}catch(e){bridge.notify(e.message);}}
  async function copy(text,parent){try{await navigator.clipboard.writeText(text);bridge.notify('時間をコピーしました');}catch{const area=el('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','コピーする時間');parent.append(el('p','mob-note','コピーできない場合は、次の文字を選択してコピーしてください。'),area);area.focus();area.select();}}
  function openMeetingActions(id,person){
    const ctx=bridge.context(),m=ctx.board.meetings.find(m=>m.id===id);if(!m)return;const {d}=dialog('MTGの操作');d.append(el('p',null,dayText(m.date)+' '+rangeText(m)),el('p','mob-note',person===null?'対象者：'+m.members.map(p=>ctx.board.people[p]).join('、'):'対象者：'+ctx.board.people[person]));
    if(person===null)d.append(mutationButton('時間・対象者を編集',()=>{d.close();openEditor('g:'+m.group,id);}));
    d.append(mutationButton('削除（可能時間を復元）',async()=>{try{if(await bridge.commit(S.release(ctx.board,id,person===null?{}:{person}),'MTGを解除しました',ctx.fingerprint))d.close();}catch(e){showError(d,e.message);}},undefined,'mob-danger'));
    if(person===null)d.append(button('時間をコピー',()=>copy(A.formatDay(m.date,[m]),d)));d.showModal();
  }
  const editor=dialog('時間を編集',true);editor.d.id='mobile-editor';
  function discardThen(run){
    if(!draft?.dirty){run();return;}
    editor.d.querySelector('.mob-discard')?.remove();
    const box=el('div','mob-discard'),text=el('p',null,'保存前の変更を破棄しますか？');box.setAttribute('role','alert');
    const cancel=button('編集に戻る',()=>box.remove()),ok=button('変更を破棄',()=>{box.remove();run();},undefined,'mob-danger');box.append(text,cancel,ok);editor.d.insertBefore(box,editorNodes.tools);ok.focus();
  }
  function closeEditor(after){if(bridge.context().busy)return;discardThen(()=>{draft=null;gesture=null;editor.d.close();if(typeof after==='function')after();});}
  editor.head.lastChild.onclick=closeEditor;editor.d.addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
  function openEditor(key,meetingId=null){
    const ctx=bridge.context();if(!ctx.ready||ctx.busy)return;rememberFocus();const group=key.startsWith('g:')?ctx.board.groups.find(g=>g.id===key.slice(2)):null,person=group?null:Number(key.slice(2));
    if(!group&&!ctx.board.people[person])return;
    const excluded=group?[...bridge.excluded(group.id)]:[],options=[{value:'new',label:group?'＋ 共通の可能時間からMTGを作る':'＋ 可能時間を追加',kind:group?'reserve':'person'}];
    for(const [i,r] of S.ranges(ctx.board,key,ctx.date,excluded).entries())options.push({value:'range:'+i,label:'可能時間 '+rangeText(r),kind:group?'common':'person',from:r});
    for(const m of dayMeetings(ctx.board,ctx.date,m=>group?m.group===group.id:m.members.includes(person)))options.push({value:m.id,label:rangeText(m)+' '+meetingLabel(ctx.board,m,Boolean(group)),kind:group?'meeting':'personal-meeting',meeting:m});
    draft={ctx,key,group:group?.id,person,excluded,options,dirty:false,mode:'scroll',op:null,choice:null};
    editor.h.textContent=(group?group.name:ctx.board.people[person])+' · '+dayText(ctx.date);
    while(editor.d.children.length>1)editor.d.lastChild.remove();
    const label=el('label',null,'編集する時間'),select=el('select');select.setAttribute('aria-label','編集する時間');for(const o of options){const option=el('option',null,o.label);option.value=o.value;select.append(option);}label.append(select);editor.d.append(label);
    const tools=el('div','mob-editor-tools'),summary=el('p','mob-preview-summary'),error=el('p','mob-error'),timeline=el('div','mob-editor-scroll'),track=el('div','mob-editor-track'),actions=el('div','mob-editor-actions');
    error.setAttribute('role','alert');summary.setAttribute('aria-live','polite');timeline.append(track);const save=button('保存',saveDraft,undefined,'mob-primary');actions.append(button('キャンセル',closeEditor),save);editor.d.append(tools,summary,error,timeline,actions);
    editorNodes={select,tools,summary,error,timeline,track,save};
    select.onchange=()=>{const value=select.value;select.value=draft.choice.value;discardThen(()=>{select.value=value;choose(value);});};
    select.value=meetingId||(!ctx.writable&&options.length>1?options[1].value:'new');choose(select.value);editor.d.showModal();timeline.scrollTop=Math.max(0,(draft.op.to.start-480)*1.6-48);
  }
  function choose(value){
    const o=draft.options.find(o=>o.value===value);draft.choice=o;draft.dirty=false;draft.mode='scroll';draft.deleted=false;
    let initial=o.from||o.meeting||{start:540,end:570};
    if(o.kind==='reserve'){const ranges=S.ranges(draft.ctx.board,draft.key,draft.ctx.date,draft.excluded),r=ranges.find(r=>Math.ceil(r.start/30)*30+30<=r.end);if(r)initial={start:Math.ceil(r.start/30)*30,end:Math.ceil(r.start/30)*30+30};}
    draft.op={kind:o.kind,date:draft.ctx.date,person:draft.person,group:draft.group,excluded:draft.excluded,from:o.from,id:o.meeting?.id,to:{start:initial.start,end:initial.end}};
    draft.initial={...draft.op.to};draft.dirty=false;buildEditor();
  }
  function buildEditor(){
    const {tools,track}=editorNodes;tools.replaceChildren();track.replaceChildren();
    const personal=draft.choice.kind==='personal-meeting';
    if(!personal){
      const controls=el('div','mob-time-controls');
      for(const [side,title] of [['start','開始'],['end','終了']]){
        const c=el('div','mob-time-control');c.append(el('span',null,title));
        c.append(button('−30',()=>adjust(side,-30),title+'を30分早める'),el('output','mob-time-output'),button('＋30',()=>adjust(side,30),title+'を30分遅らせる'));controls.append(c);
      }
      tools.append(controls);
      if(['person','meeting'].includes(draft.choice.kind)){
        const move=el('div','mob-editor-extras');for(const [delta,title] of [[-30,'30分前へ'],[30,'30分後へ']])move.append(button(title,()=>{draft.op.to={start:draft.op.to.start+delta,end:draft.op.to.end+delta};draft.dirty=true;updatePreview();}));tools.append(move);
      }
      if(draft.choice.kind==='person'&&draft.choice.from){
        const label=el('label',null,'移動先の人'),target=el('select');target.setAttribute('aria-label','移動先の人');
        draft.ctx.board.people.forEach((name,p)=>{const o=el('option',null,name+(p===draft.person?'（そのまま）':''));o.value=String(p);target.append(o);});target.value=String(draft.person);target.onchange=()=>{draft.op.target=Number(target.value);draft.dirty=true;updatePreview();};label.append(target);tools.append(label);
      }
      const modes=el('div','mob-editor-modes');for(const [id,text] of [['scroll','スクロール'],['select','範囲選択'],['start','開始'],['end','終了'],['move','移動']]){
        if((draft.choice.kind==='common'&&['select','move'].includes(id))||(draft.choice.kind==='meeting'&&id==='select'))continue;
        modes.append(button(text,()=>{draft.mode=id;updatePreview();},text+'モード'));modes.lastChild.dataset.mode=id;
      }tools.append(modes);
    }
    const extras=el('div','mob-editor-extras');
    if(draft.choice.value!=='new'){
      extras.append(button(draft.choice.kind==='common'?'全時間をMTGにする':draft.choice.meeting?'削除（復元）':'削除',()=>{draft.deleted=true;draft.dirty=true;draft.op.to.end=draft.op.to.start;updatePreview();},undefined,'mob-danger'));
      if(draft.choice.kind!=='common'&&(!draft.choice.meeting||draft.person===null)){const b=button('時間をコピー',()=>copy(A.formatDay(draft.ctx.date,[draft.choice.from||draft.choice.meeting]),tools));b.dataset.readonly='true';extras.append(b);}
    }
    if(draft.choice.kind==='meeting')extras.append(button('対象者を編集',()=>{const id=draft.choice.meeting.id;closeEditor(()=>bridge.openMeeting(id));}));
    tools.append(extras);
    if(draft.group)tools.append(el('p','mob-note','対象者：'+(draft.choice.meeting?draft.choice.meeting.members:S.participants(draft.ctx.board,draft.group,draft.excluded)).map(p=>draft.ctx.board.people[p]).join('、')));
    if(personal)tools.append(el('p','mob-note','この人だけMTGを解除できます。時間の調整はグループ側の編集から行ってください。'));
    for(let m=480;m<=1440;m+=30){const tick=el('div','mob-editor-tick',A.time(m));tick.style.top=(m-480)*1.6+'px';track.append(tick);}
    const ranges=draft.choice.kind==='meeting'?S.meetingAvailability(draft.ctx.board,draft.op.id):S.ranges(draft.ctx.board,draft.key,draft.ctx.date,draft.excluded);
    for(const range of ranges){const bar=el('div','mob-editor-available');bar.style.top=(range.start-480)*1.6+'px';bar.style.height=(range.end-range.start)*1.6+'px';bar.setAttribute('aria-label','可能時間 '+rangeText(range));track.append(bar);}
    for(const m of draft.ctx.board.meetings.filter(m=>m.date===draft.ctx.date&&(draft.group?m.group===draft.group:m.members.includes(draft.person)))){
      if(draft.choice.kind==='meeting'&&m.id===draft.op.id)continue;
      const b=el('div','mob-editor-existing',rangeText(m)+' MTG');b.style.top=(m.start-480)*1.6+'px';b.style.height=(m.end-m.start)*1.6+'px';b.style.background=S.color(m.group,draft.ctx.board.groups);track.append(b);
    }
    const preview=el('div','mob-editor-preview');
    for(const [side,text] of [['start','開始'],['end','終了']]){const handle=el('span','mob-drag-handle mob-drag-'+side,text);handle.dataset.handle=side;preview.append(handle);}track.append(preview);editorNodes.preview=preview;
    track.onpointerdown=pointerDown;track.onpointermove=pointerMove;track.onpointerup=pointerUp;track.onpointercancel=cancelGesture;
    updatePreview();
  }
  function adjust(side,delta){const to=draft.op.to;to[side]=Math.max(480,Math.min(1440,to[side]+delta));if(side==='start')to.start=Math.min(to.start,to.end);else to.end=Math.max(to.start,to.end);draft.deleted=false;draft.dirty=true;updatePreview();}
  function draftPlan(){if(draft.choice.kind==='personal-meeting'){if(!draft.deleted)throw Error('変更はありません。');return S.release(draft.ctx.board,draft.op.id,{person:draft.person});}return H.apply(draft.ctx.board,draft.op);}
  function updatePreview(){
    if(!draft)return;const n=editorNodes,to=draft.op.to;let error='';
    const changed=draft.dirty||draft.choice.value==='new';
    if(changed)try{draftPlan();}catch(e){error=e.message;}
    const current=bridge.context();if(current.pending||current.fingerprint!==draft.ctx.fingerprint)error='別の端末・タブで更新されました。閉じて最新の予定から編集してください。';
    else if(!current.writable)error=current.busy?'保存中…':'オフライン・閲覧のみ。接続が戻ってから編集してください。';
    n.error.textContent=error||draft.saveError||'';n.save.disabled=!changed||Boolean(error);
    n.tools.querySelectorAll('button').forEach(b=>b.disabled=current.busy||(!current.writable&&b.dataset.readonly!=='true'&&b.dataset.mode!=='scroll'));n.select.disabled=current.busy;
    n.tools.querySelectorAll('select').forEach(s=>s.disabled=!current.writable);
    n.tools.querySelectorAll('.mob-time-output').forEach((o,i)=>o.textContent=A.time(i?to.end:to.start));
    n.tools.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===draft.mode)));
    n.track.dataset.mode=draft.mode;n.track.dataset.personal=String(draft.choice.kind==='personal-meeting');
    const zero=to.start===to.end,kind=draft.op.kind;
    let message=zero?(kind==='common'?'元の共通時間をすべてMTGに変更':draft.choice.meeting?'MTGを解除して可能時間を復元':'可能時間を削除'):rangeText(to);
    if(kind==='common'&&!zero)message+=' を可能時間として残す（減らした分がMTG）';
    else if(kind==='reserve')message+=' をMTGに変更';
    if(kind==='personal-meeting')message=draft.deleted?'この人だけ解除して可能時間を復元':'この人のMTG';
    if(kind==='person'&&draft.op.target!==undefined&&draft.op.target!==draft.person&&!zero)message+=' ／ '+draft.ctx.board.people[draft.person]+' → '+draft.ctx.board.people[draft.op.target];
    if(kind==='person'&&!zero&&to.start>=480&&to.end<=1440){const remaining=A.subtract([to],draft.ctx.board.meetings.filter(m=>m.date===draft.ctx.date&&m.members.includes(draft.op.target??draft.person)));if(JSON.stringify(remaining)!==JSON.stringify([to]))message+='（MTGと重なる時間は除外）';}
    n.summary.textContent=(changed?'保存内容：':'選択中：')+message;
    n.preview.style.top=(to.start-480)*1.6+'px';n.preview.style.height=Math.max(1,(to.end-to.start)*1.6)+'px';n.preview.classList.toggle('mob-invalid',Boolean(error));n.preview.setAttribute('aria-label',rangeText(to));n.preview.hidden=draft.choice.kind==='personal-meeting';
  }
  function atPointer(e){const rect=editorNodes.track.getBoundingClientRect();return Math.max(480,Math.min(1440,480+(e.clientY-rect.top)/1.6));}
  function pointerDown(e){
    if(gesture&&gesture.pointer!==e.pointerId){cancelGesture();return;}
    if(e.button!==0||e.isPrimary===false||!draft||draft.mode==='scroll'||draft.choice.kind==='personal-meeting'||!bridge.context().writable)return;
    e.preventDefault();const cursor=atPointer(e),mode=e.target.dataset.handle||draft.mode;
    gesture={pointer:e.pointerId,origin:cursor,before:{...draft.op.to},dirty:draft.dirty,mode};editorNodes.track.setPointerCapture(e.pointerId);
    if(mode==='select'){const start=Math.min(1410,Math.floor(cursor/30)*30);draft.op.to={start,end:start+30};draft.dirty=true;updatePreview();}
  }
  function pointerMove(e){
    if(!gesture||gesture.pointer!==e.pointerId)return;e.preventDefault();const cursor=atPointer(e),g=gesture;
    if(g.mode==='select'){const anchor=Math.min(1410,Math.floor(g.origin/30)*30),end=Math.round(cursor/30)*30;draft.op.to={start:Math.min(anchor,end),end:Math.max(anchor+30,end)};}
    else draft.op.to=H.move(g.before,g.mode,g.origin,cursor);
    draft.dirty=true;draft.deleted=false;updatePreview();
  }
  function pointerUp(e){if(!gesture||gesture.pointer!==e.pointerId)return;pointerMove(e);gesture=null;draft.mode='scroll';updatePreview();}
  function cancelGesture(){if(!gesture||!draft)return;draft.op.to=gesture.before;draft.dirty=gesture.dirty;gesture=null;draft.mode='scroll';updatePreview();}
  window.addEventListener('orientationchange',cancelGesture);
  window.addEventListener('blur',cancelGesture);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture();});
  document.addEventListener('pointerdown',e=>{if(gesture&&gesture.pointer!==e.pointerId)cancelGesture();},true);
  async function saveDraft(){
    if(!draft||editorNodes.save.disabled)return;
    try{draft.saveError='';const next=draftPlan();if(await bridge.commit(next,'時間を保存しました',draft.ctx.fingerprint)){draft=null;gesture=null;editor.d.close();}else updatePreview();}catch(e){draft.saveError=e.message;updatePreview();}
  }
  function refresh(){if(refreshFrame)return;refreshFrame=requestAnimationFrame(()=>{refreshFrame=0;mode();render();if(editor.d.open){if(!bridge.context().writable){cancelGesture();if(draft)draft.mode='scroll';}updatePreview();}});}
  document.querySelectorAll('dialog:not(.mob-dialog)').forEach(d=>d.addEventListener('close',()=>{mode();refresh();if(compact)recoverFocus();}));
  const observer=new MutationObserver(refresh);for(const id of ['save-status','connection-status','pwa-status','install-app','update-app'])observer.observe($(id),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  const modalObserver=new MutationObserver(()=>document.documentElement.classList.toggle('mob-modal-open',Boolean(document.querySelector('dialog[open]'))));modalObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&full&&!document.querySelector('dialog[open]')){full=false;root.classList.remove('mob-full');render();}});
  mode();return {refresh,get editing(){return editor.d.open;}};
};

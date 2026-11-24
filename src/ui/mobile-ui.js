"use strict";
window.TokiMobileUI = function (bridge) {
  const M=window.TokiModel,A=window.TokiAvailability,S=window.TokiSchedule,H=window.TokiMobileModel;
  const $=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,run,label=text,cls='')=>{const n=el('button',cls,text);n.type='button';n.setAttribute('aria-label',label);n.onclick=run;return n;};
  const iconPaths={
    entry:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M9 16h6 M12 13v6',
    schedule:'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h3 M8 17h6',
    export:'M12 15V3 M7 8l5-5 5 5 M4 13v8h16v-8',
    more:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M5.5 19c.8-3.2 3-4.8 6.5-4.8s5.7 1.6 6.5 4.8',
    download:'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
    undo:'m10 5-6 6 6 6 M4 11h12a4 4 0 0 1 0 8h-2',
    redo:'m14 5 6 6-6 6 M20 11H8a4 4 0 0 0 0 8h2'
  };
  function navIcon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','mob-nav-icon');
    path.setAttribute('d',iconPaths[name]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.7');
    path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.append(path);return svg;
  }
  const rangeText=r=>`${A.time(r.start)}～${A.time(r.end)}`;
  const dayMeetings=(board,date,test)=>board.meetings.filter(m=>m.date===date&&test(m)).sort((a,b)=>a.start-b.start||a.end-b.end);
  const dayText=date=>A.formatDay(date,[]).replace(/：$/,'');
  const scope=()=>window.TokiShared.enabled?(window.TokiShared.scope||'shared'):'local';
  const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem('toki-view-v1:'+scope()+':'+key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem('toki-view-v1:'+scope()+':'+key,JSON.stringify(value));}catch{}}};
  let hidden=new Set(),folded=new Set(),entryTarget=null;
  let page='entry',compact=false,full=false;
  let timeAdjustment=null,permissionDialog=null,refreshFrame=0,lastFocus=null,lastRender='',lastScope='';
  const root=$('mobile-app'),header=el('div','mob-header'),content=el('div','mob-content'),nav=el('nav','mob-nav');
  const settled=()=>{bridge.settled();refresh();};
  const month=window.TokiMobileMonth({...bridge,openMeeting:openMeetingActions,openAvailability:availabilityActions,settled});
  const tableScroll=el('div','mob-table-scroll'),tableRows=new WeakMap(),tableBands=new WeakMap();
  const tableTimeline=window.TokiTouchTimeline({
    viewport:tableScroll,baseRow:48,previewClass:'mob-table-preview',active:()=>page==='schedule',
    hit(target){
      const track=target.closest?.('.mob-table-track'),button=target.closest?.('.mob-table-bar');
      return track&&{track,button,item:tableBands.get(button),...tableRows.get(track)};
    },
    context:bridge.context,settled,canEdit:canEditTableBand,
    insets:()=>({left:tableScroll.querySelector('th')?.offsetWidth||0,top:tableScroll.querySelector('thead')?.offsetHeight||0}),
    scale(slot,row){
      tableScroll.style.setProperty('--table-slot',slot+'px');
      tableScroll.style.setProperty('--table-row',row+'px');
    },
    save:saveTableTime,
    openBand({item,row,date}){
      if(item.kind==='meeting')openMeetingActions(item.range.id,row.group?null:row.person);
      else availabilityActions(row.person,item.range,date);
    }
  });
  const tableReorder=window.TokiRowDrag({
    scroll:tableScroll,board:()=>bridge.context().board,rowSelector:'.mob-table tbody tr',longPress:true,
    canStart:()=>page==='schedule'&&bridge.canManage()&&bridge.context().writable&&!document.querySelector('dialog[open]'),
    commit:async(next,message)=>bridge.commit(next,message,bridge.context().fingerprint),
    settled,notify:bridge.notify
  });
  const interacting=()=>month.interacting||tableTimeline.interacting||tableReorder.active;
  nav.setAttribute('aria-label','メインメニュー');root.append(header,content,month.node,nav);
  const narrow=matchMedia('(max-width: 767px)'),tablet=matchMedia('(max-width: 1023px) and (pointer: coarse)');
  function rememberFocus(){lastFocus=document.activeElement;}
  function recoverFocus(){if(lastFocus?.isConnected&&!lastFocus.closest('[hidden]'))lastFocus.focus({preventScroll:true});else root.querySelector('button')?.focus({preventScroll:true});}
  function dialog(title){
    const d=el('dialog','mob-dialog'),head=el('div','mob-dialog-head'),h=el('h2',null,title);
    h.id='mob-title-'+crypto.randomUUID();d.setAttribute('aria-labelledby',h.id);
    head.append(h,button('閉じる',()=>d.close()));d.append(head);document.body.append(d);
    d.addEventListener('close',()=>{bridge.settled();mode();refresh();recoverFocus();d.remove();});
    rememberFocus();return d;
  }
  function openShared(id){rememberFocus();$(id).click();}
  function toggleFold(id){if(folded.has(id))folded.delete(id);else folded.add(id);storage.set('toki-mobile-table-collapsed',[...folded]);render();}
  function mode(){
    if(document.querySelector('dialog[open]')||bridge.context().busy||bridge.interacting()||interacting())return;
    const next=narrow.matches||tablet.matches;if(next===compact)return;
    compact=next;document.documentElement.dataset.ui=compact?'compact':'desktop';
    if(compact)bridge.exitFullscreen();else{full=false;root.classList.remove('mob-full');}
    render();
    if(!compact)bridge.refreshGroupView();
  }
  narrow.addEventListener('change',mode);tablet.addEventListener('change',mode);
  function mutationButton(text,run,label=text,cls=''){
    const b=button(text,run,label,cls);b.disabled=!bridge.context().writable;return b;
  }
  function switchPage(next){
    if(month.interacting)month.cancel();
    if(tableTimeline.interacting)tableTimeline.cancel();
    if(tableReorder.active)tableReorder.cancel();
    page=next;full=false;root.classList.remove('mob-full');window.scrollTo(0,0);render();
    if(page==='schedule')bridge.refreshGroupView();
    if(page==='more'&&!$('company-button').hidden)openShared('company-button');
  }
  function renderDateBar(ctx,monthly){
    const datebar=el('div','mob-datebar'),previous=monthly?H.shiftMonth(ctx.date,-1):M.shiftDate(ctx.date,-1),following=monthly?H.shiftMonth(ctx.date,1):M.shiftDate(ctx.date,1);
    const prev=button('‹',()=>bridge.selectDate(previous),monthly?'前の月':'前の日');prev.disabled=!previous;
    const next=button('›',()=>bridge.selectDate(following),monthly?'次の月':'次の日');next.disabled=!following;
    const dateButton=button('▾ '+ctx.date.slice(0,4)+'年 '+dayText(ctx.date),bridge.openDatePicker,'日付を選択');
    dateButton.setAttribute('aria-haspopup','dialog');dateButton.setAttribute('aria-controls','date-picker');
    datebar.append(prev,dateButton,next);header.append(datebar);
  }
  function renderEntry(ctx){
    const board=ctx.board;
    const targets=H.entryRows(board,person=>bridge.canEditRow('p:'+person));
    const target=targets.find(row=>row.key===entryTarget)??targets.find(row=>row.person===bridge.linkedPerson())??targets.find(row=>!bridge.isPlace(row.person))??targets[0];
    entryTarget=target?.key??null;
    if(target){
      const tools=el('div','mob-entry-tools'),select=el('select','mob-entry-person');
      select.setAttribute('aria-label','入力する人・場所');
      for(const row of targets){const option=el('option','',row.name);option.value=row.key;select.append(option);}
      select.value=target.key;select.disabled=ctx.busy;
      select.onchange=()=>{entryTarget=select.value;render();};
      tools.append(select);header.append(tools);
    }
    month.render(ctx,target?.person??-1);
  }
  function toolbarButton(id,icon,label,text=''){
    const target=$(id),b=button(text,()=>openShared(id),label,'mob-tool');
    b.disabled=target.disabled;b.prepend(navIcon(icon));return b;
  }
  function renderBrand(){
    const brand=el('div','mob-brand'),tools=el('div','mob-brand-actions'),transfers=el('div','mob-brand-actions');
    brand.append(el('strong',null,'TOKI'),tools,transfers);
    tools.append(toolbarButton('undo','undo','元に戻す'),toolbarButton('redo','redo','やり直す'));
    const additions=['add-person','add-group','add-manual-person'].filter(id=>!$(id).hidden);
    if(additions.length){
      const menu=el('details','toolbar-menu'),summary=el('summary'),panel=el('div','toolbar-menu-panel'),lines=el('span','menu-lines');
      for(let i=0;i<3;i++)lines.append(el('i'));
      lines.setAttribute('aria-hidden','true');summary.append(lines,document.createTextNode('追加'));menu.append(summary,panel);
      for(const id of additions){
        const source=$(id),action=button(source.textContent.trim(),()=>{menu.open=false;openShared(id);});
        action.disabled=source.disabled;
        if(id==='add-person'&&!$('place-help').hidden){
          const row=el('div','place-add-control'),help=el('span','place-help');
          const tip=el('span','place-help-text',$('place-help-text').textContent);tip.id='mobile-add-place-hint';
          const toggle=button('ⓘ',()=>toggle.setAttribute('aria-expanded',String(toggle.getAttribute('aria-expanded')!=='true')),'場所・外部予定の説明');
          toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',tip.id);
          help.append(toggle,tip);row.append(action,help);panel.append(row);
        }else panel.append(action);
      }
      tools.append(menu);
    }
    transfers.append(toolbarButton('google-import-button','schedule','取り込み（Googleカレンダー）','取り込み'));
    if(!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone){
      const install=button('ダウンロード',()=>{
        if($('install-app').hidden)bridge.notify('ブラウザーの共有・メニューから「ホーム画面に追加」を選んでください。');
        else openShared('install-app');
      },'ダウンロード（アプリをインストール）','mob-tool');
      install.prepend(navIcon('download'));transfers.append(install);
    }
    return brand;
  }
  function render(){
    const ctx=bridge.context();root.hidden=!compact||!ctx.ready;if(!compact||!ctx.ready)return;
    if(interacting())return;
    if(lastScope!==scope()){
      lastScope=scope();lastRender='';entryTarget=null;page='entry';full=false;
      const saved=storage.get('toki-mobile-table-collapsed',storage.get('toki-mobile-folded',[]));
      folded=new Set(Array.isArray(saved)?saved:[]);
      month.reset();
      tableTimeline.reset();
    }
    hidden=new Set([...ctx.board.groups.map(g=>g.id),'@unassigned'].filter(id=>!bridge.visibleGroup(id)));
    const signature=JSON.stringify([ctx.fingerprint,ctx.date,ctx.writable,ctx.busy,bridge.canManage(),bridge.ownPerson(),bridge.canInspectPersonAccess(),bridge.memberMeetingsEnabled(),page,entryTarget,full,[...hidden],[...folded],ctx.board.groups.map(g=>bridge.excluded(g.id)),...['connection-status','pwa-status','install-app','update-app','undo','redo','google-import-button','add-manual-person'].map(id=>[$(id).textContent,$(id).hidden,$(id).disabled])]);
    if(signature===lastRender)return;lastRender=signature;
    const previousScroll=root.querySelector('.mob-table-scroll'),tablePosition=previousScroll?[previousScroll.scrollLeft,previousScroll.scrollTop]:[0,0];
    const active=root.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
    const board=ctx.board;
    const bulkOpen=header.querySelector('.bulk-exclude')?.open??false;
    header.replaceChildren(renderBrand());
    const notice=$('connection-status');if(!notice.hidden)header.append(el('p','mob-notice',notice.textContent));
    if(!$('update-app').hidden)header.append(button('最新版に更新',()=>openShared('update-app')));
    content.replaceChildren();
    const entering=page==='entry';content.hidden=entering;month.node.hidden=!entering;
    root.classList.toggle('mob-entry-active',entering);
    if(entering){renderDateBar(ctx,true);renderEntry(ctx);}
    else if(page==='schedule'){
      renderDateBar(ctx,false);
      const tools=el('div','mob-viewbar');
      const bulk=el('details','toolbar-menu bulk-exclude'),options=el('div','toolbar-menu-panel bulk-options');
      bulk.open=bulkOpen;bulk.append(el('summary',null,'一括除外'),options);bridge.fillBulkOptions(options);
      tools.append(el('span','mob-member-count',bridge.scheduleCount()),button(`▾ 表示グループ ${board.groups.filter(g=>!hidden.has(g.id)).length}/${board.groups.length}`,bridge.openGroupView,'表示グループを選択'),bulk);
      header.append(tools);
      renderTable(board,ctx.date);
    }else if(page==='members'){
      content.append(button('‹ アカウントへ戻る',()=>{page='more';render();}));
      renderMembers(board);
    }
    else if(page==='export'){
      content.append(el('h1',null,'書き出し'),el('p','mob-muted','対象と期間を選んでコピーできます。'));
      actionCard('可能時間書き出し','人・グループの可能時間をコピー','export-availability');
      actionCard('MTG一括書き出し','対象グループとMTG参加者ごとにコピー','export-meetings');
      actionCard('PDF出力','予定表を印刷・PDFで保存','print-button');
      content.append(el('p','mob-note','表示グループのチェックは書き出しに影響しません。MTG書き出しは全グループが初期選択されます。'));
    }else{
      content.append(el('h1',null,'アカウント'));
      if(bridge.canManagePlaces()){
        const members=button('',()=>switchPage('members'),'メンバー','mob-action-card');
        members.append(el('strong',null,'メンバーと場所'),el('span','mob-chevron','›'));content.append(members);
      }
      if(!$('company-button').hidden)actionCard('組織・アカウント','組織の切り替え・ログアウト・参加者の管理','company-button');
      if(!$('pwa-status').hidden)content.append(el('p','mob-note',$('pwa-status').textContent));
      const help=el('section','mob-card');help.append(el('h2',null,'💡 スマホの操作'));
      const list=el('ul');for(const text of ['予定入力は空き枠をタップするか、長押ししてその場で離すと30分追加できます。長押ししてから指を動かすと範囲を指定できます。','帯の中央を長押しして同じ日の中で移動。月間の予定入力では、別日にドラッグするとコピーします。両端を長押しして開始・終了を調整できます。','帯をタップすると時間調整やコピーなどの操作メニューが開きます。','スワイプでスクロール、2本指で拡大・縮小。','予定の表ではグループ名の横の矢印で折りたためます。','オフラインの共有予定は閲覧のみです。'])list.append(el('li',null,text));help.append(list);content.append(help);
    }
    nav.replaceChildren();for(const [id,name] of [['entry','予定入力'],['schedule','予定管理'],['export','書き出し'],['more','アカウント']]){
      const b=button('',()=>switchPage(id),name);b.append(navIcon(id),el('span',null,name));b.setAttribute('aria-current',id===(page==='members'?'more':page)?'page':'false');nav.append(b);
    }
    if(active)Array.from(root.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===active)?.focus({preventScroll:true});
    if(page==='schedule'){tableScroll.scrollLeft=tablePosition[0];tableScroll.scrollTop=tablePosition[1];}
  }
  function actionCard(title,desc,id){const b=button('',()=>openShared(id),title,'mob-action-card');b.append(el('strong',null,title),el('span','mob-muted',desc),el('span','mob-chevron','›'));b.disabled=$(id).disabled;content.append(b);}
  function meetingLabel(board,m,inGroup){
    const name=inGroup?m.members.map(person=>board.people[person]).join('、'):board.groups.find(group=>group.id===m.group)?.name;
    return name?name+' MTG':'MTG';
  }
  function showError(container,message){let error=container.querySelector('.mob-error');if(!error){error=el('p','mob-error');error.setAttribute('role','alert');container.append(error);}error.textContent=message;}
  async function openPersonAccess(row){
    if(!bridge.canInspectPersonAccess())return;
    const personId=bridge.context().board.rows?.[row.person]?.id;
    if(!personId)return;
    const currentScope=scope(),d=dialog(row.name+'の権限'),status=el('p','mob-note','権限を確認中…');
    const current=()=>d.open&&scope()===currentScope&&bridge.canInspectPersonAccess();
    permissionDialog=d;
    d.addEventListener('close',()=>{if(permissionDialog===d)permissionDialog=null;},{once:true});
    status.setAttribute('role','status');d.append(status);d.showModal();
    try{
      const access=await bridge.personAccess(personId);
      if(!current())return;
      if(!access){status.textContent='この行にひも付く組織メンバーやゲストはありません。';return;}
      if(!access.active){status.textContent='この人は現在、この組織の予定表にアクセスできません。';return;}
      const board=bridge.context().board,admin=access.role==='admin';
      const groups=board.groups.filter(group=>admin||access.groupIds.includes(group.id));
      const groupMembers=new Set(groups.flatMap(group=>group.members));
      const rows=board.rows.flatMap((record,index)=>admin||record.id===personId||groupMembers.has(index)
        ?[{...record,name:board.people[index]}]:[]);
      const show=(kind,filter)=>rows.filter(record=>record.kind===kind&&filter(record)).map(record=>record.name);
      const groupNames=groups.map(group=>group.name),names=show('person',()=>true),places=show('place',()=>true);
      status.textContent=admin?'組織の管理者':access.role==='guest'?'ゲスト':'一般メンバー';
      const accessList=el('dl','mob-access-list');
      for(const [label,values] of [
        ['閲覧できるグループ',groupNames],
        ['閲覧できる人',names],
        ['閲覧できる場所・外部予定',places],
        ['可能時間を編集できる人',show('person',record=>admin||record.id===personId)],
        ['可能時間を編集できる場所・外部予定',access.role==='guest'?[]:places],
        ['MTGを設定できるグループ',admin||access.role==='member'&&bridge.memberMeetingsEnabled()?groupNames:[]]
      ])accessList.append(el('dt',null,label),el('dd',null,values.join('、')||'なし'));
      d.append(accessList);
      if(!admin){
        const form=el('form','mob-access-form');
        const save=bridge.personAccessChoices(form,board,access);
        const submit=el('button','primary','閲覧権限を保存');submit.type='submit';
        form.append(submit);d.append(form);
        form.onsubmit=async event=>{
          event.preventDefault();
          if(!current()||submit.disabled)return;
          const fields=[...form.querySelectorAll('fieldset')];
          submit.disabled=true;
          for(const field of fields)field.disabled=true;
          try{
            const result=await save();
            if(current()){d.close();bridge.notify(result?.queued?'レビュー待ちとして登録しました':'閲覧権限を保存しました');}
          }catch(error){if(current())showError(form,error.message);}
          finally{submit.disabled=false;for(const field of fields)field.disabled=false;}
        };
      }
    }catch(error){if(current())status.textContent=error.message;}
  }
  function availabilityActions(person,range,chosenDate){
    const ctx=bridge.context();ctx.date=chosenDate;
    const d=dialog(ctx.board.people[person]+'の可能時間');d.append(el('p',null,A.formatDay(ctx.date,[range])));
    const source={kind:'availability',person,date:ctx.date,...range};
    addTimeAdjustment(d,source,range,ctx.fingerprint);
    if(bridge.canEditRow('p:'+person))d.append(mutationButton('削除',async()=>{try{if(await bridge.commit(S.editPerson(ctx.board,person,ctx.date,[range],[]),'可能時間を削除しました',ctx.fingerprint))d.close();}catch(e){showError(d,e.message);}},undefined,'mob-danger'));
    d.append(button('時間をコピー',()=>copy(A.formatDay(ctx.date,[range]),d)));
    if(bridge.canEditRow('p:'+person))addDuplicateAction(d,source);
    d.showModal();
  }
  function canEditTableBand({row,item}){
    if(row.group)return item?.kind==='meeting'?bridge.canEditMeeting(item.range.id):Boolean(item)&&bridge.canScheduleMeeting(row.group.id);
    return item?.kind!=='meeting'&&bridge.canEditRow(row.key);
  }
  async function saveTableTime(active,track,to){
    const {ctx,row,item,date}=active;
    if(!bridge.context().writable)return;
    try{
      if(row.group){
        if(!bridge.canScheduleMeeting(row.group.id))return;
        if(item?.kind==='meeting'){
          const {id,start,end}=item.range;
          if(!bridge.canEditMeeting(id))return;
          if(to.start===start&&to.end===end)return;
          await bridge.commit(S.adjustMeeting(ctx.board,id,to),'MTGを変更しました',ctx.fingerprint);
        }else{
          if(item?.kind!=='common'||to.start<item.range.start||to.end>item.range.end)
            throw Error('⚠️可能時間がありません');
          await bridge.commit(S.reserve(ctx.board,row.group.id,date,[to],active.excluded),'MTGを登録しました',ctx.fingerprint);
        }
      }else if(canEditTableBand(active)){
        const from=item?.range;
        if(from&&from.start===to.start&&from.end===to.end)return;
        await bridge.commit(H.applyMonthEdit(ctx.board,{person:row.person,date,from,to}),'可能時間を保存しました',ctx.fingerprint);
      }
    }catch(error){bridge.notify(error.message);}
  }
  function tableBand(bar,kind,range){
    bar.style.left=(range.start-480)/960*100+'%';
    bar.style.width=(range.end-range.start)/960*100+'%';
    tableBands.set(bar,{kind,range});
    return bar;
  }
  function renderTable(board,date){
    const head=el('div','mob-rowhead mob-table-tools');head.append(button(full?'⛶ 全画面終了':'⛶ 全画面表示',()=>{full=!full;root.classList.toggle('mob-full',full);render();}));content.append(head);
    const table=el('table','mob-table'),thead=el('thead'),tr=el('tr');table.setAttribute('aria-label',dayText(date)+'の比較表');
    tr.append(el('th',null,'名前'));const day=el('th',null,dayText(date));day.colSpan=32;tr.append(day);thead.append(tr);const times=el('tr');times.append(el('th',null,'可能時間'));
    for(let m=480;m<1440;m+=30)times.append(el('th',null,A.time(m)));thead.append(times);table.append(thead);const tbody=el('tbody');
    const visibleRows=H.rows(board,[...hidden],folded).filter(r=>!hidden.has('@unassigned')||r.group||r.context);
    const own=bridge.ownPerson();
    if(own>=0&&!visibleRows.some(row=>row.person===own)&&!board.groups.some(group=>!hidden.has(group.id)&&group.members.includes(own)))
      visibleRows.unshift({key:'p:'+own,person:own,name:board.people[own]});
    for(const row of visibleRows){
      const r=el('tr',row.group?'mob-group-tr':''),name=el('th');
      const kind=row.group?'group':bridge.isPlace(row.person)?'place':'person',id=row.group?.id??row.person;
      r.dataset.name=row.name;r.dataset.context=row.context||'';
      if(row.group)r.dataset.group=row.group.id;else r.dataset.person=row.person;
      const edit=bridge.canOpenRoster(kind,id);
      const text=edit
        ?mutationButton(row.name,()=>bridge.openRoster(kind,id,row.context),row.name+'を編集・削除','mob-table-name')
        :el('span','mob-table-name',row.name);
      if(edit)text.setAttribute('aria-haspopup','dialog');
      name.scope='row';
      const label=el('div','mob-table-group-label');name.append(label);
      if(bridge.canManage())label.append(mutationButton('⋮⋮',null,row.name+'の行を移動','row-drag-handle'));
      if(row.group){
        const expanded=!folded.has(row.group.id);
        const fold=button(expanded?'▾':'▸',()=>toggleFold(row.group.id),row.name+'のメンバー表示','mob-table-fold');
        fold.setAttribute('aria-expanded',String(expanded));label.append(fold);
      }else if(row.context){
        const excluded=bridge.excluded(row.context).includes(row.name);
        if(excluded)text.classList.add('mob-excluded');
        const toggle=button(excluded?'−':'✓',()=>bridge.toggleMember(row.context,row.name),row.name+(excluded?'を対象に戻す':'を対象から一時除外'),'mob-table-fold');
        toggle.disabled=bridge.bulkExcluded(row.context).includes(row.name);
        toggle.setAttribute('aria-pressed',String(!excluded));label.append(toggle);
      }
      label.append(text);
      r.append(name);
      const td=el('td');td.colSpan=32;const track=el('div','mob-table-track');
      const excluded=row.group?bridge.excluded(row.group.id):[];
      tableRows.set(track,{row,date,excluded});
      const available=S.ranges(board,row.key,date,excluded);
      for(const range of available){
        const time=rangeText(range);
        const bar=row.group
          ?bridge.canScheduleMeeting(row.group.id)
            ?mutationButton(time,event=>{if(event.detail===0)createMeeting(row.group,range,date);},row.name+' '+time+'からMTGを作成','mob-table-bar')
            :el('span','mob-table-bar',time)
          :button(time,event=>{if(event.detail===0)availabilityActions(row.person,range,date);},row.name+' '+time+'の操作','mob-table-bar');
        track.append(tableBand(bar,row.group?'common':'availability',range));
      }
      const mtgs=dayMeetings(board,date,m=>row.group?m.group===row.group.id:m.members.includes(row.person)),lanes=[];
      for(const m of mtgs){
        let lane=lanes.findIndex(end=>end<=m.start);if(lane<0)lane=lanes.length;lanes[lane]=m.end;
        const text=meetingLabel(board,m,Boolean(row.group))+' '+rangeText(m);
        const bar=button(text,event=>{if(event.detail===0)openMeetingActions(m.id,row.group?null:row.person);},text+'の操作','mob-table-bar mob-table-mtg');
        bar.style.background=S.color(m.group,board.groups);
        bar.style.setProperty('--table-band-lane',lane);
        track.append(tableBand(bar,'meeting',m));
      }
      track.style.setProperty('--table-lanes',lanes.length);
      td.append(track);r.append(td);tbody.append(r);
    }
    const bottom=el('div','bottom-add-row mob-reorder-end','未所属・表の末尾へ');
    table.append(tbody);tableScroll.replaceChildren(table,bottom);content.append(tableScroll);
  }
  function renderMembers(board){
    content.append(el('h1',null,'メンバーと場所'));const add=el('div','mob-actions');
    if(bridge.scoped()){
      const control=el('span','place-add-control'),create=mutationButton('＋ 場所・外部予定を追加',()=>bridge.openRoster('place',null));
      create.disabled||=!bridge.canAddPlace();
      const help=el('span','place-help'),toggle=button('ⓘ',()=>toggle.setAttribute('aria-expanded',String(toggle.getAttribute('aria-expanded')!=='true')),'場所・外部予定の説明');
      toggle.setAttribute('aria-controls','mobile-place-help-text');toggle.setAttribute('aria-expanded','false');
      const description=el('span','place-help-text',$('place-help-text').textContent);description.id='mobile-place-help-text';
      help.append(toggle,description);control.append(create,help);add.append(control);
    }else add.append(mutationButton('＋ 人を追加',()=>bridge.openRoster('person',null)));
    if(bridge.canManage())add.append(mutationButton('＋ グループ',()=>bridge.openRoster('group',null)));
    content.append(add);
    if(!bridge.canManage()){
      if(!board.groups.length)content.append(el('p','mob-note','場所・外部予定を追加するには、管理者にグループの閲覧権限を依頼してください。'));
      for(const group of board.groups){
        const places=group.members.filter(bridge.isPlace);if(!places.length)continue;
        const card=el('section','mob-card');card.append(el('h2',null,group.name));
        for(const person of places)card.append(mutationButton(board.people[person],()=>bridge.openRoster('place',person,group.id),board.people[person]+'の設定を開く'));
        content.append(card);
      }
      return;
    }
    content.append(el('p','mob-note','名前・所属は「編集」。↑↓で並べ替えできます。ここでは非表示のグループも表示します。'));
    for(const [index,g] of board.groups.entries()){
      const card=el('section','mob-card'),head=el('div','mob-rowhead');head.append(el('h2',null,g.name),mutationButton('編集',()=>bridge.openRoster('group',g.id),g.name+'の設定を編集'));card.append(head);
      const controls=el('div','mob-actions');for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.reorderGroup(board,g.id,board.groups[index+delta].id,delta>0)),g.name+(delta<0?'を上へ':'を下へ'));b.disabled||=index+delta<0||index+delta>=board.groups.length;controls.append(b);}card.append(controls);
      for(const [i,p] of g.members.entries()){
        const row=el('div','mob-member-setting');row.append(el('span',null,board.people[p]),mutationButton('編集',()=>bridge.openRoster(bridge.isPlace(p)?'place':'person',p,g.id),board.people[p]+'の名前・所属を編集'));
        for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.placePerson(board,p,{group:g.id,target:g.members[i+delta],after:delta>0})),board.people[p]+(delta<0?'を上へ':'を下へ'));b.disabled||=i+delta<0||i+delta>=g.members.length;row.append(b);}card.append(row);
      }content.append(card);
    }
    const people=M.rows(board).filter(r=>r.person!==undefined&&!r.context);if(people.length){const card=el('section','mob-card');card.append(el('h2',null,'未所属'));for(const [index,row] of people.entries()){const line=el('div','mob-member-setting');line.append(el('span',null,row.name),mutationButton('編集',()=>bridge.openRoster(bridge.isPlace(row.person)?'place':'person',row.person),row.name+'の名前・所属を編集'));for(const [delta,text] of [[-1,'↑'],[1,'↓']]){const b=mutationButton(text,()=>reorder(board,()=>M.reorderPeople(board,row.person,people[index+delta].person,delta>0)),row.name+(delta<0?'を上へ':'を下へ'));b.disabled||=index+delta<0||index+delta>=people.length;line.append(b);}card.append(line);}content.append(card);}
    if(!bridge.scoped())content.append(mutationButton('＋ 人を追加',()=>bridge.openRoster('person',null),'一覧の末尾から人を追加'));
  }
  async function reorder(board,make){try{await bridge.commit(make(),'並び順を変更しました',JSON.stringify(board));}catch(e){bridge.notify(e.message);}}
  async function copy(text,parent){try{await navigator.clipboard.writeText(text);bridge.notify('時間をコピーしました');}catch{const area=el('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','コピーする時間');parent.append(el('p','mob-note','コピーできない場合は、次の文字を選択してコピーしてください。'),area);area.focus();area.select();}}
  function createMeeting(group,range,date){
    const ctx=bridge.context();
    if(!ctx.writable||!bridge.canScheduleMeeting(group.id))return;
    const excluded=bridge.excluded(group.id),members=S.participants(ctx.board,group.id,excluded);
    const d=dialog(group.name+'のMTGを作成');
    d.append(el('p',null,A.formatDay(date,[range])),el('p','mob-note','対象者：'+members.map(person=>ctx.board.people[person]).join('、')));
    const start=Math.ceil(range.start/30)*30;
    mountTimeAdjustment(d,{
      range:start+30<=range.end?{start,end:start+30}:range,
      creatingMeeting:true,
      canSave:()=>bridge.context().writable&&bridge.canScheduleMeeting(group.id),
      save:to=>{
        if(to.start<range.start||to.end>range.end)throw Error('⚠️可能時間がありません');
        return bridge.commit(S.reserve(ctx.board,group.id,date,[to],excluded),'MTGを登録しました',ctx.fingerprint);
      }
    });
    d.showModal();
  }
  function addTimeAdjustment(d,source,range,fingerprint){
    if(!bridge.canAdjustTime(source))return;
    mountTimeAdjustment(d,{range,canSave:()=>bridge.canSaveTime(source),save:to=>bridge.adjustTime(source,to,fingerprint)});
  }
  function mountTimeAdjustment(d,options){
    let locked=[];
    const adjustment=window.TokiTimeAdjustment({
      ...options,
      async save(to){await options.save(to);if(d.open)d.close();},
      onBusy(saving){
        d.setAttribute('aria-busy',String(saving));
        if(saving)locked=[...d.querySelectorAll('button:enabled')].filter(button=>!adjustment.form.contains(button));
        for(const button of locked)button.disabled=saving;
      }
    });
    timeAdjustment=adjustment;d.append(adjustment.form);
    d.addEventListener('cancel',event=>{if(d.getAttribute('aria-busy')==='true')event.preventDefault();});
    d.addEventListener('close',()=>{if(timeAdjustment===adjustment)timeAdjustment=null;},{once:true});
  }
  function addDuplicateAction(d,source){
    const action=mutationButton('他の日に複製',()=>{
      if(!bridge.canDuplicate(source))return;
      d.close();
      bridge.openDuplicatePicker(source);
    });
    action.setAttribute('aria-haspopup','dialog');
    action.setAttribute('aria-controls','date-picker');
    d.append(action);
  }
  function openMeetingActions(id,person){
    const ctx=bridge.context(),m=ctx.board.meetings.find(m=>m.id===id);if(!m)return;const d=dialog('MTGの操作');d.append(el('p',null,dayText(m.date)+' '+rangeText(m)),el('p','mob-note',person===null?'対象者：'+m.members.map(p=>ctx.board.people[p]).join('、'):'対象者：'+ctx.board.people[person]),el('p','mob-note','登録者：'+(m.creatorName||'不明')));
    const source={kind:'meeting',id,person};
    addTimeAdjustment(d,source,m,ctx.fingerprint);
    if(bridge.canEditMeeting(id)){
      if(person===null)d.append(mutationButton('対象者を編集',()=>{d.close();bridge.openMeeting(id);}));
      d.append(mutationButton('削除（可能時間を復元）',async()=>{if(!bridge.canEditMeeting(id))return;try{if(await bridge.commit(S.release(ctx.board,id,person===null?{}:{person}),'MTGを解除しました',ctx.fingerprint))d.close();}catch(e){showError(d,e.message);}},undefined,'mob-danger'));
    }
    if(person===null){
      d.append(button('時間をコピー',()=>copy(A.formatDay(m.date,[m]),d)));
      if(m.limitedParticipants)d.append(el('p','mob-note','閲覧範囲外の対象者も参加しています。'));
      if(bridge.canDuplicate(source))addDuplicateAction(d,source);
    }
    d.showModal();
  }
  function refresh(){if(refreshFrame)return;refreshFrame=requestAnimationFrame(()=>{refreshFrame=0;if(permissionDialog?.open&&!bridge.canInspectPersonAccess())permissionDialog.close();mode();render();timeAdjustment?.refresh();});}
  document.querySelectorAll('dialog:not(.mob-dialog)').forEach(d=>d.addEventListener('close',()=>{mode();refresh();if(compact)recoverFocus();}));
  const observer=new MutationObserver(refresh);for(const id of ['save-status','connection-status','pwa-status','install-app','update-app'])observer.observe($(id),{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
  const modalObserver=new MutationObserver(()=>document.documentElement.classList.toggle('mob-modal-open',Boolean(document.querySelector('dialog[open]'))));modalObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&full&&!document.querySelector('dialog[open]')){full=false;root.classList.remove('mob-full');render();}});
  function reset(){month.reset();tableTimeline.reset();tableReorder.cancel();tableScroll.replaceChildren();timeAdjustment=null;lastFocus=null;lastRender='';lastScope='';page='entry';entryTarget=null;full=false;root.classList.remove('mob-full','mob-entry-active');header.replaceChildren();content.replaceChildren();nav.replaceChildren();root.hidden=true;}
  mode();return {refresh,reset,jumpToDate:month.jump,openAvailability:availabilityActions,openMeeting:openMeetingActions,openPersonAccess,get interacting(){return interacting();},get shouldPromptGroups(){return !(narrow.matches||tablet.matches)||page==='schedule';}};
};

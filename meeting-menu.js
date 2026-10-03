"use strict";
window.TokiMeetingMenu=({root,resolve,board,canOpen,canDelete,onOpen,release,notify,settled})=>{
  const $=id=>document.getElementById(id),dialog=$('meeting-menu');
  let press=null,target=null,suppressClick=false,resetClick;
  function cancel(){if(press)clearTimeout(press.timer);press=null;}
  function finish(event){
    if(!press||event.pointerId!==press.pointer)return;
    const opened=press.opened;cancel();
    if(opened){suppressClick=true;clearTimeout(resetClick);resetClick=setTimeout(()=>suppressClick=false,0);}
    // The short click may still open the existing participant dialog.
    setTimeout(settled,0);
  }
  function open(bar,x,y){
    if(!canOpen())return false;
    const event=resolve(bar);if(event?.kind!=='meeting')return false;
    const current=board(),meeting=current.meetings.find(m=>m.id===event.id);
    const person=event.inGroup?null:Number(event.row.slice(2));
    if(!meeting||(person!==null&&!meeting.members.includes(person)))return false;
    onOpen();target={id:meeting.id,person};
    $('meeting-menu-title').textContent=person===null?'グループのMTG':current.people[person]+'のMTG';
    $('meeting-menu-time').textContent=window.TokiAvailability.formatDay(meeting.date,[meeting]);
    $('meeting-menu-scope').textContent=person===null?'削除すると対象者全員の可能時間を復元します。':'削除するとこの人だけの可能時間を復元します。';
    $('copy-meeting-time').hidden=person!==null;
    $('meeting-copy-fallback').hidden=true;$('meeting-menu-error').textContent='';
    refresh();dialog.showModal();
    const rect=dialog.getBoundingClientRect();
    dialog.style.left=Math.max(8,Math.min(x+8,window.innerWidth-rect.width-8))+'px';
    dialog.style.top=Math.max(8,Math.min(y+8,window.innerHeight-rect.height-8))+'px';
    return true;
  }
  root.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false)return;
    cancel();suppressClick=false;clearTimeout(resetClick);
    const bar=event.target.closest('.event.meeting');if(!bar||!canOpen())return;
    press={pointer:event.pointerId,x:event.clientX,y:event.clientY,opened:false};
    press.timer=setTimeout(()=>{
      if(!press)return;
      if(open(bar,press.x,press.y)){press.opened=true;suppressClick=true;}else cancel();
    },600);
  },true);
  document.addEventListener('pointermove',event=>{
    if(press&&!press.opened&&event.pointerId===press.pointer&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>=5)cancel();
  },true);
  document.addEventListener('pointerup',finish,true);
  document.addEventListener('pointercancel',event=>{if(event.pointerId===press?.pointer){cancel();suppressClick=false;setTimeout(settled,0);}},true);
  document.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);
  root.addEventListener('contextmenu',event=>{
    const bar=event.target.closest('.event.meeting');if(!bar)return;
    event.preventDefault();
    if(!dialog.open&&open(bar,event.clientX,event.clientY)&&press){clearTimeout(press.timer);press.opened=true;suppressClick=true;}
  });
  root.addEventListener('keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    const bar=event.target.closest('.event.meeting');if(!bar)return;
    event.preventDefault();const rect=bar.getBoundingClientRect();open(bar,rect.left,rect.bottom);
  });
  root.addEventListener('scroll',()=>{if(!press?.opened)cancel();},true);
  window.addEventListener('blur',()=>{cancel();suppressClick=false;});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){cancel();suppressClick=false;}},true);
  $('close-meeting-menu').onclick=()=>{if(dialog.getAttribute('aria-busy')!=='true')dialog.close();};
  dialog.addEventListener('cancel',event=>{if(dialog.getAttribute('aria-busy')==='true')event.preventDefault();});
  dialog.addEventListener('close',()=>{target=null;cancel();suppressClick=false;settled();});
  $('delete-meeting').onclick=async()=>{
    if(!target||!canDelete())return;
    dialog.setAttribute('aria-busy','true');refresh();
    try{if(await release(target))dialog.close();else $('meeting-menu-error').textContent='削除を保存できませんでした。閉じて最新の予定を確認してください。';}
    catch(error){$('meeting-menu-error').textContent=error.message;}
    finally{dialog.setAttribute('aria-busy','false');refresh();}
  };
  $('copy-meeting-time').onclick=async()=>{
    if(!target||target.person!==null)return;
    const meeting=board().meetings.find(m=>m.id===target.id);if(!meeting)return;
    const text=window.TokiAvailability.formatDay(meeting.date,[meeting]);
    try{await navigator.clipboard.writeText(text);dialog.close();notify('MTGの時間をコピーしました');}
    catch{const fallback=$('meeting-copy-fallback');fallback.hidden=false;fallback.value=text;fallback.focus();fallback.select();$('meeting-menu-error').textContent='自動コピーできません。選択されたテキストをコピーしてください。';}
  };
  function refresh(){const saving=dialog.getAttribute('aria-busy')==='true';$('delete-meeting').disabled=saving||!canDelete();$('copy-meeting-time').disabled=saving;$('close-meeting-menu').disabled=saving;}
  return {get pressing(){return Boolean(press);},refresh};
};

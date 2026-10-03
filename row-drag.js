"use strict";
// Row dragging uses its own handles, leaving schedule dragging unchanged.
window.TokiRowDrag = ({scroll,board,canStart,commit,settled,notify,moveBetweenGroups=false}) => {
  const M=window.TokiModel,status=document.getElementById('row-drag-status'),idleText=status.textContent;
  let state=null,frame=0,marked=null;
  function clearMark(){marked?.classList.remove('row-drop-before','row-drop-after','row-drop-inside');marked=null;}
  function targetAt(x,y){
    const hit=document.elementFromPoint(x,y);if(!hit)return null;
    if(state.group){
      const row=hit.closest('.person-row'),bottom=hit.closest('.bottom-add-row');if(!scroll.contains(hit)||!row&&!bottom)return null;
      const target=row?.dataset.group||row?.dataset.context||null;if(target===state.group)return null;
      const after=target?(!row.dataset.group||y>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2):false;
      const name=board().groups.find(g=>g.id===target)?.name;
      return {node:row||bottom,options:{target,after},label:target?name+'の'+(after?'下':'上')+'にグループを移動':'グループの末尾へ移動',style:after?'row-drop-after':'row-drop-before'};
    }
    const leaveLabel=state.source?'元のグループへの所属だけ解除（他の所属は保持）':null;
    if(hit.closest('.bottom-add-row'))return {node:hit.closest('.bottom-add-row'),options:{group:null,source:state.source},label:leaveLabel||'未所属の末尾へ',style:'row-drop-inside'};
    const row=hit.closest('.person-row');if(!row||!scroll.contains(row))return null;
    const group=row.dataset.context||null;
    if(row.dataset.group)return {node:row,options:{group:row.dataset.group,source:state.source,move:moveBetweenGroups},label:row.dataset.name+'に'+(moveBetweenGroups&&state.source!==row.dataset.group?'移動':'所属を追加'),style:'row-drop-inside'};
    const person=Number(row.dataset.person);if(person===state.person&&group===state.source)return null;
    const after=y>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2;
    const label=!group&&leaveLabel?leaveLabel:(group?'グループ内':'未所属')+'：'+row.dataset.name+'の'+(after?'下':'上')+'へ';
    return {node:row,options:{group,target:person,after,source:state.source,move:moveBetweenGroups},label,style:after?'row-drop-after':'row-drop-before'};
  }
  function update(){if(!state?.moved)return;state.ghost.style.left=Math.min(state.x+14,window.innerWidth-240)+'px';state.ghost.style.top=Math.max(4,Math.min(state.y+14,window.innerHeight-65))+'px';
    clearMark();state.target=targetAt(state.x,state.y);if(state.target){marked=state.target.node;marked.classList.add(state.target.style);}
    const text=state.target?.label||'移動先へドラッグ（Escでキャンセル）';if(status.textContent!==text)status.textContent=text;
  }
  function autoScroll(){if(!state?.moved)return;const rect=scroll.getBoundingClientRect();if(state.x>=rect.left&&state.x<=rect.right&&state.y>=rect.top+65&&state.y<=rect.bottom){let dy=0;if(state.y<rect.top+100)dy=-9;else if(state.y>rect.bottom-45)dy=9;if(dy){scroll.scrollTop+=dy;update();}}frame=requestAnimationFrame(autoScroll);}
  function cancel(apply=true){if(!state)return;const previous=state;state=null;cancelAnimationFrame(frame);clearMark();previous.ghost?.remove();previous.row.classList.remove('row-drag-source');document.body.classList.remove('row-dragging');try{previous.handle.releasePointerCapture(previous.pointer);}catch{}status.textContent=idleText;if(apply)settled();}
  scroll.addEventListener('pointerdown',event=>{const handle=event.target.closest('.row-drag-handle');if(!handle||event.button!==0||!canStart()||state)return;event.preventDefault();event.stopPropagation();handle.focus();const row=handle.closest('.person-row');state={handle,row,group:row.dataset.group||null,person:Number(row.dataset.person),source:row.dataset.context||null,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moved:false};handle.setPointerCapture(event.pointerId);});
  document.addEventListener('pointermove',event=>{if(!state||state.pointer!==event.pointerId)return;state.x=event.clientX;state.y=event.clientY;if(!state.moved){if(Math.hypot(state.x-state.startX,state.y-state.startY)<5)return;state.moved=true;document.body.classList.add('row-dragging');state.row.classList.add('row-drag-source');const ghost=document.createElement('div');ghost.className='row-drag-ghost';ghost.textContent=state.row.dataset.name;document.body.append(ghost);state.ghost=ghost;frame=requestAnimationFrame(autoScroll);}event.preventDefault();update();},{passive:false});
  document.addEventListener('pointerup',async event=>{if(!state||state.pointer!==event.pointerId)return;const current=state;if(current.moved)update();const target=current.moved?current.target:null;cancel(false);if(target){try{const before=board(),next=current.group?M.reorderGroup(before,current.group,target.options.target,target.options.after):M.placePerson(before,current.person,target.options);if(JSON.stringify(next)!==JSON.stringify(before))await commit(next,target.label);}catch(error){notify(error.message);}}settled();});
  document.addEventListener('pointercancel',()=>cancel());window.addEventListener('blur',()=>cancel());
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state){event.preventDefault();event.stopImmediatePropagation();cancel();}},true);
  scroll.addEventListener('keydown',async event=>{
    const handle=event.target.closest('.row-drag-handle');if(!handle||!['ArrowUp','ArrowDown'].includes(event.key)||!canStart())return;
    event.preventDefault();event.stopPropagation();const row=handle.closest('.person-row'),person=Number(row.dataset.person),group=row.dataset.context||null,groupId=row.dataset.group,b=board();
    const list=groupId?b.groups.map(g=>g.id):group?b.groups.find(g=>g.id===group).members:b.people.map((_,i)=>i).filter(i=>!b.groups.some(g=>g.members.includes(i)));
    const at=list.indexOf(groupId||person),nextIndex=at+(event.key==='ArrowUp'?-1:1);if(nextIndex<0||nextIndex>=list.length)return;const name=b.people[person];
    try{const next=groupId?M.reorderGroup(b,groupId,list[nextIndex],nextIndex>at):M.placePerson(b,person,{group,target:list[nextIndex],after:nextIndex>at,source:group});await commit(next,'行の順番を変更しました');
      const refreshed=board(),index=refreshed.people.indexOf(name);[...scroll.querySelectorAll('.row-drag-handle')].find(h=>{const r=h.closest('.person-row');return groupId?r.dataset.group===groupId:!r.dataset.group&&Number(r.dataset.person)===index&&(r.dataset.context||null)===group;})?.focus();
    }catch(error){notify(error.message);}
  });
  return {get active(){return state!==null;},cancel};
};

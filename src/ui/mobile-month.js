"use strict";
window.TokiMobileMonth = function (bridge) {
  const H=window.TokiMobileModel,A=window.TokiAvailability,S=window.TokiSchedule;
  const START=480,END=1440,ROW=54;
  const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const clock=range=>A.time(range.start)+'～'+A.time(range.end);
  const viewport=el('section','mob-month'),canvas=el('div','mob-month-canvas');
  viewport.setAttribute('aria-label','月間の予定入力');viewport.hidden=true;viewport.append(canvas);
  const axis=el('div','mob-month-axis'),bottom=el('div','mob-month-bottom');
  axis.append(el('span','mob-month-date','日付'));
  for(let minute=START;minute<END;minute+=30)axis.append(el('span','mob-month-tick',A.time(minute)));
  const dates=new Map(),bands=new WeakMap();
  let person=-1,date='',signature='',rowHeight=ROW,syncFrame=0,jumpDate=null;
  function position(node,range){
    node.style.left=(range.start-START)/(END-START)*100+'%';
    node.style.width=(range.end-range.start)/(END-START)*100+'%';
  }
  function syncLayout(){
    bottom.style.height=Math.max(0,viewport.clientHeight-axis.offsetHeight-rowHeight)+'px';
    const track=dates.get(jumpDate);
    if(track){viewport.scrollTop=track.parentElement.offsetTop-axis.offsetHeight;jumpDate=null;}
  }
  function layout(){
    if(syncFrame)return;
    syncFrame=requestAnimationFrame(()=>{syncFrame=0;if(!viewport.hidden)syncLayout();});
  }
  if(typeof ResizeObserver==='function')new ResizeObserver(layout).observe(viewport);
  window.addEventListener('resize',layout);
  function jump(next){jumpDate=next;layout();}
  function render(ctx,nextPerson){
    viewport.hidden=false;
    if(ctx.date!==date){date=ctx.date;jump(date);}
    person=nextPerson;
    const key=JSON.stringify([ctx.fingerprint,date.slice(0,7),person]);
    if(key===signature){layout();return;}
    signature=key;
    const scroll=[viewport.scrollLeft,viewport.scrollTop],restoreY=!jumpDate;dates.clear();
    canvas.replaceChildren();
    if(person<0){
      canvas.append(el('p','mob-month-empty','入力できる行がありません。'));
      return;
    }
    canvas.append(axis);
    const board=ctx.board,today=bridge.today();
    for(const day of H.monthDates(date)){
      const dayText=A.formatDay(day,[]).slice(0,-1);
      const row=el('div','mob-month-row'),label=el('span','mob-month-date',Number(day.slice(8))+' '+dayText.at(-2));
      label.setAttribute('aria-label',dayText);
      if(day===today)label.setAttribute('aria-current','date');
      const track=el('div','mob-month-track');track.dataset.date=day;
      dates.set(day,track);
      const items=S.personBands(board,person,day).map(range=>({kind:'availability',range}));
      for(const meeting of board.meetings.filter(m=>m.date===day&&m.members.includes(person))){
        items.push({kind:'meeting',range:meeting});
      }
      for(const item of items){
        const {range,kind}=item,button=el('button','mob-month-band');
        if(range.end-range.start<=30){
          button.classList.add('mob-month-short');
          button.append(el('span','',A.time(range.start)),el('span','',A.time(range.end)));
        }else button.textContent=clock(range);
        button.type='button';button.dataset.kind=kind;
        button.setAttribute('aria-haspopup','dialog');
        button.setAttribute('aria-label',A.formatDay(day,[range])+(kind==='meeting'?'のMTGを確認':'の可能時間の操作'));
        if(kind==='meeting')button.style.setProperty('--month-meeting',S.color(range.group,board.groups));
        button.onclick=event=>{if(event.detail===0)openBand(item,day);};
        position(button,range);bands.set(button,item);track.append(button);
      }
      row.append(label,track);canvas.append(row);
    }
    canvas.append(bottom);
    viewport.scrollLeft=scroll[0];
    if(restoreY)viewport.scrollTop=scroll[1];
    syncLayout();
  }
  function openBand(item,day){
    if(item.kind==='meeting')bridge.openMeeting(item.range.id,person);
    else bridge.openAvailability(person,item.range,day);
  }
  function hit(target){
    const track=target.closest?.('.mob-month-track');
    const button=target.closest?.('.mob-month-band');
    return track&&{track,button,item:button&&bands.get(button),person};
  }
  async function save(active,track,to){
    if(!bridge.context().writable||!bridge.canEditRow('p:'+active.person))return;
    const from=active.item?.range,date=active.track.dataset.date,targetDate=track.dataset.date;
    if(from&&date===targetDate&&from.start===to.start&&from.end===to.end)return;
    try{
      const next=H.applyMonthEdit(active.ctx.board,{person:active.person,date,targetDate,from,to});
      await bridge.commit(next,date===targetDate?'可能時間を保存しました':'可能時間をコピーしました',active.ctx.fingerprint);
    }catch(error){bridge.notify(error.message);}
  }
  const timeline=window.TokiTouchTimeline({
    viewport,baseRow:ROW,previewClass:'mob-month-preview',active:()=>person>=0&&!viewport.hidden,instantMouse:bridge.instantMouse,
    hit,context:bridge.context,settled:bridge.settled,
    canEdit:row=>row.item?.kind!=='meeting'&&bridge.canEditRow('p:'+row.person),
    insets:()=>({left:axis.firstChild.offsetWidth,top:axis.offsetHeight}),
    scale(slot,height){
      rowHeight=height;
      viewport.style.setProperty('--month-slot',slot+'px');
      viewport.style.setProperty('--month-row',height+'px');
      syncLayout();
    },
    trackAt(y){return [...dates.values()].find(track=>{const box=track.getBoundingClientRect();return box.top<=y&&y<box.bottom;});},
    openBand:active=>openBand(active.item,active.track.dataset.date),save
  });
  function reset(){timeline.reset();signature='';person=-1;date='';jumpDate=null;dates.clear();canvas.replaceChildren();viewport.scrollLeft=0;viewport.scrollTop=0;viewport.hidden=true;}
  return {node:viewport,render,jump,reset,cancel:timeline.cancel,get interacting(){return timeline.interacting;}};
};

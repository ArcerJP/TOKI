"use strict";
window.TokiMobileMonth = function (bridge) {
  const H=window.TokiMobileModel,A=window.TokiAvailability,S=window.TokiSchedule;
  const START=480,END=1440,ROW=54,SLOT=44,HOLD=450,SLOP=8;
  const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const snap=value=>Math.round(value/30)*30;
  const firstSlot=value=>clamp(Math.floor(value/30)*30,START,END-30);
  const clock=range=>A.time(range.start)+'～'+A.time(range.end);
  const viewport=el('section','mob-month'),canvas=el('div','mob-month-canvas');
  viewport.setAttribute('aria-label','月間の予定入力');viewport.hidden=true;viewport.append(canvas);
  const axis=el('div','mob-month-axis'),bottom=el('div','mob-month-bottom');
  axis.append(el('span','mob-month-date','日付'));
  for(let minute=START;minute<END;minute+=30)axis.append(el('span','mob-month-tick',A.time(minute)));
  const dates=new Map(),bands=new WeakMap(),preview=el('div','mob-month-preview');
  let person=-1,date='',signature='',scale=1,slot=SLOT,rowHeight=ROW,gesture=null,pinch=null,waitForFingers=false;
  let frame=0,syncFrame=0,jumpDate=null,touchActive=false;

  function setScale(next){
    scale=clamp(next,.55,2.5);slot=SLOT*scale;rowHeight=Math.max(44,ROW*scale);
    viewport.style.setProperty('--month-slot',slot+'px');
    viewport.style.setProperty('--month-row',rowHeight+'px');
  }
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
      const row=el('div','mob-month-row'),label=el('button','mob-month-date',Number(day.slice(8))+' '+dayText.at(-2));
      label.type='button';label.setAttribute('aria-label',dayText+'の時間を編集');
      label.onclick=()=>bridge.openEditor('p:'+person,null,day);
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
    return track&&{track,button,item:button&&bands.get(button)};
  }
  const minuteAt=(track,x)=>START+(x-track.getBoundingClientRect().left)/slot*30;
  function begin(target,point,id){
    const start=hit(target);if(!start)return;
    const ctx=bridge.context(),origin=minuteAt(start.track,point.clientX),item=start.item;
    let operation=item?'move':'create';
    if(item?.kind==='availability'){
      const rect=start.button.getBoundingClientRect(),edge=Math.min(14,rect.width/3);
      if(point.clientX-rect.left<edge)operation='start';
      else if(rect.right-point.clientX<edge)operation='end';
    }
    gesture={...start,point,x:point.clientX,y:point.clientY,origin,operation,ctx,person,id,phase:'pending',timer:0};
    const active=gesture;
    if(ctx.writable&&item?.kind!=='meeting'&&bridge.canEditRow('p:'+person)){
      active.timer=setTimeout(()=>{
        if(gesture!==active||!bridge.context().writable)return;
        active.phase='held';active.button?.setAttribute('data-month-source','');paint(active);
      },HOLD);
    }
  }
  function moveTo(active){
    const bounds=viewport.getBoundingClientRect();
    const x=clamp(active.point.clientX,bounds.left+axis.firstChild.offsetWidth,bounds.right);
    const cursor=minuteAt(active.track,x),source=active.item?.range;
    let track=active.track,to;
    if(active.operation==='create'){
      const first=firstSlot(active.origin),last=firstSlot(cursor);
      to={start:Math.min(first,last),end:Math.max(first,last)+30};
    }else if(active.operation==='move'){
      const duration=source.end-source.start,start=clamp(source.start+snap(cursor-active.origin),START,END-duration);
      to={start,end:start+duration};
      const y=clamp(active.point.clientY,axis.getBoundingClientRect().bottom,bounds.bottom-1);
      track=Array.from(dates.values()).find(node=>{const r=node.getBoundingClientRect();return r.top<=y&&y<r.bottom;});
    }else if(active.operation==='start')to={start:clamp(snap(cursor),START,source.end),end:source.end};
    else to={start:source.start,end:clamp(snap(cursor),source.start,END)};
    return {track,to};
  }
  function paint(active){
    const {track,to}=moveTo(active);
    if(!track){preview.remove();return;}
    position(preview,to);preview.textContent=to.start===to.end?'削除':clock(to);
    track.append(preview);
  }
  function stop(){
    if(gesture){clearTimeout(gesture.timer);gesture.button?.removeAttribute('data-month-source');}
    gesture=null;preview.remove();cancelAnimationFrame(frame);frame=0;
  }
  function edgeSpeed(position,start,end){
    if(position<start+28)return -Math.min(18,(start+28-position)*.65);
    if(position>end-28)return Math.min(18,(position-end+28)*.65);
    return 0;
  }
  function autoScroll(now){
    frame=0;
    if(gesture?.phase!=='held'||!gesture.moved)return;
    const {point,operation}=gesture,bounds=viewport.getBoundingClientRect();
    const horizontal=edgeSpeed(point.clientX,bounds.left+axis.firstChild.offsetWidth,bounds.right);
    const vertical=operation==='move'?edgeSpeed(point.clientY,axis.getBoundingClientRect().bottom,bounds.bottom):0;
    if(!horizontal&&!vertical){gesture.edge=null;return;}
    const direction=Math.sign(horizontal)+':'+Math.sign(vertical);
    if(gesture.edge?.direction!==direction)gesture.edge={direction,since:now};
    if(now-gesture.edge.since<220){frame=requestAnimationFrame(autoScroll);return;}
    const left=viewport.scrollLeft,top=viewport.scrollTop;
    viewport.scrollLeft+=horizontal;viewport.scrollTop+=vertical;
    if(viewport.scrollLeft===left&&viewport.scrollTop===top)return;
    paint(gesture);frame=requestAnimationFrame(autoScroll);
  }
  function update(point){
    const active=gesture;if(!active)return false;
    active.point=point;
    if(Math.hypot(point.clientX-active.x,point.clientY-active.y)<SLOP&&!active.moved)return active.phase==='held';
    if(active.phase==='pending'){clearTimeout(active.timer);active.phase='scroll';}
    if(active.phase!=='held')return false;
    active.moved=true;paint(active);if(!frame)frame=requestAnimationFrame(autoScroll);
    return true;
  }
  async function save(active,track,to){
    if(!bridge.context().writable||!bridge.canEditRow('p:'+active.person))return;
    const from=active.item?.range,date=active.track.dataset.date,targetDate=track.dataset.date;
    if(from&&date===targetDate&&from.start===to.start&&from.end===to.end)return;
    try{
      const next=H.applyMonthEdit(active.ctx.board,{person:active.person,date,targetDate,from,to});
      await bridge.commit(next,'可能時間を保存しました',active.ctx.fingerprint);
    }catch(error){bridge.notify(error.message);}
  }
  function finish(point){
    const active=gesture;if(!active)return false;
    update(point);stop();
    if(active.phase==='held'&&active.moved){const {track,to}=moveTo(active);if(track)void save(active,track,to);}
    else if(!active.item&&(active.phase==='pending'||active.phase==='held')){
      const start=firstSlot(active.origin);
      void save(active,active.track,{start,end:start+30});
    }else if(active.phase==='pending')openBand(active.item,active.track.dataset.date);
    bridge.settled();
    return active.phase!=='scroll';
  }
  const midpoint=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2,distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)});
  function startPinch(touches){
    stop();waitForFingers=true;
    const mid=midpoint(...Array.from(touches).slice(0,2)),bounds=viewport.getBoundingClientRect();
    pinch={distance:Math.max(1,mid.distance),scale,
      time:(viewport.scrollLeft+mid.x-bounds.left-axis.firstChild.offsetWidth)/slot,
      row:(viewport.scrollTop+mid.y-bounds.top-axis.offsetHeight)/rowHeight};
  }
  function updatePinch(touches){
    const mid=midpoint(...Array.from(touches).slice(0,2)),bounds=viewport.getBoundingClientRect();
    setScale(pinch.scale*mid.distance/pinch.distance);syncLayout();
    viewport.scrollLeft=pinch.time*slot+axis.firstChild.offsetWidth-mid.x+bounds.left;
    viewport.scrollTop=pinch.row*rowHeight+axis.offsetHeight-mid.y+bounds.top;
  }
  const nonPassive={passive:false};
  viewport.addEventListener('touchstart',event=>{
    if(person<0)return;
    touchActive=true;
    if(event.touches.length===2){startPinch(event.touches);if(event.cancelable)event.preventDefault();}
    else if(event.touches.length>2){stop();pinch=null;waitForFingers=true;}
    else if(!waitForFingers)begin(event.target,event.touches[0],event.touches[0].identifier);
  },nonPassive);
  viewport.addEventListener('touchmove',event=>{
    if(waitForFingers){if(event.cancelable){event.preventDefault();if(pinch&&event.touches.length===2)updatePinch(event.touches);}return;}
    if(gesture?.phase==='held'&&!event.cancelable){stop();bridge.settled();return;}
    const point=Array.from(event.touches).find(point=>point.identifier===gesture?.id);
    if(point&&update(point)&&event.cancelable)event.preventDefault();
  },nonPassive);
  function endTouch(event){
    if(waitForFingers){if(event.cancelable)event.preventDefault();if(event.touches.length>=2)return;pinch=null;}
    else{
      const point=Array.from(event.changedTouches).find(point=>point.identifier===gesture?.id);
      if(point&&finish(point)&&event.cancelable)event.preventDefault();
    }
    if(!event.touches.length){touchActive=false;waitForFingers=false;bridge.settled();}
  }
  viewport.addEventListener('touchend',endTouch,nonPassive);
  function cancel(){stop();pinch=null;touchActive=false;waitForFingers=false;bridge.settled();}
  viewport.addEventListener('touchcancel',cancel);
  document.addEventListener('touchstart',event=>{
    if(touchActive&&event.touches.length>1&&!viewport.contains(event.target))cancel();
  },{passive:true});
  viewport.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch'||event.button!==0||touchActive)return;
    begin(event.target,event,event.pointerId);
    if(gesture)viewport.setPointerCapture?.(event.pointerId);
  });
  viewport.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'&&gesture?.id===event.pointerId)update(event);});
  viewport.addEventListener('pointerup',event=>{if(event.pointerType!=='touch'&&gesture?.id===event.pointerId)finish(event);});
  viewport.addEventListener('pointercancel',event=>{if(event.pointerType!=='touch')cancel();});
  viewport.addEventListener('contextmenu',event=>{if(hit(event.target))event.preventDefault();});
  viewport.addEventListener('scroll',()=>{if(gesture?.phase==='pending'){clearTimeout(gesture.timer);gesture.phase='scroll';}});
  window.addEventListener('blur',cancel);
  window.addEventListener('orientationchange',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  function reset(){cancel();signature='';person=-1;date='';jumpDate=null;dates.clear();canvas.replaceChildren();viewport.scrollLeft=0;viewport.scrollTop=0;setScale(1);viewport.hidden=true;}
  return {node:viewport,render,jump,reset,cancel,get interacting(){return Boolean(gesture||touchActive||pinch);}};
};

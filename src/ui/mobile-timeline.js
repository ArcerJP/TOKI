"use strict";
window.TokiTouchTimeline = function (timeline) {
  const START=480,END=1440,SLOT=44,HOLD=450,SLOP=8;
  const {viewport,baseRow,previewClass}=timeline,A=window.TokiAvailability;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const snap=value=>Math.round(value/30)*30;
  const firstSlot=value=>clamp(Math.floor(value/30)*30,START,END-30);
  const clock=range=>A.time(range.start)+'～'+A.time(range.end);
  const preview=document.createElement('div');preview.className=previewClass;
  let scale=1,slot=SLOT,rowHeight=baseRow,gesture=null,pinch=null,waitForFingers=false,touchActive=false,frame=0;
  function setScale(next){
    scale=clamp(next,.55,2.5);slot=SLOT*scale;rowHeight=Math.max(44,baseRow*scale);
    timeline.scale(slot,rowHeight);
  }
  function position(node,range){
    node.style.left=(range.start-START)/(END-START)*100+'%';
    node.style.width=(range.end-range.start)/(END-START)*100+'%';
  }
  const minuteAt=(track,x)=>START+(x-track.getBoundingClientRect().left)/slot*30;
  function begin(target,point,id,instant=false){
    const start=timeline.hit(target);if(!start)return;
    const ctx=timeline.context(),origin=minuteAt(start.track,point.clientX),item=start.item;
    let operation=item&&item.kind!=='common'?'move':'create';
    if(operation==='move'&&start.button){
      const rect=start.button.getBoundingClientRect(),edge=Math.min(14,rect.width/3);
      if(point.clientX-rect.left<edge)operation='start';
      else if(rect.right-point.clientX<edge)operation='end';
    }
    gesture={...start,point,x:point.clientX,y:point.clientY,origin,operation,ctx,id,phase:'pending',timer:0};
    const active=gesture;
    if(ctx.writable&&timeline.canEdit(start)){
      if(instant)active.instant=true;
      else active.timer=setTimeout(()=>{
        if(gesture!==active||!timeline.context().writable)return;
        active.phase='held';active.button?.setAttribute('data-timeline-source','');paint(active);
      },HOLD);
    }
  }
  function moveTo(active){
    const bounds=viewport.getBoundingClientRect();
    const x=clamp(active.point.clientX,bounds.left+timeline.insets().left,bounds.right);
    const cursor=minuteAt(active.track,x),source=active.item?.range;
    let track=active.track,to;
    if(active.operation==='create'){
      const first=firstSlot(active.origin),last=firstSlot(cursor);
      to={start:Math.min(first,last),end:Math.max(first,last)+30};
    }else if(active.operation==='move'){
      const duration=source.end-source.start,start=clamp(source.start+snap(cursor-active.origin),START,END-duration);
      to={start,end:start+duration};
      if(timeline.trackAt){
        const y=clamp(active.point.clientY,bounds.top+timeline.insets().top,bounds.bottom-1);
        track=timeline.trackAt(y);
      }
    }else if(active.operation==='start')to={start:clamp(snap(cursor),START,source.end),end:source.end};
    else to={start:source.start,end:clamp(snap(cursor),source.start,END)};
    return {track,to};
  }
  function paint(active){
    const {track,to}=moveTo(active);
    if(!track){preview.remove();return;}
    const label=track===active.track?'':'コピー ';
    position(preview,to);preview.textContent=to.start===to.end?'削除':label+clock(to);
    track.append(preview);
  }
  function stop(){
    if(gesture){clearTimeout(gesture.timer);gesture.button?.removeAttribute('data-timeline-source');}
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
    const horizontal=edgeSpeed(point.clientX,bounds.left+timeline.insets().left,bounds.right);
    const vertical=operation==='move'&&timeline.trackAt?edgeSpeed(point.clientY,bounds.top+timeline.insets().top,bounds.bottom):0;
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
    if(active.phase==='pending'){
      clearTimeout(active.timer);
      active.phase=active.instant&&timeline.context().writable?'held':'scroll';
      if(active.phase==='held')active.button?.setAttribute('data-timeline-source','');
    }
    if(active.phase!=='held')return false;
    active.moved=true;paint(active);if(!frame)frame=requestAnimationFrame(autoScroll);
    return true;
  }
  function finish(point){
    const active=gesture;if(!active)return false;
    update(point);stop();
    if(active.phase==='held'&&active.moved){const {track,to}=moveTo(active);if(track)void timeline.save(active,track,to);}
    else if(active.operation==='create'&&(active.phase==='pending'||active.phase==='held')){
      const start=firstSlot(active.origin);
      void timeline.save(active,active.track,{start,end:start+30});
    }else if(active.phase==='pending')timeline.openBand(active);
    timeline.settled();
    return active.phase!=='scroll';
  }
  const midpoint=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2,distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)});
  function startPinch(touches){
    stop();waitForFingers=true;
    const mid=midpoint(...Array.from(touches).slice(0,2)),bounds=viewport.getBoundingClientRect();
    pinch={distance:Math.max(1,mid.distance),scale,
      time:(viewport.scrollLeft+mid.x-bounds.left-timeline.insets().left)/slot,
      row:(viewport.scrollTop+mid.y-bounds.top-timeline.insets().top)/rowHeight};
  }
  function updatePinch(touches){
    const mid=midpoint(...Array.from(touches).slice(0,2)),bounds=viewport.getBoundingClientRect();
    setScale(pinch.scale*mid.distance/pinch.distance);
    viewport.scrollLeft=pinch.time*slot+timeline.insets().left-mid.x+bounds.left;
    viewport.scrollTop=pinch.row*rowHeight+timeline.insets().top-mid.y+bounds.top;
  }
  const nonPassive={passive:false};
  viewport.addEventListener('touchstart',event=>{
    if(!timeline.active())return;
    touchActive=true;
    if(event.touches.length===2){startPinch(event.touches);if(event.cancelable)event.preventDefault();}
    else if(event.touches.length>2){stop();pinch=null;waitForFingers=true;}
    else if(!waitForFingers)begin(event.target,event.touches[0],event.touches[0].identifier);
  },nonPassive);
  viewport.addEventListener('touchmove',event=>{
    if(waitForFingers){if(event.cancelable){event.preventDefault();if(pinch&&event.touches.length===2)updatePinch(event.touches);}return;}
    if(gesture?.phase==='held'&&!event.cancelable){stop();timeline.settled();return;}
    const point=Array.from(event.touches).find(point=>point.identifier===gesture?.id);
    if(point&&update(point)&&event.cancelable)event.preventDefault();
  },nonPassive);
  function endTouch(event){
    if(waitForFingers){if(event.cancelable)event.preventDefault();if(event.touches.length>=2)return;pinch=null;}
    else{
      const point=Array.from(event.changedTouches).find(point=>point.identifier===gesture?.id);
      if(point&&finish(point)&&event.cancelable)event.preventDefault();
    }
    if(!event.touches.length){touchActive=false;waitForFingers=false;timeline.settled();}
  }
  viewport.addEventListener('touchend',endTouch,nonPassive);
  function cancel(){stop();pinch=null;touchActive=false;waitForFingers=false;timeline.settled();}
  viewport.addEventListener('touchcancel',cancel);
  document.addEventListener('touchstart',event=>{
    if(touchActive&&event.touches.length>1&&!viewport.contains(event.target))cancel();
  },{passive:true});
  viewport.addEventListener('pointerdown',event=>{
    if(!timeline.active()||event.pointerType==='touch'||event.button!==0||touchActive)return;
    begin(event.target,event,event.pointerId,timeline.instantMouse&&event.pointerType==='mouse');
    if(gesture)viewport.setPointerCapture?.(event.pointerId);
  });
  viewport.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'&&gesture?.id===event.pointerId)update(event);});
  viewport.addEventListener('pointerup',event=>{if(event.pointerType!=='touch'&&gesture?.id===event.pointerId)finish(event);});
  viewport.addEventListener('pointercancel',event=>{if(event.pointerType!=='touch')cancel();});
  viewport.addEventListener('contextmenu',event=>{if(timeline.hit(event.target))event.preventDefault();});
  viewport.addEventListener('scroll',()=>{if(gesture?.phase==='pending'){clearTimeout(gesture.timer);gesture.phase='scroll';}});
  window.addEventListener('blur',cancel);
  window.addEventListener('orientationchange',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  return {cancel,reset(){cancel();setScale(1);},get interacting(){return Boolean(gesture||touchActive||pinch);}};
};

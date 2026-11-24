"use strict";
// Mobile commands use the same schedule operations as the desktop chart.
(() => {
  const node=typeof module!=='undefined'&&module.exports;
  const M=node?require('./model.js'):window.TokiModel;
  const A=node?require('./availability.js'):window.TokiAvailability;
  const S=node?require('./schedule.js'):window.TokiSchedule;
  function rows(board,hidden=[],collapsed=new Set()) {
    const hiddenSet=new Set(hidden);
    return M.rows(board,collapsed).filter(row=>row.group?!hiddenSet.has(row.group.id):!row.context||!hiddenSet.has(row.context));
  }
  function apply(board,op) {
    if(!M.validDate(op.date))throw Error('日付を確認してください。');
    if(op.kind==='release')return S.release(board,op.id,op.person===null?{}:{person:op.person});
    const {start,end}=op.to;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<480||end>1440||start>end)throw Error('8:00〜24:00の範囲で指定してください。');
    const added=start<end?[{start,end}]:[];
    if(op.kind==='meeting')return S.adjustMeeting(board,op.id,{start,end});
    if(op.kind==='reserve') {
      if(!added.length)throw Error('MTGの時間を選択してください。');
      if(A.subtract(added,S.ranges(board,'g:'+op.group,op.date,op.excluded)).length)throw Error('⚠️可能時間がありません');
      return S.reserve(board,op.group,op.date,added,op.excluded);
    }
    if(op.kind==='common') {
      if(start<op.from.start||end>op.from.end)throw Error('共通の可能時間は短縮のみできます。');
      const removed=A.subtract([op.from],added);
      if(!removed.length)throw Error('変更する時間を指定してください。');
      return S.reserve(board,op.group,op.date,removed,op.excluded);
    }
    if(op.kind!=='person')throw Error('操作を確認してください。');
    if(!op.from&&!added.length)throw Error('可能時間を選択してください。');
    if(op.target!==undefined&&op.target!==op.person&&op.from&&added.length)return S.movePersonRange(board,op.person,op.target,op.date,op.from,added[0]);
    return S.editPerson(board,op.person,op.date,op.from?[op.from]:[],added);
  }
  function move(range,mode,origin,cursor) {
    return S.meetingDragRange(range,mode,origin,cursor);
  }
  function monthDates(date){
    const month=new Date(date.slice(0,7)+'-01T00:00:00Z');
    const end=new Date(month);end.setUTCMonth(end.getUTCMonth()+1,0);
    return Array.from({length:end.getUTCDate()},(_,index)=>date.slice(0,7)+'-'+String(index+1).padStart(2,'0')).filter(M.validDate);
  }
  function shiftMonth(date,offset){
    const month=new Date(date.slice(0,7)+'-01T00:00:00Z');
    month.setUTCMonth(month.getUTCMonth()+offset);
    const next=month.toISOString().slice(0,7);
    if(next<M.MIN_DATE.slice(0,7)||next>M.MAX_DATE.slice(0,7))return null;
    const days=monthDates(next+'-01');
    return days.find(day=>day.slice(8)>=date.slice(8))||days.at(-1)||null;
  }
  function applyMonthEdit(board,{person,date,targetDate=date,from,to}){
    if(date!==targetDate&&(!from||to.end-to.start!==from.end-from.start))throw Error('日をまたぐ移動では時間帯の長さを維持してください。');
    if(from&&!S.personBands(board,person,date).some(range=>range.start===from.start&&range.end===from.end))throw Error('最新の時間帯から操作してください。');
    if(to.start<to.end&&A.intersect([to],board.meetings.filter(m=>m.date===targetDate&&m.members.includes(person))).length)throw Error('⚠ 登録済みのMTGと重なります。');
    if(date===targetDate)return apply(board,{kind:'person',person,date,from,to});
    const removed=S.editPerson(board,person,date,[from],[]);
    return apply(removed,{kind:'person',person,date:targetDate,to});
  }
  const api={rows,apply,move,monthDates,shiftMonth,applyMonthEdit};
  if(node)module.exports=api;else window.TokiMobileModel=api;
})();

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
  function entryRows(board,canEdit){
    return board.people.flatMap((name,person)=>canEdit(person)
      ?[{name,person,key:board.rows?.[person]?.id??name}]:[]);
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
    if(!M.validDate(date)||!M.validDate(targetDate))throw Error('日付を確認してください。');
    const {start,end}=to;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<480||end>1440||start>end)throw Error('8:00〜24:00の範囲で指定してください。');
    if(date!==targetDate&&(!from||end-start!==from.end-from.start))throw Error('日をまたぐコピーでは時間帯の長さを維持してください。');
    if(from&&!S.personBands(board,person,date).some(range=>range.start===from.start&&range.end===from.end))throw Error('最新の時間帯から操作してください。');
    const added=start<end?[{start,end}]:[];
    if(!from&&!added.length)throw Error('可能時間を選択してください。');
    if(added.length&&A.intersect(added,board.meetings.filter(m=>m.date===targetDate&&m.members.includes(person))).length)throw Error('⚠ 登録済みのMTGと重なります。');
    return S.editPerson(board,person,targetDate,date===targetDate&&from?[from]:[],added);
  }
  const api={rows,entryRows,monthDates,shiftMonth,applyMonthEdit};
  if(node)module.exports=api;else window.TokiMobileModel=api;
})();

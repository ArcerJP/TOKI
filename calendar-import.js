"use strict";
// Date/interval calculations only. Google event titles and descriptions are never used.
(() => {
  const MINUTE=60000, DAY=1440*MINUTE, JST=540*MINUTE;
  const local=ms=>new Date(ms+JST).toISOString().slice(0,16);
  const midnight=date=>Date.parse(date+'T00:00:00+09:00');
  function parseInput(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('開始・終了を年月日と時刻で入力してください。');
    const ms=Date.parse(value+':00+09:00');
    if(!Number.isFinite(ms)||local(ms)!==value)throw Error('存在する日付と時刻を入力してください。');
    return ms;
  }
  function period(start,end){
    const timeMin=parseInput(start),timeMax=parseInput(end);
    if(timeMax<=timeMin)throw Error('終了は開始より後にしてください。');
    if(timeMax-timeMin>366*DAY)throw Error('一度に取得できる期間は366日以内です。');
    const first=local(timeMin).slice(0,10),last=local(timeMax-1).slice(0,10);
    if(!window.TokiModel.validDate(first)||!window.TokiModel.validDate(last))throw Error('予定表で扱える範囲の日付を入力してください。');
    return {timeMin,timeMax,first,last,start:start+':00+09:00',end:end+':00+09:00'};
  }
  function timestamp(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw Error('Googleから取得した時間帯を確認できませんでした。');
    const ms=Date.parse(value);
    const wall=Date.parse(value.slice(0,19)+'Z');
    if(!Number.isFinite(ms)||!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,19)!==value.slice(0,19))throw Error('Googleから取得した時間帯を確認できませんでした。');
    return ms;
  }
  function readBusy(response,range){
    if(!response||timestamp(response.timeMin)!==range.timeMin||timestamp(response.timeMax)!==range.timeMax)throw Error('取得期間を確認できませんでした。もう一度取得してください。');
    // Only one calendar was requested; its identifier is not needed for availability.
    const calendars=response.calendars&&typeof response.calendars==='object'?Object.values(response.calendars):[];
    const calendar=calendars.length===1?calendars[0]:null;
    if(!calendar||calendar.errors!==undefined&&(!Array.isArray(calendar.errors)||calendar.errors.length)||!Array.isArray(calendar.busy))throw Error('メインカレンダーの予定あり／なしを取得できませんでした。権限を確認して再取得してください。');
    return calendar.busy.map(interval=>{
      const start=timestamp(interval?.start),end=timestamp(interval?.end);
      if(end<=start)throw Error('Googleから取得した時間帯が正しくありません。');
      return {start,end};
    });
  }
  function availability(range,busy){
    if(!Array.isArray(busy)||busy.some(b=>!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.end<=b.start))throw Error('予定の時間帯が正しくありません。');
    const intervals=busy.filter(b=>b.end>range.timeMin&&b.start<range.timeMax).map(b=>({...b})).sort((a,b)=>a.start-b.start);
    const merged=[];
    for(const b of intervals){const last=merged.at(-1);if(last&&b.start<=last.end)last.end=Math.max(last.end,b.end);else merged.push(b);}
    const ranges=[];let at=0;
    for(let day=midnight(range.first);day<range.timeMax;day+=DAY){
      const date=local(day).slice(0,10);
      for(let minute=480;minute<1440;minute+=30){
        const start=day+minute*MINUTE,end=start+30*MINUTE;
        if(start<range.timeMin||end>range.timeMax)continue;
        while(at<merged.length&&merged[at].end<=start)at++;
        if(merged[at]&&merged[at].start<end)continue;
        const previous=ranges.at(-1);
        if(previous?.date===date&&previous.end===minute)previous.end=minute+30;
        else ranges.push({date,start:minute,end:minute+30});
      }
    }
    return ranges;
  }
  function plan(board,person,range,busy,makeId=()=>`google-${crypto.randomUUID()}`){
    const M=window.TokiModel;
    if(!M.valid(board)||!Number.isInteger(person)||!board.people[person])throw Error('取り込み先の人を選択してください。');
    const next=M.clone(board),rawRanges=availability(range,busy),events=[];let affected=0;
    const ranges=board.schemaVersion===4?rawRanges.flatMap(slot=>window.TokiAvailability.subtract([slot],board.meetings.filter(m=>m.date===slot.date&&m.members.includes(person))).map(r=>({...r,date:slot.date}))):rawRanges;
    for(const event of next.events){
      const day=midnight(event.date),start=day+event.start*MINUTE,end=day+event.end*MINUTE;
      if(event.person!==person||end<=range.timeMin||start>=range.timeMax){events.push(event);continue;}
      affected++;
      const left=start<range.timeMin,right=end>range.timeMax;
      if(left)events.push({...event,end:(range.timeMin-day)/MINUTE});
      if(right)events.push({...event,id:left?makeId():event.id,start:(range.timeMax-day)/MINUTE});
    }
    for(const slot of ranges)events.push({id:makeId(),person,...slot,...(board.schemaVersion===4?{}:{title:'可能時間',detail:''})});
    next.events=events;
    if(events.length>2000)throw Error('予定の上限（全員合計2000件）を超えます。取得期間を短くしてください。');
    if(!M.valid(next))throw Error('取り込み後の予定を確認できません。期間を見直してください。');
    return {board:next,ranges,affected,person,personName:board.people[person],range};
  }
  window.TokiCalendarImport={period,readBusy,availability,plan};
})();

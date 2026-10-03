"use strict";
// Time arithmetic for availability, shared by group calculations and text export.
(() => {
  function merge(ranges) {
    const sorted=ranges.map(({start,end})=>{
      if(!Number.isInteger(start)||!Number.isInteger(end)||start<480||end>1440||end<=start)throw Error('可能時間は8:00〜24:00の範囲で指定してください。');
      return {start,end};
    }).sort((a,b)=>a.start-b.start||a.end-b.end);
    const result=[];
    for(const range of sorted){const last=result.at(-1);if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else result.push(range);}
    return result;
  }
  function intersect(left,right){
    const a=merge(left),b=merge(right),result=[];let i=0,j=0;
    while(i<a.length&&j<b.length){
      const start=Math.max(a[i].start,b[j].start),end=Math.min(a[i].end,b[j].end);
      if(start<end)result.push({start,end});
      if(a[i].end<b[j].end)i++;else j++;
    }
    return result;
  }
  function common(lists){return lists.length?lists.slice(1).reduce(intersect,merge(lists[0])):[];}
  function subtract(ranges,removed){
    const source=merge(ranges),cuts=merge(removed),result=[];
    let at=0;
    for(const range of source){
      let start=range.start;
      while(at<cuts.length&&cuts[at].end<=start)at++;
      for(let i=at;i<cuts.length&&cuts[i].start<range.end;i++){
        if(cuts[i].start>start)result.push({start,end:Math.min(cuts[i].start,range.end)});
        start=Math.max(start,cuts[i].end);
        if(start>=range.end)break;
      }
      if(start<range.end)result.push({start,end:range.end});
    }
    return result;
  }
  const time=minute=>`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
  function formatDay(date,ranges){
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日付を確認してください。');
    const d=new Date(date+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('日付を確認してください。');
    return `${d.getUTCMonth()+1}月${d.getUTCDate()}日(${'日月火水木金土'[d.getUTCDay()]})：${merge(ranges).map(r=>`${time(r.start)}～${time(r.end)}`).join(', ')}`;
  }
  const api={merge,intersect,common,subtract,time,formatDay};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.TokiAvailability=api;
})();

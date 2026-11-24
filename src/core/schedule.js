"use strict";
(() => {
  const node=typeof module!=='undefined'&&module.exports;
  const M=node?require('./model.js'):window.TokiModel,A=node?require('./availability.js'):window.TokiAvailability;
  const id=()=>`slot-${crypto.randomUUID()}`;
  function check(board){if(!M.valid(board)||board.schemaVersion!==4)throw Error('可能時間のデータを確認してください。');return board;}
  function migrate(board){
    if(board.schemaVersion===4)return check(M.clone(board));
    const legacy=M.upgrade(board);if(!M.valid(legacy))throw Error('以前の予定データを確認できません。');
    return check({schemaVersion:4,people:legacy.people,groups:legacy.groups,events:legacy.events.filter(e=>e.person!==undefined).map(({id,person,date,start,end})=>({id,person,date,start,end})),meetings:[]});
  }
  function participants(board,group,excluded=[]){const g=board.groups.find(g=>g.id===group);if(!g)throw Error('グループが見つかりません。');return g.members.filter(p=>!excluded.includes(board.people[p]));}
  const meetingsFor=(board,person,date)=>board.meetings.filter(m=>m.date===date&&m.members.includes(person));
  const personEvents=(board,person,date)=>board.events.filter(e=>e.person===person&&e.date===date);
  function personRanges(board,person,date){return A.subtract(personEvents(board,person,date),meetingsFor(board,person,date));}
  function splitBoundaries(events){
    const starts=new Set(events.map(event=>event.start));
    return events.map(event=>event.end).filter(end=>starts.has(end)&&!events.some(event=>event.start<end&&end<event.end));
  }
  function divideAt(ranges,boundaries){
    if(!boundaries.length)return ranges;
    const cuts=[...new Set(boundaries)].sort((a,b)=>a-b);
    return ranges.flatMap(({start,end})=>{
      const points=[start,...cuts.filter(cut=>start<cut&&cut<end),end];
      return points.slice(1).map((end,i)=>({start:points[i],end}));
    });
  }
  function personBands(board,person,date){
    return divideAt(personRanges(board,person,date),splitBoundaries(personEvents(board,person,date)));
  }
  function ranges(board,key,date,excluded=[]){
    if(key.startsWith('g:'))return A.common(participants(board,key.slice(2),excluded).map(p=>personRanges(board,p,date)));
    const person=Number(key.slice(2));if(!Number.isInteger(person)||!board.people[person])throw Error('人を選択してください。');
    return personBands(board,person,date);
  }
  function bulkExclusions(board,group,date,modes,manual=[]){
    const people=group.members.filter(person=>board.rows?.[person]?.kind!=='place');
    if(modes.has('all'))return people.map(person=>board.people[person]);
    const daily=new Map(group.members.map(person=>[person,personRanges(board,person,date)]));
    const excluded=new Set(modes.has('unavailable')?people.filter(person=>!daily.get(person).length):[]);
    const fewest=modes.has('least');
    if(fewest||modes.has('most')){
      const places=group.members.filter(person=>board.rows?.[person]?.kind==='place'&&!manual.includes(board.people[person]));
      const eligible=people.filter(person=>!manual.includes(board.people[person]));
      const boundaries=[...new Set([...daily.values()].flatMap(ranges=>ranges.flatMap(range=>[range.start,range.end])))].sort((a,b)=>a-b);
      const covers=(person,start,end)=>daily.get(person).some(range=>range.start<=start&&range.end>=end);
      let count=null,matching=new Set();
      for(let i=0;i<boundaries.length-1;i++){
        const start=boundaries[i],end=boundaries[i+1];
        if(!places.every(person=>covers(person,start,end)))continue;
        const available=eligible.filter(person=>covers(person,start,end));
        if(!available.length)continue;
        if(count===null||(fewest?available.length<count:available.length>count)){count=available.length;matching=new Set();}
        if(available.length===count)available.forEach(person=>matching.add(person));
      }
      if(count!==null)eligible.filter(person=>!matching.has(person)).forEach(person=>excluded.add(person));
    }
    return [...excluded].map(person=>board.people[person]);
  }
  function writePerson(board,person,date,values,makeId=id,extraCuts=[]){
    if(!Number.isInteger(person)||!board.people[person]||!M.validDate(date))throw Error('人と日付を確認してください。');
    const cuts=[...splitBoundaries(personEvents(board,person,date)),...extraCuts];
    board.events=board.events.filter(e=>e.person!==person||e.date!==date);
    for(const range of divideAt(A.subtract(values,meetingsFor(board,person,date)),cuts))board.events.push({id:makeId(),person,date,...range});
  }
  function editPerson(board,person,date,removed=[],added=[],makeId=id){
    const next=M.clone(board);writePerson(next,person,date,[...A.subtract(personRanges(next,person,date),removed),...added],makeId);return check(next);
  }
  const sameTime=(left,right)=>left.start===right.start&&left.end===right.end;
  function splitPerson(board,person,date,range,minute,makeId=id){
    if(!Number.isInteger(minute)||minute%30||minute<=range.start||minute>=range.end||
      !personBands(board,person,date).some(band=>sameTime(band,range)))throw Error('可能時間の内側にある30分の境界を指定してください。');
    const next=M.clone(board);
    writePerson(next,person,date,personRanges(next,person,date),makeId,[minute]);
    return check(next);
  }
  function meetingSelection(common,origin,cursor=origin){
    const anchor=Math.floor(origin/30)*30,boundary=Math.round(cursor/30)*30;
    const start=Math.min(anchor,boundary),end=Math.max(anchor+30,boundary);
    // Reject out-of-range selections rather than silently clipping a reservation.
    if(!Number.isFinite(origin)||!Number.isFinite(cursor)||origin<common.start||origin>=common.end||cursor<common.start||cursor>common.end||start<common.start||end>common.end)throw Error('⚠️可能時間がありません');
    return {start,end};
  }
  function addMeeting(board,group,date,range,members,makeId){
    board.meetings.push({id:makeId(),group,date,start:range.start,end:range.end,members:[...members]});
    for(const person of members)writePerson(board,person,date,personRanges(board,person,date),makeId);
  }
  function reserve(board,group,date,removed,excluded=[],makeId=id){
    const next=M.clone(board),members=participants(next,group,excluded),available=ranges(next,`g:${group}`,date,excluded);
    if(!members.length)throw Error('対象のメンバーがいません。');
    if(A.subtract(removed,available).length)throw Error('共通の可能時間が変更されています。最新の表示で操作してください。');
    for(const range of A.merge(removed))addMeeting(next,group,date,range,members,makeId);
    return check(next);
  }
  function duplicateDates(board,source,dates,makeId=id){
    const availability=source.kind==='availability';
    const original=availability
      ?personBands(board,source.person,source.date).find(range=>sameTime(range,source))
      :board.meetings.find(meeting=>source.kind==='meeting'&&source.person===null&&meeting.id===source.id);
    if(!original)throw Error('複製元の時間帯が見つかりません。');
    const sourceDate=availability?source.date:original.date;
    const targets=[...new Set(dates)].sort();
    if(!targets.length||targets.some(date=>!M.validDate(date)||date===sourceDate))throw Error('複製先の日付を確認してください。');
    const next=M.clone(board),added=[],existing=[],blocked=[];
    for(const date of targets){
      if(availability){
        const ranges=personRanges(next,source.person,date);
        if(!A.subtract([original],ranges).length){existing.push(date);continue;}
        if(A.intersect([original],meetingsFor(next,source.person,date)).length){blocked.push(date);continue;}
        writePerson(next,source.person,date,[...ranges,original],makeId);
      }else{
        const {group,members}=original;
        if(next.meetings.some(meeting=>meeting.group===group&&meeting.date===date&&sameTime(meeting,original)&&
          meeting.members.length===members.length&&members.every(person=>meeting.members.includes(person)))){existing.push(date);continue;}
        const common=A.common(members.map(person=>personRanges(next,person,date)));
        if(A.subtract([original],common).length){blocked.push(date);continue;}
        addMeeting(next,group,date,original,members,makeId);
      }
      added.push(date);
    }
    return {board:added.length?check(next):board,added,existing,blocked};
  }
  function release(board,meetingId,{person=null,start=null,end=null}={},makeId=id){
    const next=M.clone(board),meeting=next.meetings.find(m=>m.id===meetingId);
    if(!meeting)throw Error('MTGが更新されています。画面を閉じて確認してください。');
    let members,freed;
    if(person!==null){
      if(!meeting.members.includes(person))throw Error('対象者はすでに解除されています。');
      members=[person];freed=[{start:meeting.start,end:meeting.end}];meeting.members=meeting.members.filter(p=>p!==person);
    }else{
      const a=start??meeting.end,b=end??meeting.end;
      if(!Number.isInteger(a)||!Number.isInteger(b)||a<meeting.start||b>meeting.end||a>b)throw Error('MTGは短縮・解除のみできます。');
      members=[...meeting.members];freed=A.subtract([meeting],a<b?[{start:a,end:b}]:[]);meeting.start=a;meeting.end=b;
    }
    next.meetings=next.meetings.filter(m=>(m.members.length||m.limitedParticipants)&&m.start<m.end);
    for(const p of members)writePerson(next,p,meeting.date,[...personRanges(next,p,meeting.date),...freed],makeId);
    return check(next);
  }
  function meetingMemberRanges(board,meetingId){
    const meeting=board.meetings.find(m=>m.id===meetingId);
    if(!meeting)throw Error('MTGが更新されています。最新の表示で操作してください。');
    // The original reservation is reusable only by its fixed participants.
    return meeting.members.map(person=>({person,values:A.subtract([...personRanges(board,person,meeting.date),meeting],meetingsFor(board,person,meeting.date).filter(m=>m.id!==meetingId))}));
  }
  function meetingAvailability(board,meetingId){
    const members=meetingMemberRanges(board,meetingId);
    // A scoped board with no visible participants defers the range check to the server.
    return members.length?A.common(members.map(member=>member.values)):[{start:480,end:1440}];
  }
  function meetingDragRange(meeting,mode,origin,cursor){
    const snap=value=>Math.round(value/30)*30;
    if(mode==='move'){const delta=snap(cursor-origin);return {start:meeting.start+delta,end:meeting.end+delta};}
    if(mode==='start')return {start:Math.min(snap(cursor),meeting.end),end:meeting.end};
    if(mode==='end')return {start:meeting.start,end:Math.max(snap(cursor),meeting.start)};
    throw Error('MTGの操作を確認してください。');
  }
  function adjustMeeting(board,meetingId,{start,end},makeId=id){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<480||end>1440||start>end)throw Error('⚠️可能時間がありません');
    const members=meetingMemberRanges(board,meetingId);
    if(start===end)return release(board,meetingId,{},makeId);
    if(members.length&&A.subtract([{start,end}],A.common(members.map(member=>member.values))).length)throw Error('⚠️可能時間がありません');
    const next=M.clone(board),meeting=next.meetings.find(m=>m.id===meetingId);
    meeting.start=start;meeting.end=end;
    for(const {person,values} of members)writePerson(next,person,meeting.date,values,makeId);
    return check(next);
  }
  function removeGroup(board,group,makeId=id){
    let next=M.clone(board);for(const m of next.meetings.filter(m=>m.group===group))next=release(next,m.id,{},makeId);
    next.groups=next.groups.filter(g=>g.id!==group);return check(next);
  }
  function checkExportDates(first,last){
    if(!M.validDate(first)||!M.validDate(last)||last<first)throw Error('開始日と終了日を確認してください。');
    if((Date.parse(last)-Date.parse(first))/86400000>=366)throw Error('一度に書き出せる期間は366日以内です。');
  }
  function exportText(board,key,first,last,excluded=[]){
    checkExportDates(first,last);
    const lines=[];
    for(let date=first;date&&date<=last;date=M.shiftDate(date,1)){
      const values=ranges(board,key,date,typeof excluded==='function'?excluded(date):excluded);lines.push(A.formatDay(date,values)+(values.length?'':'なし'));
    }
    return lines.join('\n');
  }
  function exportMeetings(board,groupIds,first,last){
    checkExportDates(first,last);
    if(!groupIds.length)throw Error('書き出すグループを選択してください。');
    const groups=new Map(board.groups.map(group=>[group.id,group])),selected=new Set(groupIds);
    if(groupIds.some(id=>!groups.has(id)))throw Error('グループが更新されています。画面を開き直してください。');
    const meetings=board.meetings.filter(meeting=>selected.has(meeting.group)&&meeting.date>=first&&meeting.date<=last)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.end-b.end),byGroup=new Map();
    for(const meeting of meetings){
      if(!byGroup.has(meeting.group))byGroup.set(meeting.group,new Map());
      const participants=byGroup.get(meeting.group),key=[...meeting.members].sort((a,b)=>a-b).join(',');
      if(!participants.has(key))participants.set(key,{members:meeting.members,days:new Map()});
      const {days}=participants.get(key);
      if(!days.has(meeting.date))days.set(meeting.date,[]);
      days.get(meeting.date).push(`${A.time(meeting.start)}～${A.time(meeting.end)}`);
    }
    return board.groups.filter(group=>byGroup.has(group.id)).map(group=>[...byGroup.get(group.id).values()].map(({members,days})=>[
      `${group.name}（${members.map(person=>board.people[person]).join('、')}）：`,
      ...[...days].map(([date,times])=>A.formatDay(date,[])+times.join(', '))
    ].join('\n')).join('\n')).join('\n\n');
  }
  function color(group,groups=[]){
    // The ID makes a group's colour stable through renaming, reordering and reloads.
    const used=new Set();
    for(const key of [...new Set([...groups.map(g=>g.id),group])].sort()){
      let hash=0;for(const char of key)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
      let hue=hash%360;while(used.has(hue))hue=(hue+137)%360;used.add(hue);
      if(key===group)return `hsl(${hue} 55% 35%)`;
    }
  }
  const api={migrate,participants,personRanges,personBands,ranges,bulkExclusions,editPerson,splitPerson,meetingSelection,reserve,duplicateDates,release,meetingAvailability,meetingDragRange,adjustMeeting,removeGroup,exportText,exportMeetings,color};
  if(node)module.exports=api;else window.TokiSchedule=api;
})();

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
  function personRanges(board,person,date){return A.subtract(board.events.filter(e=>e.person===person&&e.date===date),meetingsFor(board,person,date));}
  function ranges(board,key,date,excluded=[]){
    if(key.startsWith('g:'))return A.common(participants(board,key.slice(2),excluded).map(p=>personRanges(board,p,date)));
    const person=Number(key.slice(2));if(!Number.isInteger(person)||!board.people[person])throw Error('人を選択してください。');
    return personRanges(board,person,date);
  }
  function writePerson(board,person,date,values,makeId=id){
    if(!Number.isInteger(person)||!board.people[person]||!M.validDate(date))throw Error('人と日付を確認してください。');
    board.events=board.events.filter(e=>e.person!==person||e.date!==date);
    for(const range of A.subtract(values,meetingsFor(board,person,date)))board.events.push({id:makeId(),person,date,...range});
  }
  function editPerson(board,person,date,removed=[],added=[],makeId=id){
    const next=M.clone(board);writePerson(next,person,date,[...A.subtract(personRanges(next,person,date),removed),...added],makeId);return check(next);
  }
  function movePersonRange(board,person,target,date,from,to,makeId=id){
    let next=editPerson(board,person,date,[from],[],makeId);return editPerson(next,target,date,[],[to],makeId);
  }
  function meetingSelection(common,origin,cursor=origin){
    const anchor=Math.floor(origin/30)*30,boundary=Math.round(cursor/30)*30;
    const start=Math.min(anchor,boundary),end=Math.max(anchor+30,boundary);
    // Reject out-of-range selections rather than silently clipping a reservation.
    if(!Number.isFinite(origin)||!Number.isFinite(cursor)||origin<common.start||origin>=common.end||cursor<common.start||cursor>common.end||start<common.start||end>common.end)throw Error('⚠️可能時間がありません');
    return {start,end};
  }
  function reserve(board,group,date,removed,excluded=[],makeId=id){
    const next=M.clone(board),members=participants(next,group,excluded),available=ranges(next,`g:${group}`,date,excluded);
    if(!members.length)throw Error('対象のメンバーがいません。');
    if(A.subtract(removed,available).length)throw Error('共通の可能時間が変更されています。最新の表示で操作してください。');
    for(const range of A.merge(removed)){
      next.meetings.push({id:makeId(),group,date,...range,members:[...members]});
      for(const person of members)writePerson(next,person,date,personRanges(next,person,date),makeId);
    }
    return check(next);
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
    next.meetings=next.meetings.filter(m=>m.members.length&&m.start<m.end);
    for(const p of members)writePerson(next,p,meeting.date,[...personRanges(next,p,meeting.date),...freed],makeId);
    return check(next);
  }
  function meetingMemberRanges(board,meetingId){
    const meeting=board.meetings.find(m=>m.id===meetingId);
    if(!meeting)throw Error('MTGが更新されています。最新の表示で操作してください。');
    // The original reservation is reusable only by its fixed participants.
    return meeting.members.map(person=>({person,values:A.subtract([...personRanges(board,person,meeting.date),meeting],meetingsFor(board,person,meeting.date).filter(m=>m.id!==meetingId))}));
  }
  function meetingAvailability(board,meetingId){return A.common(meetingMemberRanges(board,meetingId).map(member=>member.values));}
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
    if(A.subtract([{start,end}],A.common(members.map(member=>member.values))).length)throw Error('⚠️可能時間がありません');
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
      const values=ranges(board,key,date,excluded);lines.push(A.formatDay(date,values)+(values.length?'':'なし'));
    }
    return lines.join('\n');
  }
  function exportMeetings(board,groupIds,first,last){
    checkExportDates(first,last);
    if(!groupIds.length)throw Error('書き出すグループを選択してください。');
    const groups=new Map(board.groups.map((group,order)=>[group.id,{...group,order}])),selected=new Set(groupIds);
    if(groupIds.some(id=>!groups.has(id)))throw Error('グループが更新されています。画面を開き直してください。');
    return board.meetings.filter(meeting=>selected.has(meeting.group)&&meeting.date>=first&&meeting.date<=last)
      .sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||groups.get(a.group).order-groups.get(b.group).order||a.end-b.end)
      .map(meeting=>`${groups.get(meeting.group).name}（${meeting.members.map(person=>board.people[person]).join('、')}）：${A.formatDay(meeting.date,[meeting])}`)
      .join('\n');
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
  const api={migrate,participants,personRanges,ranges,editPerson,movePersonRange,meetingSelection,reserve,release,meetingAvailability,meetingDragRange,adjustMeeting,removeGroup,exportText,exportMeetings,color};
  if(node)module.exports=api;else window.TokiSchedule=api;
})();

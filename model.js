"use strict";
// Pure board operations shared by the UI and regression tests.
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  // Bound navigation to complete Sunday–Saturday weeks in the four-digit calendar.
  const MIN_DATE='0001-01-07',MAX_DATE='9999-12-25';
  function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<MIN_DATE||value>MAX_DATE)return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
  function shiftDate(value,days){if(!validDate(value)||!Number.isInteger(days))return null;const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);if(!Number.isFinite(d.getTime()))return null;const result=d.toISOString().slice(0,10);return validDate(result)?result:null;}
  function weekDates(value){if(!validDate(value))throw Error('日付を確認してください。');const start=shiftDate(value,-new Date(value+'T00:00:00Z').getUTCDay());return Array.from({length:7},(_,i)=>shiftDate(start,i));}
  const normalizeName = value => value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const nameKey = value => normalizeName(value).toLowerCase();
  const rowKey = event => event.group !== undefined ? `g:${event.group}` : `p:${event.person}`;
  const owner = key => key.startsWith("g:") ? {group:key.slice(2)} : {person:Number(key.slice(2))};
  function moveEvent(event, key) { const next={...event}; delete next.person; delete next.group; return {...next,...owner(key)}; }
  function upgrade(board) { const next={...clone(board),schemaVersion:3,groups:clone(board.groups||[])};delete next.dates;return next; }
  function valid(board) {
    if(!board||board.schemaVersion!==3||!Array.isArray(board.people)||board.people.length>100||!Array.isArray(board.groups)||board.groups.length>50||!Array.isArray(board.events)||board.events.length>2000)return false;
    const name=n=>typeof n==='string'&&n===normalizeName(n)&&n.length>0&&n.length<=40&&!/[\x00-\x1f\x7f]/u.test(n);
    const unique=values=>new Set(values).size===values.length;
    const person=i=>Number.isInteger(i)&&i>=0&&i<board.people.length;
    if(!board.people.every(name)||!unique(board.people.map(nameKey)))return false;
    if(!board.groups.every(g=>g&&typeof g.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(g.id)&&name(g.name)&&Array.isArray(g.members)&&g.members.every(person)&&unique(g.members))||!unique(board.groups.map(g=>g.id))||!unique(board.groups.map(g=>nameKey(g.name))))return false;
    return unique(board.events.map(e=>e?.id))&&board.events.every(e=>e&&typeof e.id==='string'&&e.id.length>0&&e.id.length<=100&&
      (Object.hasOwn(e,'person')!==Object.hasOwn(e,'group'))&&(Object.hasOwn(e,'person')?person(e.person):board.groups.some(g=>g.id===e.group))&&
      validDate(e.date)&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=480&&e.end<=1440&&e.end>e.start&&typeof e.title==='string'&&e.title.length>0&&e.title.length<=100&&typeof e.detail==='string'&&e.detail.length<=2000);
  }
  function checked(board){if(!valid(board))throw Error('入力内容を確認してください。');return board;}
  function checkName(value,names,skip=-1){const name=normalizeName(value);if(!name||name.length>40)throw Error('名前は1〜40文字で入力してください。');if(names.some((n,i)=>i!==skip&&nameKey(n)===nameKey(name)))throw Error('その名前はすでに登録されています。別の名前にしてください。');return name;}
  function setPerson(board,index,value,groupIds=[]){const b=clone(board);const name=checkName(value,b.people,index);if(index===null){index=b.people.length;b.people.push(name);}else b.people[index]=name;
    b.groups.forEach(g=>{if(!groupIds.includes(g.id))g.members=g.members.filter(i=>i!==index);else if(!g.members.includes(index))g.members.push(index);});return checked(b);}
  function removePerson(board,index){const b=clone(board);b.people.splice(index,1);b.events=b.events.filter(e=>e.person!==index).map(e=>e.person>index?{...e,person:e.person-1}:e);b.groups.forEach(g=>g.members=g.members.filter(i=>i!==index).map(i=>i>index?i-1:i));return checked(b);}
  function setGroup(board,id,value,members){const b=clone(board),index=b.groups.findIndex(g=>g.id===id),name=checkName(value,b.groups.map(g=>g.name),index);const previous=b.groups[index]?.members||[];const group={id,name,members:[...previous.filter(i=>members.includes(i)),...new Set(members.filter(i=>!previous.includes(i)))]};if(index<0)b.groups.push(group);else b.groups[index]=group;return checked(b);}
  function removeGroup(board,id){const b=clone(board);b.groups=b.groups.filter(g=>g.id!==id);b.events=b.events.filter(e=>e.group!==id);return checked(b);}
  function rows(board,collapsed=new Set()){const assigned=new Set(board.groups.flatMap(g=>g.members)),rows=[];board.groups.forEach(g=>{rows.push({key:`g:${g.id}`,name:g.name,group:g});if(!collapsed.has(g.id))g.members.forEach(person=>rows.push({key:`p:${person}`,name:board.people[person],person,nested:true,context:g.id}));});board.people.forEach((name,person)=>{if(!assigned.has(person))rows.push({key:`p:${person}`,name,person,context:null});});return rows;}
  // Reordering the people array must remap all event and membership references together.
  function reorderPeople(board,person,target=null,after=false){const b=clone(board);if(target===person)return b;const order=b.people.map((_,i)=>i).filter(i=>i!==person);const at=target===null?order.length:order.indexOf(target)+(after?1:0);order.splice(at,0,person);const positions=new Map(order.map((old,index)=>[old,index]));b.people=order.map(i=>b.people[i]);b.events=b.events.map(e=>e.person===undefined?e:{...e,person:positions.get(e.person)});b.groups.forEach(g=>g.members=g.members.map(i=>positions.get(i)));return checked(b);}
  function reorderGroup(board,id,target=null,after=false){const b=clone(board),group=b.groups.find(g=>g.id===id);if(!group||target!==null&&!b.groups.some(g=>g.id===target))throw Error('移動するグループが見つかりません。');if(target===id)return b;b.groups=b.groups.filter(g=>g.id!==id);const at=target===null?b.groups.length:b.groups.findIndex(g=>g.id===target)+(after?1:0);b.groups.splice(at,0,group);return checked(b);}
  function placePerson(board,person,{group=null,target=null,after=false,source=null,move=false}={}){
    if(!Number.isInteger(person)||person<0||person>=board.people.length||target!==null&&(!Number.isInteger(target)||target<0||target>=board.people.length))throw Error('移動する人が見つかりません。');
    const b=clone(board);
    if(group!==null){const to=b.groups.find(g=>g.id===group);if(!to)throw Error('移動先のグループが見つかりません。');
      if(target!==null&&!to.members.includes(target))throw Error('移動先の行が見つかりません。');
      if(move&&source&&source!==group){const from=b.groups.find(g=>g.id===source);if(from)from.members=from.members.filter(i=>i!==person);}
      if(target===person)return checked(b);
      // Dropping on a header adds membership without disturbing an existing position.
      if(target===null&&to.members.includes(person))return checked(b);
      to.members=to.members.filter(i=>i!==person);const at=target===null?to.members.length:to.members.indexOf(target)+(after?1:0);to.members.splice(at,0,person);return checked(b);
    }
    if(source){const from=b.groups.find(g=>g.id===source);if(!from)throw Error('元のグループが見つかりません。');from.members=from.members.filter(i=>i!==person);}
    // Other memberships keep their own row order. Only newly ungrouped people move here.
    if(b.groups.some(g=>g.members.includes(person)))return checked(b);
    return reorderPeople(b,person,target,after);
  }
  const api={clone,MIN_DATE,MAX_DATE,validDate,shiftDate,weekDates,normalizeName,nameKey,rowKey,owner,moveEvent,upgrade,valid,setPerson,removePerson,setGroup,removeGroup,rows,reorderPeople,reorderGroup,placePerson};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.TokiModel=api;
})();

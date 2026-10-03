"use strict";
// Pure board operations shared by the UI and regression tests.
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const normalizeName = value => value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const nameKey = value => normalizeName(value).toLowerCase();
  const rowKey = event => event.group !== undefined ? `g:${event.group}` : `p:${event.person}`;
  const owner = key => key.startsWith("g:") ? {group:key.slice(2)} : {person:Number(key.slice(2))};
  function moveEvent(event, key) { const next={...event}; delete next.person; delete next.group; return {...next,...owner(key)}; }
  function upgrade(board) { return {...clone(board),schemaVersion:2,groups:clone(board.groups||[])}; }
  function valid(board) {
    if(!board||board.schemaVersion!==2||!Array.isArray(board.people)||board.people.length>100||!Array.isArray(board.groups)||board.groups.length>50||!Array.isArray(board.events)||board.events.length>2000||!Array.isArray(board.dates))return false;
    const name=n=>typeof n==='string'&&n===normalizeName(n)&&n.length>0&&n.length<=40&&!/[\x00-\x1f\x7f]/u.test(n);
    const unique=values=>new Set(values).size===values.length;
    const person=i=>Number.isInteger(i)&&i>=0&&i<board.people.length;
    if(!board.people.every(name)||!unique(board.people.map(nameKey)))return false;
    if(!board.groups.every(g=>g&&typeof g.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(g.id)&&name(g.name)&&Array.isArray(g.members)&&g.members.every(person)&&unique(g.members))||!unique(board.groups.map(g=>g.id))||!unique(board.groups.map(g=>nameKey(g.name))))return false;
    return unique(board.events.map(e=>e?.id))&&board.events.every(e=>e&&typeof e.id==='string'&&e.id.length>0&&e.id.length<=100&&
      (Object.hasOwn(e,'person')!==Object.hasOwn(e,'group'))&&(Object.hasOwn(e,'person')?person(e.person):board.groups.some(g=>g.id===e.group))&&
      board.dates.includes(e.date)&&Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=480&&e.end<=1440&&e.end>e.start&&typeof e.title==='string'&&e.title.length>0&&e.title.length<=100&&typeof e.detail==='string'&&e.detail.length<=2000);
  }
  function checked(board){if(!valid(board))throw Error('入力内容を確認してください。');return board;}
  function checkName(value,names,skip=-1){const name=normalizeName(value);if(!name||name.length>40)throw Error('名前は1〜40文字で入力してください。');if(names.some((n,i)=>i!==skip&&nameKey(n)===nameKey(name)))throw Error('その名前はすでに登録されています。別の名前にしてください。');return name;}
  function setPerson(board,index,value,groupIds=[]){const b=clone(board);const name=checkName(value,b.people,index);if(index===null){index=b.people.length;b.people.push(name);}else b.people[index]=name;
    b.groups.forEach(g=>{g.members=g.members.filter(i=>i!==index);if(groupIds.includes(g.id))g.members.push(index);g.members.sort((a,b)=>a-b);});return checked(b);}
  function removePerson(board,index){const b=clone(board);b.people.splice(index,1);b.events=b.events.filter(e=>e.person!==index).map(e=>e.person>index?{...e,person:e.person-1}:e);b.groups.forEach(g=>g.members=g.members.filter(i=>i!==index).map(i=>i>index?i-1:i));return checked(b);}
  function setGroup(board,id,value,members){const b=clone(board),index=b.groups.findIndex(g=>g.id===id),name=checkName(value,b.groups.map(g=>g.name),index);const group={id,name,members:[...new Set(members)].sort((a,b)=>a-b)};if(index<0)b.groups.push(group);else b.groups[index]=group;return checked(b);}
  function removeGroup(board,id){const b=clone(board);b.groups=b.groups.filter(g=>g.id!==id);b.events=b.events.filter(e=>e.group!==id);return checked(b);}
  function rows(board,collapsed=new Set()){const assigned=new Set(board.groups.flatMap(g=>g.members)),rows=[];board.groups.forEach(g=>{rows.push({key:`g:${g.id}`,name:g.name,group:g});if(!collapsed.has(g.id))g.members.forEach(person=>rows.push({key:`p:${person}`,name:board.people[person],person,nested:true}));});board.people.forEach((name,person)=>{if(!assigned.has(person))rows.push({key:`p:${person}`,name,person});});return rows;}
  const api={clone,normalizeName,nameKey,rowKey,owner,moveEvent,upgrade,valid,setPerson,removePerson,setGroup,removeGroup,rows};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.TokiModel=api;
})();

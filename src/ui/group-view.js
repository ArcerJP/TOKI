"use strict";
window.TokiGroupView=({context,change})=>{
  let scope='',selection=new Set(),configured=false,prompted=false;
  const $=id=>document.getElementById(id),key=()=>`toki-view-v1:${scope}:groups`;
  function sync(){
    const next=context().scope;if(next===scope)return;
    scope=next;selection=new Set();configured=false;prompted=false;
    try{const saved=JSON.parse(localStorage.getItem(key()));if(saved?.version===1&&Array.isArray(saved.selected)){selection=new Set(saved.selected.filter(x=>typeof x==='string'));configured=true;}}catch{}
  }
  function visible(id){sync();return selection.has(id);}
  function open(){
    sync();if(!context().ready)return;
    const d=$('group-view-dialog'),choices=$('group-view-choices'),all=$('group-view-all'),draft=new Set(selection);
    choices.replaceChildren();const options=context().board.groups.map(g=>[g.id,g.name]);options.push(['@unassigned','未所属']);
    const update=()=>{const boxes=[...choices.querySelectorAll('input')];all.checked=boxes.length>0&&boxes.every(b=>b.checked);all.indeterminate=!all.checked&&boxes.some(b=>b.checked);};
    for(const [id,name] of options){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=draft.has(id);input.dataset.group=id;input.onchange=()=>{if(input.checked)draft.add(id);else draft.delete(id);update();};label.append(input,document.createTextNode(name));choices.append(label);}
    all.onchange=()=>{for(const input of choices.querySelectorAll('input')){input.checked=all.checked;if(all.checked)draft.add(input.dataset.group);else draft.delete(input.dataset.group);}update();};
    $('group-view-apply').onclick=()=>{selection=draft;configured=true;try{localStorage.setItem(key(),JSON.stringify({version:1,selected:[...selection]}));}catch{}d.close();change();};
    $('group-view-close').onclick=()=>d.close();update();prompted=true;if(!d.open)d.showModal();
  }
  function refresh(){
    sync();const ctx=context(),count=ctx.board.groups.filter(g=>selection.has(g.id)).length;
    $('group-view-button').textContent=`表示グループ ${count}/${ctx.board.groups.length} ▾`;
    $('group-view-button').disabled=!ctx.ready;
    if(ctx.ready&&!configured&&!prompted&&!document.querySelector('dialog[open]'))open();
  }
  $('group-view-button').onclick=open;
  window.addEventListener('storage',event=>{if(event.key===key()){scope='';sync();change();}});
  return {visible,open,refresh};
};

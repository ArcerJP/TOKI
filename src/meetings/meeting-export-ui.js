"use strict";
window.TokiMeetingExportUI=({board,selected,notify,canOpen})=>{
  const $=id=>document.getElementById(id),dialog=$('meeting-export-dialog'),all=$('meeting-export-all'),groups=$('meeting-export-groups');
  const choices=()=>[...groups.querySelectorAll('input[type="checkbox"]')];
  function update(){
    const inputs=choices(),ids=inputs.filter(input=>input.checked).map(input=>input.value);
    all.checked=inputs.length>0&&ids.length===inputs.length;all.indeterminate=ids.length>0&&ids.length<inputs.length;all.disabled=!inputs.length;
    try{
      const current=board(),first=$('meeting-export-first').value,last=$('meeting-export-last').value;
      const text=window.TokiSchedule.exportMeetings(current,ids,first,last);
      const count=current.meetings.filter(meeting=>ids.includes(meeting.group)&&meeting.date>=first&&meeting.date<=last).length;
      $('meeting-export-result').value=text;$('meeting-export-error').textContent='';$('copy-meetings').disabled=!text;
      $('meeting-export-summary').textContent=text?`${ids.length}グループ・${count}件のMTG`:'指定した期間・グループにMTGはありません。';
    }catch(error){
      $('meeting-export-error').textContent=error.message;$('meeting-export-result').value='';$('meeting-export-summary').textContent='';$('copy-meetings').disabled=true;
    }
  }
  $('export-meetings').onclick=()=>{
    if(!canOpen())return;groups.replaceChildren();
    for(const group of board().groups){
      const label=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.value=group.id;input.checked=true;
      label.append(input,document.createTextNode(group.name));groups.append(label);
    }
    const week=window.TokiModel.weekDates(selected());$('meeting-export-first').value=week[0];$('meeting-export-last').value=week[6];update();dialog.showModal();
  };
  all.addEventListener('change',()=>{for(const input of choices())input.checked=all.checked;update();});
  groups.addEventListener('change',update);
  for(const id of ['meeting-export-first','meeting-export-last'])$(id).addEventListener('input',update);
  $('close-meeting-export').onclick=()=>dialog.close();
  $('copy-meetings').onclick=async()=>{
    update();if(!$('meeting-export-result').value)return;
    try{await navigator.clipboard.writeText($('meeting-export-result').value);notify('MTGを一括コピーしました');}
    catch{$('meeting-export-result').focus();$('meeting-export-result').select();$('meeting-export-error').textContent='自動コピーできません。選択されたテキストをコピーしてください。';}
  };
};

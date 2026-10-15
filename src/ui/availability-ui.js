"use strict";
window.TokiAvailabilityUI=({board,selected,excluded,notify,canOpen})=>{
  const $=id=>document.getElementById(id),dialog=$('export-dialog');
  function update(){
    try{const key=$('export-person').value;const text=window.TokiSchedule.exportText(board(),key,$('export-first').value,$('export-last').value,key.startsWith('g:')?excluded(key.slice(2)):[]);$('export-result').value=text;$('export-error').textContent='';$('copy-availability').disabled=!text;}
    catch(error){$('export-error').textContent=error.message;$('export-result').value='';$('copy-availability').disabled=true;}
  }
  $('export-availability').onclick=()=>{
    if(!canOpen())return;const current=board();$('export-person').replaceChildren();
    for(const [key,name] of [...current.people.map((n,i)=>[`p:${i}`,n]),...current.groups.map(g=>[`g:${g.id}`,`グループ：${g.name}`])]){
      const option=document.createElement('option');option.value=key;option.textContent=name;$('export-person').append(option);
    }
    const week=window.TokiModel.weekDates(selected());$('export-first').value=week[0];$('export-last').value=week[6];update();dialog.showModal();
  };
  for(const id of ['export-person','export-first','export-last'])$(id).addEventListener('input',update);
  $('close-export').onclick=()=>dialog.close();
  $('copy-availability').onclick=async()=>{
    update();if(!$('export-result').value)return;
    try{await navigator.clipboard.writeText($('export-result').value);notify('可能時間をコピーしました');}
    catch{$('export-result').focus();$('export-result').select();$('export-error').textContent='自動コピーできません。選択されたテキストをコピーしてください。';}
  };
};

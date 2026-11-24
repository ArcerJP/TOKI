"use strict";
window.TokiTimeAdjustment=({range,canSave,save,onBusy,creatingMeeting=false})=>{
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const form=el('form'),fields=el('fieldset'),error=el('p'),submit=el('button',creatingMeeting?'MTGを作成':'時間を保存');
  form.className='time-adjustment';
  fields.append(el('legend',creatingMeeting?'MTGの時間':'時間を調整'));
  error.className='error time-adjustment-error';
  error.id='time-adjustment-error-'+crypto.randomUUID();
  error.setAttribute('role','alert');
  submit.type='submit';submit.className='primary';
  let saving=false,failure='';

  function endpoint(label,initial,maxHour){
    const row=el('div'),hour=el('select'),minute=el('select');
    const originalHour=Math.floor(initial/60),originalMinute=initial%60;
    row.className='time-adjustment-row';
    function option(value,unit){
      const choice=el('option',String(value).padStart(2,'0')+unit);
      choice.value=String(value);return choice;
    }
    hour.setAttribute('aria-label',label+'の時');
    minute.setAttribute('aria-label',label+'の分');
    for(let value=8;value<=maxHour;value++)hour.append(option(value,'時'));
    const half=option(30,'分');minute.append(option(0,'分'),half);
    let legacy=null;
    if(originalMinute!==0&&originalMinute!==30){
      legacy=option(originalMinute,'分（現在）');legacy.disabled=true;minute.append(legacy);
    }
    hour.value=String(originalHour);minute.value=String(originalMinute);
    row.append(el('span',label),hour,minute);fields.append(row);
    return {
      controls:[hour,minute],
      get value(){return Number(hour.value)*60+Number(minute.value);},
      normalize(){
        const atMidnight=hour.value==='24';
        half.disabled=atMidnight;
        if(legacy&&(hour.value!==String(originalHour)||minute.value!==legacy.value)){
          const wasSelected=minute.value===legacy.value;
          legacy.remove();legacy=null;
          if(wasSelected)minute.value='0';
        }
        if(atMidnight)minute.value='0';
      }
    };
  }
  const start=endpoint('開始',range.start,23),end=endpoint('終了',range.end,24);
  const selected=()=>({start:start.value,end:end.value});
  function refresh(){
    const to=selected(),invalid=to.end<=to.start;
    fields.disabled=saving||!canSave();
    submit.disabled=fields.disabled||invalid||(!creatingMeeting&&to.start===range.start&&to.end===range.end);
    const text=invalid?'⚠ 終了時刻は開始時刻より後にしてください。この時間は保存できません。':failure;
    error.textContent=text;error.hidden=!text;
    for(const control of end.controls){
      control.setAttribute('aria-invalid',String(invalid));
      if(invalid)control.setAttribute('aria-describedby',error.id);
      else control.removeAttribute('aria-describedby');
    }
  }
  for(const side of [start,end]){
    side.normalize();
    const update=()=>{side.normalize();failure='';refresh();};
    for(const control of side.controls){
      control.addEventListener('input',update);
      control.addEventListener('change',update);
    }
  }
  form.append(fields,error,submit);
  form.onsubmit=async event=>{
    event.preventDefault();refresh();
    if(submit.disabled)return;
    saving=true;failure='';onBusy(true);refresh();
    try{await save(selected());}
    catch(reason){failure=reason.message;}
    finally{saving=false;onBusy(false);refresh();}
  };
  refresh();
  return {form,refresh};
};

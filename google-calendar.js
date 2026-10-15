"use strict";
(() => {
  const SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy'];
  const ENDPOINT='https://www.googleapis.com/calendar/v3/freeBusy?fields=timeMin%2CtimeMax%2Ccalendars';
  const LIST_ENDPOINT='https://www.googleapis.com/calendar/v3/users/me/calendarList';
  // Google-provided holiday calendars use these IDs, independently of their display name.
  const isHolidayCalendar=id=>/(?:#holiday@group\.v\.calendar\.google\.com|@holiday\.calendar\.google\.com)$/i.test(id);
  let sdkPromise,client,token='',expires=0,pendingLogin=false,loginEpoch=0,cancelLogin=null;
  const configured=()=>/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(window.TOKI_CONFIG?.googleClientId||'');
  const connected=()=>Boolean(token)&&Date.now()<expires;
  const logout=()=>{loginEpoch++;token='';expires=0;pendingLogin=false;const cancel=cancelLogin;cancelLogin=null;cancel?.();};
  function load(){
    if(!configured())return Promise.reject(Error('Googleログインは設定準備中です。管理者がOAuthクライアントIDを設定すると利用できます。'));
    if(location.protocol==='file:')return Promise.reject(Error('Googleログインは公開サイトから利用してください。'));
    if(window.google?.accounts?.oauth2)return Promise.resolve();
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.referrerPolicy='no-referrer';
      const failed=()=>{clearTimeout(timer);script.remove();sdkPromise=null;reject(Error('Googleログインを読み込めません。接続を確認して画面を開き直してください。'));};
      const timer=setTimeout(failed,15000);
      script.onload=()=>{clearTimeout(timer);if(window.google?.accounts?.oauth2)resolve();else failed();};script.onerror=failed;
      document.head.append(script);
    });
    return sdkPromise;
  }
  // Called directly by a button click so Google's popup keeps its user gesture.
  function login(){
    if(!window.google?.accounts?.oauth2)throw Error('Googleログインの読み込みが終わるまでお待ちください。');
    if(pendingLogin)throw Error('Googleのログイン画面を確認してください。');
    logout();pendingLogin=true;const generation=loginEpoch;
    return new Promise((resolve,reject)=>{
      cancelLogin=()=>reject(Error('Googleログインを中止しました。もう一度ログインしてください。'));
      const failed=message=>{if(generation!==loginEpoch)return;cancelLogin=null;pendingLogin=false;logout();reject(Error(message));};
      client=window.google.accounts.oauth2.initTokenClient({
        client_id:window.TOKI_CONFIG.googleClientId,scope:SCOPES.join(' '),include_granted_scopes:false,
        callback:response=>{
          if(generation!==loginEpoch)return;
          if(response.error==='access_denied')return failed('Googleへのアクセスが許可されませんでした。権限の許可を取り消した場合はログインし直してください。「テスト中」「アクセスをブロック」と表示された場合は、管理者にログインするアカウントのテストユーザー登録を依頼してください。');
          if(response.error||!response.access_token||!window.google.accounts.oauth2.hasGrantedAllScopes(response,...SCOPES))return failed('カレンダーの一覧と予定あり／なしを確認する2つの権限が必要です。Googleでログインし直し、両方を許可してください。');
          const lifetime=Number(response.expires_in);
          if(!Number.isFinite(lifetime)||lifetime<=30)return failed('Googleの認証を確認できませんでした。再度ログインしてください。');
          token=response.access_token;expires=Date.now()+(lifetime-30)*1000;pendingLogin=false;cancelLogin=null;resolve();
        },
        error_callback:failure=>failed(failure.type==='popup_closed'?'Googleログインが完了する前に画面が閉じられました。「テスト中」「アクセスをブロック」と表示された場合は、管理者にログインするアカウントのテストユーザー登録を依頼してください。':failure.type==='popup_failed_to_open'?'Googleのログイン画面を開けません。ブラウザーでポップアップを許可して再度お試しください。':'Googleログインを完了できませんでした。画面を開き直して、もう一度お試しください。')
      });
      try{client.requestAccessToken({prompt:'select_account'});}catch{failed('Googleログインを開始できませんでした。');}
    });
  }
  function access(){
    if(!connected()){logout();throw Error('Googleでログインしてから取得してください。認証期限が切れた場合も再ログインが必要です。');}
    return token;
  }
  async function requestJson(url,options,signal,sessionToken){
    if(access()!==sessionToken)throw Error('Googleアカウントが変更されました。もう一度取得してください。');
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    const timer=setTimeout(abort,20000);
    try{
      const response=await fetch(url,{
        ...options,headers:{Authorization:`Bearer ${sessionToken}`,...(options.body?{'Content-Type':'application/json'}:{})},
        credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal
      });
      if(token!==sessionToken)throw Error('Googleアカウントが変更されました。もう一度取得してください。');
      if(response.status===401){logout();throw Error('Googleの認証期限が切れました。再度ログインしてください。');}
      if(response.status===403)throw Error('カレンダーを読み取れません。Googleでログインし直し、カレンダーの一覧と予定あり／なしの両方を許可してください。解消しない場合は管理者にCalendar APIの有効化と共有カレンダーの閲覧権限を確認してください。');
      if(!response.ok)throw Error('Googleカレンダーを取得できませんでした。少し時間を置いて再度お試しください。');
      let data;try{data=await response.json();}catch{throw Error('Googleからの応答を確認できませんでした。再度取得してください。');}
      if(controller.signal.aborted)throw Object.assign(Error(),{name:'AbortError'});
      if(token!==sessionToken)throw Error('Googleアカウントが変更されました。もう一度取得してください。');
      return data;
    }catch(error){
      if(error.name==='AbortError')throw Error('取得を中止しました。通信状態を確認して再度お試しください。');
      if(error instanceof TypeError)throw Error('Googleカレンダーと通信できません。接続を確認してください。');
      throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function listCalendars(signal){
    const sessionToken=access(),calendars=new Map(),pages=new Set();let pageToken='';
    do{
      const params=new URLSearchParams({maxResults:'250',minAccessRole:'freeBusyReader',showHidden:'true',showDeleted:'false',fields:'nextPageToken,items(id,summary,summaryOverride,primary,accessRole)'});
      if(pageToken)params.set('pageToken',pageToken);
      const data=await requestJson(`${LIST_ENDPOINT}?${params}`,{method:'GET'},signal,sessionToken);
      if(!data||typeof data!=='object'||data.items!==undefined&&!Array.isArray(data.items))throw Error('カレンダー一覧を確認できませんでした。一覧を再取得してください。');
      for(const entry of data.items||[]){
        if(!entry||typeof entry.id!=='string'||!entry.id.trim()||!['owner','writer','writerWithoutPrivateAccess','reader','freeBusyReader'].includes(entry.accessRole))throw Error('カレンダー一覧を確認できませんでした。一覧を再取得してください。');
        if(isHolidayCalendar(entry.id))continue;
        const name=entry.summaryOverride||entry.summary;
        calendars.set(entry.id,{id:entry.id,name:typeof name==='string'&&name.trim()?name:'名称未設定のカレンダー',primary:entry.primary===true});
      }
      pageToken=data.nextPageToken??'';
      if(typeof pageToken!=='string'||pageToken&&pages.has(pageToken))throw Error('カレンダー一覧を最後まで取得できませんでした。一覧を再取得してください。');
      if(pageToken)pages.add(pageToken);
    }while(pageToken);
    return [...calendars.values()].sort((a,b)=>Number(b.primary)-Number(a.primary)||a.name.localeCompare(b.name,'ja'));
  }
  async function fetchBusy(range,calendarIds,signal){
    const sessionToken=access();
    if(!Array.isArray(calendarIds)||!calendarIds.length||calendarIds.some(id=>typeof id!=='string'||!id.trim()))throw Error('取り込むカレンダーを1つ以上選択してください。');
    const ids=[...new Set(calendarIds)].filter(id=>!isHolidayCalendar(id)),busy=[];
    if(!ids.length)throw Error('取り込むカレンダーを1つ以上選択してください。祝日カレンダーは対象外です。');
    // Google allows at most 50 calendars per FreeBusy query. Never return a partial batch.
    for(let start=0;start<ids.length;start+=50){
      const batch=ids.slice(start,start+50);
      const data=await requestJson(ENDPOINT,{method:'POST',body:JSON.stringify({timeMin:range.start,timeMax:range.end,timeZone:'Asia/Tokyo',calendarExpansionMax:batch.length,items:batch.map(id=>({id}))})},signal,sessionToken);
      busy.push(...window.TokiCalendarImport.readBusy(data,range,batch));
    }
    return busy;
  }
  window.TokiGoogleCalendar={load,login,logout,listCalendars,fetchBusy,get configured(){return configured();},get connected(){return connected();}};
})();

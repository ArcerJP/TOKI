"use strict";
(() => {
  const SCOPE='https://www.googleapis.com/auth/calendar.freebusy';
  const ENDPOINT='https://www.googleapis.com/calendar/v3/freeBusy?fields=timeMin%2CtimeMax%2Ccalendars';
  let sdkPromise,client,token='',expires=0,pendingLogin=false;
  const configured=()=>/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(window.TOKI_CONFIG?.googleClientId||'');
  const connected=()=>Boolean(token)&&Date.now()<expires;
  const logout=()=>{token='';expires=0;};
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
    logout();pendingLogin=true;
    return new Promise((resolve,reject)=>{
      const failed=message=>{pendingLogin=false;logout();reject(Error(message));};
      client=window.google.accounts.oauth2.initTokenClient({
        client_id:window.TOKI_CONFIG.googleClientId,scope:SCOPE,include_granted_scopes:false,
        callback:response=>{
          if(response.error||!response.access_token||!window.google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE))return failed('カレンダーの予定あり／なしを確認する権限が必要です。Googleでログインし直してください。');
          const lifetime=Number(response.expires_in);
          if(!Number.isFinite(lifetime)||lifetime<=30)return failed('Googleの認証を確認できませんでした。再度ログインしてください。');
          token=response.access_token;expires=Date.now()+(lifetime-30)*1000;pendingLogin=false;resolve();
        },
        error_callback:failure=>failed(failure.type==='popup_closed'?'Googleログインをキャンセルしました。':'Googleのログイン画面を開けません。ブラウザーでポップアップを許可して再度お試しください。')
      });
      try{client.requestAccessToken({prompt:'select_account'});}catch{failed('Googleログインを開始できませんでした。');}
    });
  }
  async function fetchBusy(range,signal){
    if(!connected()){logout();throw Error('Googleでログインしてから取得してください。認証期限が切れた場合も再ログインが必要です。');}
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    const timer=setTimeout(abort,20000);
    try{
      const response=await fetch(ENDPOINT,{
        method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({timeMin:range.start,timeMax:range.end,timeZone:'Asia/Tokyo',calendarExpansionMax:1,items:[{id:'primary'}]}),
        credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal
      });
      if(response.status===401){logout();throw Error('Googleの認証期限が切れました。再度ログインしてください。');}
      if(response.status===403)throw Error('Googleカレンダーへのアクセスが許可されていません。Google側の権限、テストユーザー、Calendar APIの設定を確認してください。');
      if(!response.ok)throw Error('Googleカレンダーを取得できませんでした。少し時間を置いて再度お試しください。');
      let data;try{data=await response.json();}catch{throw Error('Googleからの応答を確認できませんでした。再度取得してください。');}
      return window.TokiCalendarImport.readBusy(data,range);
    }catch(error){
      if(error.name==='AbortError')throw Error('取得を中止しました。通信状態を確認して再度お試しください。');
      if(error instanceof TypeError)throw Error('Googleカレンダーと通信できません。接続を確認してください。');
      throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  window.TokiGoogleCalendar={load,login,logout,fetchBusy,get configured(){return configured();},get connected(){return connected();}};
})();

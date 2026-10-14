const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('google-calendar.js','utf8'),scopes=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.freebusy'];
const range={start:'2026-10-03T08:00:00+09:00',end:'2026-10-04T00:00:00+09:00',timeMin:Date.parse('2026-10-03T08:00:00+09:00'),timeMax:Date.parse('2026-10-04T00:00:00+09:00')};
function environment(){
  let config,status=200,handler,access={access_token:'private-token',expires_in:3600},now=1000,granted=true,popupError=null,scopeChecks=[];const calls=[];
  const window={TOKI_CONFIG:{googleClientId:'123456-example.apps.googleusercontent.com'},google:{accounts:{oauth2:{initTokenClient:value=>{config=value;return {requestAccessToken(){queueMicrotask(()=>popupError?value.error_callback({type:popupError}):value.callback(access));}};},hasGrantedAllScopes:(response,...requested)=>{scopeChecks=requested;return granted;}}}}};
  vm.runInNewContext(fs.readFileSync('calendar-import.js','utf8'),{window});
  vm.runInNewContext(source,{window,location:{protocol:'https:'},Date:class extends Date{static now(){return now;}},URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{
    calls.push({url,options});if(options.signal.aborted)throw Object.assign(Error(),{name:'AbortError'});
    const body=options.body?JSON.parse(options.body):null;
    const response=handler?await handler(url,options):body?{timeMin:body.timeMin,timeMax:body.timeMax,calendars:Object.fromEntries(body.items.map(({id})=>[id,{busy:[]}]))}:{items:[]};
    return {ok:status===200,status,json:async()=>response};
  }});
  return {api:window.TokiGoogleCalendar,calls,get config(){return config;},get scopeChecks(){return scopeChecks;},respond:fn=>handler=fn,setStatus:n=>status=n,setAccess:a=>access=a,expire:()=>now+=3600000,setGranted:v=>granted=v,setPopupError:v=>popupError=v};
}
test('Google requests and verifies only calendar-list and accessible-calendar free/busy scopes',async()=>{
  const e=environment();await e.api.login();assert.equal(e.config.scope,scopes.join(' '));assert.deepEqual(e.scopeChecks,scopes);assert.equal(e.config.include_granted_scopes,false);assert.equal(e.api.connected,true);
});
test('only the exact range and selected calendars are sent to FreeBusy, with no event read or Tasks calls',async()=>{
  const e=environment();await e.api.login();await e.api.fetchBusy(range,['personal','shared']);
  const {url,options}=e.calls[0];assert.match(url,/calendar\/v3\/freeBusy\?/);assert.ok(!url.includes('private-token'));
  assert.equal(options.headers.Authorization,'Bearer private-token');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  assert.deepEqual(JSON.parse(options.body),{timeMin:range.start,timeMax:range.end,timeZone:'Asia/Tokyo',calendarExpansionMax:2,items:[{id:'personal'},{id:'shared'}]});
});
test('permission denial, expired credentials and logout prevent Calendar requests',async()=>{
  const e=environment();e.setGranted(false);await assert.rejects(e.api.login());assert.equal(e.api.connected,false);
  e.setGranted(true);await e.api.login();e.expire();await assert.rejects(e.api.fetchBusy({}));assert.equal(e.calls.length,0);
  await e.api.login();e.api.logout();assert.equal(e.api.connected,false);await assert.rejects(e.api.fetchBusy({}));
});
test('401 clears credentials and 403 is reported instead of returning empty busy data',async()=>{
  const a=environment();await a.api.login();a.setStatus(401);await assert.rejects(a.api.fetchBusy(range,['a']));assert.equal(a.api.connected,false);
  const b=environment();await b.api.login();b.setStatus(403);await assert.rejects(b.api.fetchBusy(range,['a']),/両方を許可/);
});

test('calendar listing follows every page, includes hidden calendars and keeps only display metadata',async()=>{
  const e=environment();await e.api.login();
  e.respond(url=>new URL(url).searchParams.has('pageToken')?{items:[{id:'mine',summary:'個人',primary:true,accessRole:'owner'},{id:'shared',summary:'共有',summaryOverride:'局A',accessRole:'reader',description:'discard'}]}:{nextPageToken:'next+/=&',items:[{id:'hidden',summary:'非表示',accessRole:'freeBusyReader'}]});
  const result=structuredClone(await e.api.listCalendars());assert.equal(result.length,3);assert.equal(result[0].id,'mine');assert.deepEqual(result.find(c=>c.id==='shared'),{id:'shared',name:'局A',primary:false});
  for(const {url,options} of e.calls){const parsed=new URL(url);assert.equal(parsed.pathname,'/calendar/v3/users/me/calendarList');assert.equal(parsed.searchParams.get('showHidden'),'true');assert.equal(parsed.searchParams.get('minAccessRole'),'freeBusyReader');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.ok(!parsed.searchParams.get('fields').includes('description'));}
  assert.equal(new URL(e.calls[1].url).searchParams.get('pageToken'),'next+/=&');
});

test('failed or malformed later pages never return a partial calendar list',async()=>{
  for(const failure of ['request','repeat','invalid']){
    const e=environment();await e.api.login();
    e.respond(url=>{if(new URL(url).searchParams.has('pageToken')){if(failure==='request'){e.setStatus(403);return {};}if(failure==='repeat')return {nextPageToken:'next',items:[]};return {items:[{id:null}]};}return {nextPageToken:'next',items:[{id:'a',summary:'A',accessRole:'owner'}]};});
    await assert.rejects(e.api.listCalendars());assert.equal(e.calls.length,2);
  }
});

test('Google holiday calendars are omitted across pages and languages without filtering ordinary names',async()=>{
  const e=environment();await e.api.login();
  e.respond(url=>new URL(url).searchParams.has('pageToken')?{items:[
    {id:'ja.japanese.official#holiday@group.v.calendar.google.com',summary:'日本の祝日',accessRole:'reader'},
    {id:'en.usa#holiday@group.v.calendar.google.com',summary:'Holidays in United States',accessRole:'reader'},
    {id:'japanese__ja@holiday.calendar.google.com',summary:'日本の祝日',accessRole:'reader'},
    {id:'team@group.calendar.google.com',summary:'日本の祝日',accessRole:'reader'}
  ]}:{nextPageToken:'next',items:[
    {id:'mine',summary:'個人',primary:true,accessRole:'owner'},
    {id:'ja.japanese#holiday@group.v.calendar.google.com',summary:'日本の祝日',summaryOverride:'変更した表示名',accessRole:'reader'},
    {id:'work',summary:'祝日の勤務シフト',accessRole:'owner'}
  ]});
  const calendars=structuredClone(await e.api.listCalendars());
  assert.deepEqual(calendars.map(c=>c.id).sort(),['mine','team@group.calendar.google.com','work']);
  assert.equal(calendars.find(c=>c.id==='team@group.calendar.google.com').name,'日本の祝日');
  assert.equal(e.calls.length,2);
});

test('holiday calendars are never sent to FreeBusy, including obsolete selections',async()=>{
  const e=environment();await e.api.login();
  const holidays=['ja.japanese#holiday@group.v.calendar.google.com','en.japanese.official#holiday@group.v.calendar.google.com','japanese__ja@holiday.calendar.google.com'];
  await e.api.fetchBusy(range,['personal',...holidays,'shared']);
  const body=JSON.parse(e.calls[0].options.body);
  assert.deepEqual(body.items,[{id:'personal'},{id:'shared'}]);assert.equal(body.calendarExpansionMax,2);
  await assert.rejects(e.api.fetchBusy(range,holidays),/祝日カレンダーは対象外/);
  assert.equal(e.calls.length,1);
});

test('an account containing only holiday calendars yields an empty selection rather than empty busy data',async()=>{
  const e=environment();await e.api.login();
  e.respond(()=>({items:[{id:'ja.japanese#holiday@group.v.calendar.google.com',summary:'日本の祝日',accessRole:'reader'}]}));
  const calendars=await e.api.listCalendars();assert.equal(calendars.length,0);
  await assert.rejects(e.api.fetchBusy(range,calendars.map(c=>c.id)),/1つ以上/);assert.equal(e.calls.length,1);
});

test('more than 50 selected calendars are batched without skipping or duplicating IDs',async()=>{
  const e=environment();await e.api.login();const ids=Array.from({length:101},(_,i)=>'calendar-'+i);
  assert.equal((await e.api.fetchBusy(range,[...ids,ids[0]])).length,0);
  const batches=e.calls.map(c=>JSON.parse(c.options.body));assert.deepEqual(batches.map(b=>b.calendarExpansionMax),[50,50,1]);assert.deepEqual(batches.flatMap(b=>b.items.map(x=>x.id)),ids);
});

test('an error or missing calendar in a later batch rejects the whole import',async()=>{
  const e=environment();await e.api.login();e.respond((url,options)=>{const body=JSON.parse(options.body);return {timeMin:body.timeMin,timeMax:body.timeMax,calendars:Object.fromEntries(body.items.map(({id})=>[id,id==='c50'?{errors:[{reason:'notFound'}]}:{busy:[]}]))};});
  await assert.rejects(e.api.fetchBusy(range,Array.from({length:51},(_,i)=>'c'+i)),/一部/);assert.equal(e.calls.length,2);
});

test('no selection makes no request; cancellation and account changes discard in-flight results',async()=>{
  const e=environment();await e.api.login();await assert.rejects(e.api.fetchBusy(range,[]),/1つ以上/);assert.equal(e.calls.length,0);
  const controller=new AbortController();controller.abort();await assert.rejects(e.api.listCalendars(controller.signal),/中止/);
  e.respond(()=>{e.api.logout();return {items:[]};});await assert.rejects(e.api.listCalendars(),/変更/);assert.equal(e.api.connected,false);
});
test('access_denied explains test-user registration and allows a clean retry',async()=>{
  const e=environment();e.setAccess({error:'access_denied',error_description:'untrusted response'});
  await assert.rejects(e.api.login(),error=>/テストユーザー登録/.test(error.message)&&!error.message.includes('untrusted response'));
  assert.equal(e.api.connected,false);assert.equal(e.calls.length,0);
  e.setAccess({access_token:'private-token',expires_in:3600});await e.api.login();assert.equal(e.api.connected,true);
});
test('closing an error popup does not falsely claim the user cancelled',async()=>{
  const e=environment();e.setPopupError('popup_closed');
  await assert.rejects(e.api.login(),error=>/画面が閉じられました/.test(error.message)&&/テストユーザー登録/.test(error.message)&&!error.message.includes('キャンセルしました'));
  assert.equal(e.api.connected,false);e.setPopupError(null);await e.api.login();assert.equal(e.api.connected,true);
});
test('only popup-blocking errors advise allowing popups',async()=>{
  const e=environment();e.setPopupError('popup_failed_to_open');await assert.rejects(e.api.login(),/ポップアップを許可/);
  e.setPopupError('unknown');await assert.rejects(e.api.login(),error=>!error.message.includes('ポップアップを許可'));
});

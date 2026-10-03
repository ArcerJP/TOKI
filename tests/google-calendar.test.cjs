const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('google-calendar.js','utf8'),scope='https://www.googleapis.com/auth/calendar.freebusy';
function environment(){
  let config,status=200,response={},access={access_token:'private-token',expires_in:3600},now=1000,granted=true;const calls=[];
  const window={TOKI_CONFIG:{googleClientId:'123456-example.apps.googleusercontent.com'},TokiCalendarImport:{readBusy:data=>data},google:{accounts:{oauth2:{initTokenClient:value=>{config=value;return {requestAccessToken(){queueMicrotask(()=>value.callback(access));}};},hasGrantedAllScopes:()=>granted}}}};
  vm.runInNewContext(source,{window,location:{protocol:'https:'},Date:{now:()=>now},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,options});return {ok:status===200,status,json:async()=>response};}});
  return {api:window.TokiGoogleCalendar,calls,get config(){return config;},setStatus:n=>status=n,setAccess:a=>access=a,expire:()=>now+=3600000,setGranted:v=>granted=v};
}
test('Google is the only login provider and requests only free/busy permission',async()=>{
  const e=environment();await e.api.login();assert.equal(e.config.scope,scope);assert.equal(e.config.include_granted_scopes,false);assert.equal(e.api.connected,true);
});
test('only the exact requested range and primary calendar are sent to FreeBusy',async()=>{
  const e=environment();await e.api.login();const range={start:'2026-10-03T08:00:00+09:00',end:'2026-10-04T00:00:00+09:00'};await e.api.fetchBusy(range);
  const {url,options}=e.calls[0];assert.match(url,/calendar\/v3\/freeBusy\?/);assert.ok(!url.includes('private-token'));
  assert.equal(options.headers.Authorization,'Bearer private-token');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  assert.deepEqual(JSON.parse(options.body),{timeMin:range.start,timeMax:range.end,timeZone:'Asia/Tokyo',calendarExpansionMax:1,items:[{id:'primary'}]});
});
test('permission denial, expired credentials and logout prevent Calendar requests',async()=>{
  const e=environment();e.setGranted(false);await assert.rejects(e.api.login());assert.equal(e.api.connected,false);
  e.setGranted(true);await e.api.login();e.expire();await assert.rejects(e.api.fetchBusy({}));assert.equal(e.calls.length,0);
  await e.api.login();e.api.logout();assert.equal(e.api.connected,false);await assert.rejects(e.api.fetchBusy({}));
});
test('401 clears credentials and 403 is reported instead of returning empty busy data',async()=>{
  const a=environment();await a.api.login();a.setStatus(401);await assert.rejects(a.api.fetchBusy({}));assert.equal(a.api.connected,false);
  const b=environment();await b.api.login();b.setStatus(403);await assert.rejects(b.api.fetchBusy({}));
});

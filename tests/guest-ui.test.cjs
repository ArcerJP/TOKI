const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('jsdom');
const {sourcePath}=require('../scripts/pwa-assets.cjs');

test('guest launch secures the URL, restores a read-only cache, and clears it on revoked access',async t=>{
  const org='A'.repeat(32),invite='b'.repeat(64),key='toki-guest-v1:'+org;
  const site='https://example.test/TOKI/';
  const row='00000000-0000-4000-8000-000000000001';
  const result={company:{id:'organization',name:'Test organization'},guest:{id:'guest',name:'Test person'},
    board:{companyId:'organization',version:1,access:{role:'guest',personId:row},
      payload:{schemaVersion:4,people:['Test person'],groups:[],events:[],meetings:[],rows:[{id:row,kind:'person'}]}}};
  function create(url){
    const dom=new JSDOM('',{url,runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window;
    Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
    w.TOKI_CONFIG={siteUrl:site,url:'https://example.supabase.co',publishableKey:'test-public-key'};
    w.setInterval=()=>0;
    for(const name of ['model','guest','shared'])w.eval(fs.readFileSync(sourcePath(name+'.js'),'utf8'));
    return w;
  }
  const w=create(site+'?guest='+org+'#invite='+invite),calls=[];
  w.fetch=async(url,options)=>{
    calls.push({url,...JSON.parse(options.body)});
    return {ok:true,status:200,json:async()=>structuredClone(result)};
  };
  const first=[];
  await w.TokiShared.initialize({board:board=>first.push(board)});
  assert.equal(w.TokiShared.guest,true);
  assert.equal(w.location.hash,'');
  assert.equal(w.TokiShared.company.role,'guest');
  assert.equal(w.TokiShared.scope,'guest:guest:organization');
  assert.deepEqual(first,[result.board]);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/\/rpc\/toki_guest$/);
  assert.equal(calls[0].p_action,'claim');
  assert.equal(calls[0].p_invite,invite);
  assert.match(calls[0].p_token,/^[0-9a-f]{64}$/);
  assert.equal(w.sessionStorage.length,0);
  const cache=w.localStorage.getItem(key);
  assert.equal(cache.includes(invite),false);
  const reopened=create(site+'?guest='+org+'#invite='+invite);
  reopened.localStorage.setItem(key,cache);
  reopened.fetch=async(url,options)=>{
    const request=JSON.parse(options.body);
    assert.equal(request.p_action,'read');
    assert.equal(request.p_invite,undefined);
    assert.equal(request.p_token,calls[0].p_token);
    return {ok:true,status:200,json:async()=>structuredClone(result)};
  };
  await reopened.TokiShared.initialize({});
  assert.equal(reopened.TokiShared.online,true);

  const device=create(site+'?guest='+org),cached=[],errors=[];
  device.localStorage.setItem(key,cache);
  Object.defineProperty(device.navigator,'onLine',{value:false,configurable:true});
  device.fetch=async()=>{throw Error('Offline must not fetch');};
  await device.TokiShared.initialize({board:board=>cached.push(board),error:error=>errors.push(error.code)});
  assert.equal(device.TokiShared.online,false);
  assert.deepEqual(JSON.parse(JSON.stringify(cached)),[result.board]);
  await assert.rejects(device.TokiShared.save(result.board.payload,1),{code:'NETWORK'});

  Object.defineProperty(device.navigator,'onLine',{value:true,configurable:true});
  device.fetch=async()=>({ok:false,status:403,json:async()=>({message:'GUEST_ACCESS',code:'TOKI_GUEST_ACCESS'})});
  await device.TokiShared.refresh();
  assert.equal(device.localStorage.getItem(key),null);
  assert.equal(device.TokiShared.company,null);
  assert.equal(errors.at(-1),'GUEST_ACCESS');
});

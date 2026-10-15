const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
const authStorage=require('../auth-storage.js');
const key='sb-audit-auth-token',config={url:'https://audit.invalid',publishableKey:'audit-public-key'};
const session=expired=>JSON.stringify({access_token:'audit-only-access-token',refresh_token:'audit-only-refresh-token',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+(expired?-3600:3600),user:{id:'00000000-0000-4000-8000-000000000001',email:'audit@example.test',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'}});
function storage(){const values=new Map();return {values,get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}

test('logout erases tokens and PKCE immediately; old tabs and late refreshes cannot restore them',()=>{
  const store=storage(),first=authStorage.create(store,key),other=authStorage.create(store,key);
  store.setItem(key,session(true));store.setItem(key+'-code-verifier','private');store.setItem(key+'-user','private');store.setItem('another-app','keep');
  const snapshot=first.invalidate();assert.ok(snapshot);assert.equal(store.getItem(key),null);assert.equal(store.getItem(key+'-code-verifier'),null);assert.equal(store.getItem(key+'-user'),null);
  assert.equal(first.active,false);assert.equal(other.active,false);
  other.adapter.setItem(key,session(false));first.adapter.setItem(key,session(false));assert.equal(store.getItem(key),null);
  const reloaded=authStorage.create(store,key);assert.equal(reloaded.adapter.getItem(key),null);
  reloaded.adapter.setItem(key,'new-login');other.adapter.removeItem(key);assert.equal(store.getItem(key),'new-login');assert.equal(store.getItem('another-app'),'keep');
});

test('an expired session and refresh outage cannot restore disk credentials after logout with the real SDK',async()=>{
  const store=storage(),guard=authStorage.create(store,key);store.setItem(key,session(true));
  const captured=guard.invalidate();let attempts=0;
  const ok=await authStorage.revoke(createClient,config,captured,{global:{fetch:async()=>{attempts++;return new Response(JSON.stringify({message:'Simulated outage'}),{status:503,headers:{'Content-Type':'application/json'}});}}});
  assert.equal(ok,false);assert.ok(attempts>0);assert.equal(store.getItem(key),null);
  const reloaded=createClient(config.url,config.publishableKey,{auth:{storageKey:key,storage:authStorage.create(store,key).adapter,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async()=>{throw Error('A logged-out page must not refresh');}}});
  try{assert.equal((await reloaded.auth.getSession()).data.session,null);}finally{await reloaded.auth.dispose();}
});

test('online revocation refreshes an expired token in memory and ends only that server session',async()=>{
  const calls=[];
  const ok=await authStorage.revoke(createClient,config,session(true),{global:{fetch:async(url,options)=>{
    calls.push({url:String(url),auth:options.headers.Authorization});
    if(String(url).includes('/token?'))return new Response(JSON.stringify({...JSON.parse(session(false)),expires_in:3600}),{status:200,headers:{'Content-Type':'application/json'}});
    return new Response(null,{status:204});
  }}});
  assert.equal(ok,true);assert.ok(calls.some(c=>c.url.includes('/token?')));assert.ok(calls.some(c=>c.url.endsWith('/logout?scope=local')));
});

test('revocation setup and cleanup failures never restore credentials or reject the logout task',async()=>{
  assert.equal(await authStorage.revoke(()=>{throw Error('SDK unavailable');},config,session(false)),false);
  let memory;
  assert.equal(await authStorage.revoke((_url,_key,options)=>{
    memory=options.auth.storage;
    memory.setItem('probe','ephemeral');
    return {auth:{signOut:async()=>({error:null}),dispose:async()=>{throw Error('Cleanup failed');}}};
  },config,session(false)),true);
  assert.equal(memory.getItem('probe'),null);
});

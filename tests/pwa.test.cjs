const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {assets,worker}=require('../scripts/pwa-assets.cjs');
const scope='https://example.test/TOKI/';
function environment(){
  const handlers={},stores=new Map(),deleted=[],requests=[];let claimed=false,skipped=false,fetches=0;
  const caches={
    async open(name){if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);return {
      async addAll(list){for(const request of list){requests.push(request);values.set(request.url,{body:request.url});}},
      async match(url){return values.get(url);}
    };},
    async keys(){return [...stores.keys()];},async delete(name){deleted.push(name);return stores.delete(name);}
  };
  const self={registration:{scope},clients:{async claim(){claimed=true;}},async skipWaiting(){skipped=true;},addEventListener:(name,fn)=>{handlers[name]=fn;}};
  vm.runInNewContext(worker(),{self,caches,Request,URL,fetch:async()=>{fetches++;throw Error('Offline');}});
  async function lifecycle(name,data){let promise;handlers[name]({data,waitUntil:p=>{promise=p;}});await promise;}
  function fetch(url,extra={}){let result;handlers.fetch({request:{url,method:'GET',mode:'cors',...extra},respondWith:p=>{result=p;}});return result;}
  return {stores,deleted,requests,lifecycle,fetch,get fetches(){return fetches;},get claimed(){return claimed;},get skipped(){return skipped;}};
}
test('manifest has scoped start URL and correctly sized PNG icons',()=>{
  const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest'));
  assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
  assert.equal(manifest.id,'./');assert.ok(!JSON.stringify(manifest).includes('#share'));
  for(const icon of manifest.icons){const png=fs.readFileSync(icon.src);const [w,h]=icon.sizes.split('x').map(Number);assert.equal(png.readUInt32BE(16),w);assert.equal(png.readUInt32BE(20),h);}
  assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));
});
test('worker caches a complete version and serves a scoped offline navigation',async()=>{
  const e=environment();await e.lifecycle('install');
  assert.equal(e.requests.length,assets.length);assert.ok(e.requests.every(r=>r.cache==='reload'));
  const response=await e.fetch(scope+'?mode=shared',{mode:'navigate'});
  assert.equal(response.body,scope+'index.html');assert.equal(e.fetches,0);
  assert.equal((await e.fetch(scope+'vendor/supabase.js')).body,scope+'vendor/supabase.js');
});
test('API calls, private files and other Pages projects bypass the cache',async()=>{
  const e=environment();await e.lifecycle('install');
  for(const url of ['https://example.supabase.co/rest/v1/rpc/toki_share',scope+'data.local.js',scope+'tmp/share-access.json','https://example.test/another/'])assert.equal(e.fetch(url),undefined);
  assert.equal(e.fetch(scope+'app.js',{method:'POST'}),undefined);
});
test('activation removes only older caches for this exact app scope',async()=>{
  const e=environment();await e.lifecycle('install');
  const old=`toki-shell:${scope}:old`,other='toki-shell:https://example.test/other/:old';e.stores.set(old,new Map());e.stores.set(other,new Map());
  await e.lifecycle('activate');assert.deepEqual(e.deleted,[old]);assert.equal(e.claimed,true);assert.equal(e.stores.has(other),true);
  assert.equal(e.skipped,false);await e.lifecycle('message',{type:'ACTIVATE_UPDATE'});assert.equal(e.skipped,true);
});
test('generated worker has a content fingerprint and a public-only asset list',()=>{
  const source=worker();assert.ok(!source.includes('__TOKI_BUILD__'));assert.ok(!source.includes('/* TOKI_ASSETS */'));
  assert.match(source,/PREFIX \+ '[a-f0-9]{16}'/);assert.ok(assets.every(f=>!f.includes('local')&&!f.includes('tmp/')&&!f.includes('database/')));
});

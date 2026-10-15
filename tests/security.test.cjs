const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),http=require('node:http');
const {JSDOM}=require('jsdom');
test('untrusted company and Google profile names render as text, never HTML',async t=>{
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test',runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
  const name='<img src=x onerror="alert(1)">',company={id:'a',name,code:'a'.repeat(32),role:'admin',status:'active'};
  w.TokiShared={enabled:true,companyAccess:true,user:{email:'admin@example.test'},company,companies:[company],pendingCode:'',manage:async()=>({members:[{id:'u',name,email:'member@example.test',role:'member',status:'active'}],invites:[]})};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.eval(fs.readFileSync('company-ui.js','utf8'));w.TokiCompanyUI().render();await d.getElementById('company-button').onclick();
  assert.equal(d.querySelectorAll('img,script:not([src])').length,0);assert.equal(d.getElementById('company-dialog-title').textContent,name);assert.ok(d.getElementById('company-members').textContent.includes(name));
});
test('only top-level pages expose the UI; published scripts match the explicit CSP',()=>{
  const source=fs.readFileSync('security.js','utf8');
  for(const framed of [false,true]){
    const self={},attrs=[];vm.runInNewContext(source,{window:{self,top:framed?{}:self},document:{documentElement:{setAttribute:(...x)=>attrs.push(x)}}});
    assert.equal(attrs.length,framed?0:1);
  }
  const dom=new JSDOM(fs.readFileSync('index.html','utf8')),d=dom.window.document;
  const policy=d.querySelector('[http-equiv="Content-Security-Policy"]').content;
  assert.match(policy,/script-src 'self' https:\/\/accounts.google.com\/gsi\/client;/);
  assert.ok(!policy.includes('unsafe-eval'));assert.match(policy,/base-uri 'none'/);assert.match(policy,/form-action 'none'/);
  assert.equal(d.querySelectorAll('script:not([src])').length,0);assert.equal(d.querySelectorAll('[onclick],[onerror],[onload]').length,0);
  assert.equal(d.querySelector('#company-create-button'),null);assert.match(fs.readFileSync('styles.css','utf8'),/html:not\(\[data-toki-top-level\]\)\{display:none!important\}/);
  dom.window.close();
});
test('local preview rejects hostile Host/Origin headers and never exposes inherited object properties or private files',async t=>{
  const server=require('../serve.cjs').createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  const request=(path,headers={})=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path,headers},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));}).on('error',reject);});
  assert.equal((await request('/',{Host:'evil.example'})).status,403);
  assert.equal((await request('/',{Origin:'https://evil.example'})).status,403);
  for(const path of ['/constructor','/__proto__','/toString','/.env','/database/companies.sql','/docs/company-access.md','/../.git/config'])assert.equal((await request(path)).status,404,path);
  const result=await request('/');assert.equal(result.status,200);assert.equal(result.headers['cross-origin-resource-policy'],'same-origin');assert.equal(result.headers['x-frame-options'],'DENY');
});

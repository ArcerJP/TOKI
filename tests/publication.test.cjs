const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),cp=require('node:child_process');
const {JSDOM}=require('jsdom');
const {root,assets,sourcePath,worker}=require('../scripts/pwa-assets.cjs');

test('published HTML and manifest resolve all local resources at the existing public URLs',()=>{
  const dom=new JSDOM(fs.readFileSync(sourcePath('index.html'),'utf8'));
  try{
    for(const element of dom.window.document.querySelectorAll('script[src],link[href]')){
      const url=element.getAttribute('src')||element.getAttribute('href');
      if(/^(?:data:|https?:|#)/.test(url))continue;
      assert.ok(assets.includes(url),url);assert.ok(fs.statSync(sourcePath(url)).isFile(),url);
    }
    const manifest=JSON.parse(fs.readFileSync(sourcePath('manifest.webmanifest'),'utf8'));
    for(const icon of manifest.icons)assert.ok(fs.statSync(sourcePath(icon.src)).isFile(),icon.src);
    for(const invalid of ['__proto__','constructor','../.env','local/data.local.js','public/index.html'])assert.throws(()=>sourcePath(invalid),/Unknown public asset/);
  }finally{dom.window.close();}
});

test('site packaging emits only allowlisted public paths with exact source contents',()=>{
  cp.execFileSync(process.execPath,[path.join(root,'scripts/prepare-site.cjs')],{cwd:root});
  const output=path.join(root,'site');
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):[path.relative(output,path.join(dir,d.name)).replaceAll('\\','/')]);
  assert.deepEqual(walk(output).sort(),[...assets,'sw.js'].sort());
  for(const name of assets)assert.deepEqual(fs.readFileSync(path.join(output,name)),fs.readFileSync(sourcePath(name)),name);
  assert.equal(fs.readFileSync(path.join(output,'sw.js'),'utf8'),worker());
});

test('local preview serves the same public resources while source and private directories stay inaccessible',async t=>{
  const server=require('../serve.cjs').createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=url=>new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port:server.address().port,path:url},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
    }).on('error',reject);
  });
  for(const name of assets){const result=await request('/'+name);assert.equal(result.status,200,name);assert.deepEqual(result.body,fs.readFileSync(sourcePath(name)),name);}
  const sw=await request('/sw.js');assert.equal(sw.status,200);assert.equal(sw.body.toString(),worker());
  const home=await request('/');assert.equal(home.status,200);assert.deepEqual(home.body,fs.readFileSync(sourcePath('index.html')));
  for(const url of ['/src/app/app.js','/public/index.html','/local/data.local.js','/local/README.md','/scripts/pwa-assets.cjs','/AGENTS.md','/package.json','/tmp/legacy-root-20261015/preview.png'])assert.equal((await request(url)).status,404,url);
});

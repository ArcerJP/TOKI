// Optional local preview: node serve.cjs. The app also opens directly from index.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {assets, worker} = require('./scripts/pwa-assets.cjs');
const files = Object.fromEntries(assets.map(file=>['/'+file,file]));
files['/']='index.html'; files['/data.local.js']='data.local.js';
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.txt':'text/plain; charset=utf-8'};
http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/sw.js'){res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'});res.end(worker());return;}
  const file=files[pathname];
  if(!file || !fs.existsSync(path.join(__dirname,file))){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});
  fs.createReadStream(path.join(__dirname,file)).pipe(res);
}).listen(4173,'127.0.0.1',()=>console.log('TOKI: http://127.0.0.1:4173'));

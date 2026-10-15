// Local preview: node serve.cjs. Public URLs are independent of source locations.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {assets, sourcePath, worker} = require('./scripts/pwa-assets.cjs');
const files = new Map(assets.map(file=>['/'+file,sourcePath(file)]));
files.set('/',sourcePath('index.html'));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.txt':'text/plain; charset=utf-8'};
function createServer(){return http.createServer((req,res)=>{
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"frame-ancestors 'none'");
  // Prevent DNS rebinding from turning the local preview into a private-data endpoint.
  const origins=['http://127.0.0.1:'+req.socket.localPort,'http://localhost:'+req.socket.localPort];
  if(!origins.includes('http://'+req.headers.host)||req.headers.origin&&!origins.includes(req.headers.origin)){
    res.writeHead(403);res.end('Forbidden');return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end('Bad request');return;}
  if(pathname==='/sw.js'){res.writeHead(200,{'Content-Type':types['.js'],'Cache-Control':'no-store'});res.end(worker());return;}
  const privateFile=path.join(__dirname,'local/data.local.js');
  const file=pathname==='/data.local.js'?(fs.existsSync(privateFile)?privateFile:path.join(__dirname,'data.local.js')):files.get(pathname);
  if(!file || !fs.existsSync(file)){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
});}
module.exports={createServer};
if(require.main===module)createServer().listen(4173,'127.0.0.1',()=>console.log('TOKI: http://127.0.0.1:4173'));

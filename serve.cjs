// Optional local preview: node serve.cjs. The app also opens directly from index.html.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = {'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/model.js':'model.js','/row-drag.js':'row-drag.js','/data.js':'data.js','/data.local.js':'data.local.js','/config.js':'config.js','/shared.js':'shared.js','/vendor/supabase.js':'vendor/supabase.js'};
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
http.createServer((req,res)=>{
  const file=files[new URL(req.url,'http://localhost').pathname];
  if(!file || !fs.existsSync(path.join(__dirname,file))){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});
  fs.createReadStream(path.join(__dirname,file)).pipe(res);
}).listen(4173,'127.0.0.1',()=>console.log('TOKI: http://127.0.0.1:4173'));

const fs = require('node:fs');
const path = require('node:path');
require('esbuild').buildSync({entryPoints:['vendor-entry.js'],bundle:true,format:'iife',globalName:'TokiSupabase',platform:'browser',target:'es2022',minify:true,outfile:'vendor/supabase.js'});
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const notices=[];
for(const [dir,metadata] of Object.entries(lock.packages)){
  if(!dir||!dir.startsWith('node_modules/')||metadata.dev)continue;
  const license=['LICENSE','LICENSE.md','LICENSE.txt'].map(name=>path.join(dir,name)).find(file=>fs.existsSync(file));
  if(license)notices.push(`${dir.replace('node_modules/','')} ${metadata.version}\n${fs.readFileSync(license,'utf8')}`);
}
fs.writeFileSync('vendor/supabase.js.LEGAL.txt',notices.join('\n\n----------------------------------------\n\n'));

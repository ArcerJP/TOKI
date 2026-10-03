const fs = require('node:fs');
const path = require('node:path');
const {root, assets, worker} = require('./pwa-assets.cjs');
const output = path.join(root, 'site');
// Recreate only this generated directory to avoid publishing leftover files.
if (path.dirname(path.resolve(output)) !== root || path.basename(output) !== 'site') throw Error('Invalid output directory');
fs.rmSync(output, {recursive:true, force:true});
for (const file of assets) {
  const destination = path.join(output, file);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.copyFileSync(path.join(root, file), destination);
}
fs.writeFileSync(path.join(output, 'sw.js'), worker());
console.log(`Prepared ${assets.length + 1} public files in site/`);

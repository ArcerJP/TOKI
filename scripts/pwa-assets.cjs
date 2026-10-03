// The same allowlist controls publication, local serving and offline caching.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const assets = [
  'index.html', 'styles.css', 'app.js', 'model.js', 'row-drag.js', 'data.js',
  'config.js', 'shared.js', 'pwa.js', 'manifest.webmanifest',
  'availability.js', 'schedule.js', 'availability-ui.js', 'meeting-menu.js', 'meeting-export-ui.js',
  'calendar-import.js', 'google-calendar.js', 'google-import-ui.js',
  'mobile.css', 'mobile-model.js', 'mobile-ui.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'vendor/supabase.js', 'vendor/supabase.js.LEGAL.txt'
];
function worker() {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const hash = createHash('sha256').update(source);
  for (const file of assets) hash.update(file).update(fs.readFileSync(path.join(root, file)));
  return source.replace('__TOKI_BUILD__', hash.digest('hex').slice(0, 16))
    .replace('/* TOKI_ASSETS */ []', JSON.stringify(assets));
}
module.exports = {root, assets, worker};

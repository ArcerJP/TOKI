// Public URLs stay stable while development files are organized by responsibility.
// This allowlist controls publication, local serving and offline caching.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const sources = Object.freeze({
  'index.html': 'public/index.html',
  'styles.css': 'src/ui/styles.css',
  'security.js': 'src/app/security.js',
  'app.js': 'src/app/app.js',
  'model.js': 'src/core/model.js',
  'row-drag.js': 'src/ui/row-drag.js',
  'data.js': 'src/app/data.js',
  'config.js': 'public/config.js',
  'auth-storage.js': 'src/auth/auth-storage.js',
  'shared.js': 'src/auth/shared.js',
  'pwa.js': 'src/app/pwa.js',
  'manifest.webmanifest': 'public/manifest.webmanifest',
  'availability.js': 'src/core/availability.js',
  'schedule.js': 'src/core/schedule.js',
  'availability-ui.js': 'src/ui/availability-ui.js',
  'meeting-menu.js': 'src/meetings/meeting-menu.js',
  'meeting-export-ui.js': 'src/meetings/meeting-export-ui.js',
  'calendar-import.js': 'src/calendar/calendar-import.js',
  'google-calendar.js': 'src/calendar/google-calendar.js',
  'google-import-ui.js': 'src/calendar/google-import-ui.js',
  'mobile.css': 'src/ui/mobile.css',
  'mobile-model.js': 'src/core/mobile-model.js',
  'mobile-ui.js': 'src/ui/mobile-ui.js',
  'company.css': 'src/auth/company.css',
  'company-ui.js': 'src/auth/company-ui.js',
  'group-view.js': 'src/ui/group-view.js',
  'icons/icon-192.png': 'public/icons/icon-192.png',
  'icons/icon-512.png': 'public/icons/icon-512.png',
  'icons/maskable-512.png': 'public/icons/maskable-512.png',
  'icons/apple-touch-icon.png': 'public/icons/apple-touch-icon.png',
  'vendor/supabase.js': 'public/vendor/supabase.js',
  'vendor/supabase.js.LEGAL.txt': 'public/vendor/supabase.js.LEGAL.txt'
});
const assets = Object.freeze(Object.keys(sources));
function sourcePath(file) {
  if (!Object.hasOwn(sources, file)) throw Error('Unknown public asset');
  return path.join(root, sources[file]);
}
function worker() {
  const source = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  const hash = createHash('sha256').update(source);
  for (const file of assets) hash.update(file).update(fs.readFileSync(sourcePath(file)));
  return source.replace('__TOKI_BUILD__', hash.digest('hex').slice(0, 16))
    .replace('/* TOKI_ASSETS */ []', JSON.stringify(assets));
}
module.exports = {root, sources, assets, sourcePath, worker};

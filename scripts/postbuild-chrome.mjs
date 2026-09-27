import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('dist-chrome/manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.background && manifest.background.service_worker) {
    manifest.background.scripts = [manifest.background.service_worker];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(
      'Added background.scripts fallback to dist-chrome/manifest.json for cross-browser validation'
    );
  }
}

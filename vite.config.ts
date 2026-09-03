import { defineConfig, Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.ts';

import fs from 'node:fs';
import path from 'node:path';

const firefoxManifestCompat = (): Plugin => ({
  name: 'firefox-manifest-compat',
  enforce: 'post',
  closeBundle() {
    if (process.env.BROWSER !== 'chrome') {
      const manifestPath = path.resolve('dist', 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.web_accessible_resources)) {
          parsed.web_accessible_resources.forEach((res: any) => {
            delete res.use_dynamic_url;
          });
          fs.writeFileSync(manifestPath, JSON.stringify(parsed, null, 2), 'utf-8');
        }
      }
    }
  },
});

export default defineConfig({
  plugins: [
    crx({ manifest }),
    firefoxManifestCompat(),
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        sidepanel: path.resolve('src/sidepanel/sidepanel.html'),
      },
    },
  },
});

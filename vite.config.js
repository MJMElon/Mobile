import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { readFileSync, readdirSync, writeFileSync } from 'fs';

/* Injects the built file list into dist/sw.js after every build — the five
   pages plus every content-hashed chunk, whose names change per deploy so
   the worker cannot carry a hardcoded list. VER becomes a per-build stamp
   (every deploy opens a fresh cache and re-seeds it). Without this, only
   pages somebody had opened while online worked offline. Same plugin, same
   reason, as the FC Portal's vite.config.js. */
function swPrecache() {
  return {
    name: 'sw-precache-manifest',
    closeBundle() {
      const dist = resolve(__dirname, 'dist');
      let files;
      try {
        files = readdirSync(resolve(dist, 'assets')).map((f) => './assets/' + f);
      } catch (e) {
        return;
      }
      const list = [
        './', './index.html', './auth.html', './booking.html',
        './consent.html', './do_signing.html',
        ...files,
      ];
      const swPath = resolve(dist, 'sw.js');
      let sw;
      try {
        sw = readFileSync(swPath, 'utf8');
      } catch (e) {
        return;
      }
      sw = sw
        .replace("const VER = 'mjm-mobile-dev';", `const VER = 'mjm-mobile-${Date.now().toString(36)}';`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(list)};`);
      writeFileSync(swPath, sw);
      console.log(`[sw-precache] ${list.length} files injected into sw.js`);
    },
  };
}

// Multi-page app — one HTML entry per existing page so the public URLs
// (mobile.mjmnursery.com/booking.html, /consent.html, …) stay identical
// and no existing links/bookmarks break.
export default defineConfig({
  plugins: [react(), swPrecache()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        auth: resolve(__dirname, 'auth.html'),
        booking: resolve(__dirname, 'booking.html'),
        consent: resolve(__dirname, 'consent.html'),
        do_signing: resolve(__dirname, 'do_signing.html'),
      },
    },
  },
});

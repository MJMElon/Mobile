import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Multi-page app — one HTML entry per existing page so the public URLs
// (mobile.mjmnursery.com/booking.html, /consent.html, …) stay identical
// and no existing links/bookmarks break.
export default defineConfig({
  plugins: [react()],
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

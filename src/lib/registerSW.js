// Registers the offline app-shell service worker (public/sw.js → /sw.js).
// Called once from every entry file, so all five pages (index, auth, booking,
// consent, do_signing) end up covered by the same cache regardless of which
// one somebody happens to open first.
export function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[sw] registration failed (the app still works, just not offline):', e);
    });
  });
}

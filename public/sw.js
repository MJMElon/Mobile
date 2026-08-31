/* MJM Nursery AI — Mobile Ops Portal — offline app shell.
 *
 * Vite fingerprints every JS/CSS file per build, so there is no fixed file
 * list to precache the way a static site's service worker can (see
 * mjm-ai-system/audit/audit_sw.js for that version, on unhashed filenames).
 * This one caches whatever gets fetched, the first time it is fetched, and
 * serves that copy back whenever the network is not there to ask. A page
 * nobody has opened yet still cannot work offline — nothing can hand back a
 * copy that was never fetched — but every page opened once while there was
 * signal keeps working after, which is the case this exists for: an admin
 * who has used the portal before losing signal in the field, not a phone
 * that has never seen it.
 *
 * Supabase is never touched here — not cached, not intercepted — so a
 * request against it fails exactly the way it would with no service worker
 * at all, and the app's own code decides what that means.
 */
const VER = 'mjm-mobile-1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (!url.startsWith('http')) return;
  if (url.includes('supabase.co')) return;

  const isHTML = e.request.mode === 'navigate'
    || url.endsWith('.html')
    || (e.request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    /* Network first — an admin with signal always gets the build that is
       actually live, not a stale copy from the last time they had none.
       Only falls back to the cache when the network fails outright. */
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(VER).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        /* ignoreSearch: a page opened with query params (a deep link, a
           cache-buster) is still the same cached page offline. */
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  /* JS / CSS / images / fonts: cache first for speed, refreshed in the
     background so the next load (online) picks up a new deploy. */
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(VER).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => null);
      return cached || fetchPromise;
    })
  );
});

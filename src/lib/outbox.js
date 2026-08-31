/**
 * Work saved with no signal.
 *
 * Shared verbatim with the FC Portal repository (Barcode_Counter,
 * src/lib/outbox.js) — change one, change the other.
 *
 * A nursery is a place with patchy coverage, and a save that throws is a
 * morning's work gone. Every record goes into this queue first and is sent
 * from there — so the same path runs whether the phone has a bar or not, and
 * there is no separate "offline mode" to be in the wrong one of.
 *
 * IndexedDB rather than localStorage: a queued record carries its photos, and
 * localStorage's five megabytes would be gone in a dozen of them.
 *
 * Each job is given a `uid` when it is queued, and that uid goes to the server
 * with the row. If a flush is cut off after the server wrote the row but
 * before the job was removed, the retry hits a unique index and is treated as
 * already done rather than posting the work twice.
 */

const DB_NAME = 'mjm_outbox';
const DB_VERSION = 1;
const STORE = 'jobs';

let _db = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'uid' });
        s.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** A client-side id, so a job can be recognised again after a failed flush. */
export function newUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Put one job on the queue. Returns its uid. */
export async function queueJob(kind, payload) {
  const job = { uid: newUid(), kind, payload, createdAt: Date.now(), tries: 0, lastError: null };
  await tx('readwrite', (s) => s.put(job));
  return job.uid;
}

/** Everything waiting, oldest first. */
export async function listJobs() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeJob(uid) {
  await tx('readwrite', (s) => s.delete(uid));
}

async function noteFailure(uid, message) {
  const job = await tx('readonly', (s) => s.get(uid));
  if (!job) return;
  job.tries = (job.tries || 0) + 1;
  job.lastError = String(message || '').slice(0, 300);
  await tx('readwrite', (s) => s.put(job));
}

/**
 * Send everything queued.
 *
 * `handlers` is { kind: async (payload, uid) => void }. A handler that
 * returns without throwing means the work is on the server and the job is
 * dropped. A handler that throws leaves the job where it is, to be tried
 * again — except where it throws PERMANENT, which means the server refused
 * the work itself and retrying would only refuse it again.
 *
 * Runs one at a time and stops at the first failure: with no signal every
 * job would fail, and there is no point burning the battery proving it.
 */
export const PERMANENT = 'OUTBOX_PERMANENT';

export async function flushOutbox(handlers) {
  const result = { sent: 0, failed: 0, dropped: 0, left: 0 };
  let jobs;
  try { jobs = await listJobs(); } catch { return result; }
  for (const job of jobs) {
    const handler = handlers && handlers[job.kind];
    if (!handler) continue;               // a kind this build does not know
    try {
      await handler(job.payload, job.uid);
      await removeJob(job.uid);
      result.sent++;
    } catch (e) {
      if (e && e.message === PERMANENT) {
        // The server will never take this. Keeping it would block the queue
        // for everything behind it.
        await removeJob(job.uid);
        result.dropped++;
        continue;
      }
      await noteFailure(job.uid, e && e.message);
      result.failed++;
      break;
    }
  }
  result.left = (await listJobs()).length;
  return result;
}

/** True when the browser thinks there is a connection. */
export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * A failure worth queueing for, as opposed to one worth showing.
 *
 * A dropped connection, a timeout, a DNS failure — those come back as a
 * TypeError from fetch with no status. A 400 because a column is missing is
 * not something a retry will fix, and must reach the person instead.
 */
export function looksOffline(error) {
  if (!isOnline()) return true;
  const m = String((error && error.message) || error || '');
  return /Failed to fetch|NetworkError|Network request failed|load failed|ERR_INTERNET|timeout|ETIMEDOUT|ENOTFOUND/i.test(m);
}

/* The Admin Portal's Sync button and its 30-second tick.
 *
 * The day this portal would gain an offline write queue arrived: consents,
 * bookings and DOs saved with no line queue in the outbox (mobileQueue.js),
 * and every tick — and every press of the Sync card — flushes them first.
 * The probe after the flush is one row from a table this portal lives on:
 * auth, RLS and the network all have to hold for it to come back, so the
 * stamp only moves when the queue is empty AND the line truly reaches the
 * data.
 *
 * The 30-second tick keeps the same rhythm as the FC Portal and the audit
 * module so the three feel like one system. It only runs while the tab is
 * visible and the browser says online — a hidden tab polling for nothing
 * would be pure battery.
 */
import { supabase } from './supabase';
import { isOnline } from './auth';
import { flushMobileQueue } from './mobileQueue.js';

export const SYNC_STAMP_KEY = 'mjm_mobile_last_sync_v1';

export function lastSync() {
  try {
    const s = JSON.parse(localStorage.getItem(SYNC_STAMP_KEY));
    return s && s.at ? s : null;
  } catch (e) {
    return null;
  }
}

export async function syncNow() {
  if (!isOnline()) return { ok: false, offline: true };
  try {
    // PUSH first: whatever this phone queued while there was no line.
    const flushed = await flushMobileQueue();
    if (flushed.failed > 0 || flushed.left > 0) {
      return { ok: false, offline: false, error: flushed.left + ' record(s) still waiting' };
    }
    const { error } = await supabase
      .from('mobile_consent_records')
      .select('id')
      .limit(1);
    if (error) throw error;
    const at = Date.now();
    try { localStorage.setItem(SYNC_STAMP_KEY, JSON.stringify({ at, ok: true })); } catch (e) { /* */ }
    return { ok: true, at };
  } catch (e) {
    return { ok: false, offline: false, error: String((e && e.message) || e) };
  }
}

let autoTimer = null;
let autoBusy = false;

export function startAutoSync(intervalMs = 30000) {
  if (autoTimer) return;
  const tick = async () => {
    if (autoBusy || !isOnline()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    autoBusy = true;
    try { await syncNow(); } catch (e) { /* next tick */ }
    autoBusy = false;
  };
  autoTimer = setInterval(tick, intervalMs);
  window.addEventListener('online', tick);
}

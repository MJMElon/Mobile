/* The Admin Portal's offline write queue.
 *
 * The three field actions — signing a consent, booking a collection slot,
 * issuing a DO — used to submit straight to Supabase and fail outright with
 * no line. Each now builds a JOB (the row to write, plus any photo as
 * base64), tries the server, and queues the job in the outbox when the
 * failure looks like the network. flushMobileQueue() sends whatever is
 * waiting — called from adminSync's 30-second tick, the dashboard Sync
 * card, and the 'online' event.
 *
 * Photos ride in the queue as base64 and are uploaded to storage AT FLUSH
 * TIME, so a record saved offline still ends up with a proper storage URL
 * rather than a megabyte of base64 in the row. If the upload itself fails,
 * the base64 goes into the row — the same fallback the online path has
 * always had.
 *
 * The DO job's balance deduction re-reads shared_al_orders at flush time
 * and decrements the CURRENT value, rather than writing the stale absolute
 * the phone computed hours earlier — another DO issued in between must not
 * be un-deducted. The insert itself is guarded by a lookup on do_number, so
 * a flush cut off between the insert and the queue letting go cannot post
 * the DO twice.
 *
 * AI scanning is not queued at all, on purpose: the Gemini edge function
 * cannot run without a line, so offline the person fills the fields by
 * hand and the record queues like any other. That is a decision, not a
 * gap.
 */
import { PERMANENT, flushOutbox, looksOffline, queueJob } from './outbox.js';
import { supabase } from './supabase';
import { attachDOToOrder } from './doAttach';

export const CONSENT_JOB = 'mobile_consent';
export const BOOKING_JOB = 'mobile_booking';
export const DO_JOB = 'mobile_do';

export { looksOffline, queueJob };

/** Storage upload with the pages' long-standing fallback: on failure the
    base64 itself becomes the "URL", exactly as the online path always did. */
async function uploadPhoto(filePath, base64) {
  try {
    const blob = await fetch(base64).then((r) => r.blob());
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) return base64;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return (data && data.publicUrl) || base64;
  } catch (e) {
    // A NETWORK failure has to reach the caller so the whole job queues —
    // swallowing it here would write base64 into a row we could have sent
    // properly later.
    if (looksOffline(e)) throw e;
    return base64;
  }
}

export async function sendConsent(job) {
  const payload = { ...job.payload };
  if (job.photoBase64) {
    const filePath = `consent_photos/${payload.al_number}/${Date.now()}.jpg`;
    payload.photo_url = await uploadPhoto(filePath, job.photoBase64);
  }
  const { error } = await supabase.from('mobile_consent_records').insert([payload]);
  if (error) throw new Error(error.message);
}

export async function sendBooking(job) {
  const { error } = await supabase.from('shared_collection_bookings').insert([job.payload]);
  if (error) throw new Error(error.message);
}

export async function sendDO(job) {
  // A retry of a flush that was cut off after the insert must not post the
  // DO twice. do_number is unique per issue (the offline ones carry an OFF
  // marker with a timestamp), so its presence is the fact of the matter.
  const { data: dup, error: dupErr } = await supabase
    .from('shared_do_records')
    .select('id')
    .eq('do_number', job.payload.do_number)
    .limit(1);
  if (dupErr) throw new Error(dupErr.message);

  if (!dup || !dup.length) {
    const payload = { ...job.payload };
    if (job.photoBase64) {
      const filePath = `do_photos/${payload.al_number}/${payload.do_number}_${Date.now()}.jpg`;
      payload.image_url = await uploadPhoto(filePath, job.photoBase64);
    }
    const { error } = await supabase.from('shared_do_records').insert([payload]);
    if (error) throw new Error(error.message);

    /* Deduct the balance from what the server holds NOW. Only when the
       insert happened in THIS call: a retry that found the DO already
       posted must not deduct a second time. (A cut between insert and
       deduct leaves the balance undeducted — the same exposure the online
       path's two awaits always had.) */
    const { data: al } = await supabase
      .from('shared_al_orders')
      .select('balance_quantity')
      .eq('id', job.alId)
      .maybeSingle();
    if (al) {
      await supabase
        .from('shared_al_orders')
        .update({ balance_quantity: (al.balance_quantity ?? 0) - job.totalQty })
        .eq('id', job.alId);
    }

    // The standardized DO PDF onto the customer's Sales Web order —
    // best-effort, exactly as the online path treats it.
    try {
      await attachDOToOrder({
        payload,
        al: job.al,
        staff: job.staff,
        sigDataUrl: job.sigDataUrl,
        photoBase64: job.photoBase64,
      });
    } catch (e) { /* never blocks the DO */ }
  }
}

/* One handler shape for all three: a network-looking failure leaves the job
   queued for the next flush; anything else is the server refusing the work
   itself, and retrying would only refuse it again. */
export function flushMobileQueue() {
  const wrap = (send) => async (payload) => {
    try {
      await send({ ...payload });
    } catch (e) {
      if (looksOffline(e)) throw e;
      throw new Error(PERMANENT);
    }
  };
  return flushOutbox({
    [CONSENT_JOB]: wrap(sendConsent),
    [BOOKING_JOB]: wrap(sendBooking),
    [DO_JOB]: wrap(sendDO),
  });
}

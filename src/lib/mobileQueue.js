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
export const SEAL_RECEIPT_JOB = 'seal_receipt';

export { looksOffline, queueJob };

/** Storage upload with the pages' long-standing fallback: on failure the
    base64 itself becomes the "URL", exactly as the online path always did.
    Exported for the Seal Management page, whose receipt photos go up the
    same way. */
export async function uploadPhoto(filePath, base64) {
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

/** Same upload, PNG rather than JPEG — the signature pad's own format.
    Used so the row carries a reusable signature URL, same as image_url,
    rather than the signature living only inside the one-off PDF
    attachDOToOrder generates (see sendDO below). */
async function uploadSignature(filePath, base64) {
  try {
    const blob = await fetch(base64).then((r) => r.blob());
    const { error } = await supabase.storage
      .from('documents')
      .upload(filePath, blob, { contentType: 'image/png', upsert: true });
    if (error) return base64;
    const { data } = supabase.storage.from('documents').getPublicUrl(filePath);
    return (data && data.publicUrl) || base64;
  } catch (e) {
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
  // The customer receiving their seals — a second photo, only taken when
  // seal ranges were keyed on the consent.
  if (job.sealPhotoBase64) {
    const filePath = `consent_photos/${payload.al_number}/seal_${Date.now()}.jpg`;
    payload.seal_photo_url = await uploadPhoto(filePath, job.sealPhotoBase64);
  }
  const { error } = await supabase.from('mobile_consent_records').insert([payload]);
  if (error) throw new Error(error.message);
}

export async function sendBooking(job) {
  const { error } = await supabase.from('shared_collection_bookings').insert([job.payload]);
  if (error) throw new Error(error.message);
}

/* ONE PRESS OF SAVE IS ONE DO, AND THE DATABASE HANDS OUT ITS NUMBER.
   The number the form shows is a preview: the trigger in
   shared/RUN_ME_do_number_never_repeats.sql moves a number already taken
   to the next free one, so a customer collecting twice in a day gets 01
   and 02 and never 01 twice (DO-MUGJB901, 5 Nov). The row that comes back
   is the DO, and its number is the one the PDF and the portal carry.

   A retry is recognised by client_uid, one id per press made on the phone,
   NOT by the number. Asking "is this do_number already there" answered yes
   for a genuine SECOND DO that had been handed the same preview number, and
   dropped it without a word. A queued job from before client_uid keeps the
   old question, having nothing else to ask. A database without the column
   is told once and the same row sent again without it. The FC Portal copy
   is insertDORow in src/modules/do/data.js. Change one, change the other. */
let _doNoClientUid = false;
export function newDOPressId() {
  try { if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function namesClientUid(err) {
  const t = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  return /client_uid/i.test(t) && (err?.code === '42703' || err?.code === 'PGRST204' || /column/i.test(t));
}
async function doByPress(uid) {
  if (!uid || _doNoClientUid) return null;
  const { data, error } = await supabase.from('shared_do_records').select('*').eq('client_uid', uid).limit(1);
  if (error) { if (namesClientUid(error)) { _doNoClientUid = true; return null; } throw new Error(error.message); }
  return (data && data[0]) || null;
}

export async function sendDO(job) {
  const uid = job.payload.client_uid;
  let dup = null;
  if (uid && !_doNoClientUid) {
    const mine = await doByPress(uid);
    if (mine) return mine;
  }
  if (!uid || _doNoClientUid) {
    // A job from before client_uid: the number is all it has to go on.
    const { data: byNum, error: dupErr } = await supabase
      .from('shared_do_records')
      .select('id')
      .eq('do_number', job.payload.do_number)
      .limit(1);
    if (dupErr) throw new Error(dupErr.message);
    dup = byNum;
  }

  // The caller (DoSigning.jsx's saveScanDO, online path) needs the real row
  // right after this returns, to open the Who Loaded This DO step against
  // it. Re-querying shared_do_records by do_number right after this call
  // used to be how it got that row — and came back empty often enough to
  // be the actual bug: a request this close behind the insert is not
  // guaranteed to see it depending on which pooled connection answers it.
  // Returning the row this function ALREADY has (just inserted, or the
  // duplicate already on file) removes the second read, and the race
  // along with it.
  if (!dup || !dup.length) {
    const payload = { ...job.payload };
    if (job.photoBase64) {
      const filePath = `do_photos/${payload.al_number}/${payload.do_number}_${Date.now()}.jpg`;
      payload.image_url = await uploadPhoto(filePath, job.photoBase64);
    }
    if (job.sigDataUrl) {
      const sigPath = `do_signatures/${payload.al_number}/${payload.do_number}_${Date.now()}.png`;
      payload.signature_url = await uploadSignature(sigPath, job.sigDataUrl);
    }
    if (_doNoClientUid) delete payload.client_uid;
    let { data: inserted, error } = await supabase.from('shared_do_records').insert([payload]).select().single();
    if (error && payload.client_uid && namesClientUid(error)) {
      _doNoClientUid = true;
      delete payload.client_uid;
      ({ data: inserted, error } = await supabase.from('shared_do_records').insert([payload]).select().single());
    }
    if (error && error.code === '23505' && payload.client_uid) {
      const mine = await doByPress(payload.client_uid);
      if (mine) return mine;
    }
    if (error) throw new Error(error.message);
    // The database may have moved the number; the row is the DO.
    if (inserted && inserted.do_number) payload.do_number = inserted.do_number;

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

    return inserted;
  }

  return { id: dup[0].id };
}

/* Seals arriving at UNN 1. client_ref is made on the phone when the form is
   saved and is UNIQUE in seal_receipts, so a flush cut off after the insert
   comes back 23505 on the retry — the receipt is already there, which is
   success, not a refusal. Photos go to a folder named by client_ref, so a
   retry overwrites (upsert) the same files rather than adding copies. */
export async function sendSealReceipt(job) {
  const payload = { ...job.payload };
  const shots = job.photoBase64s || [];
  if (shots.length) {
    const urls = [];
    for (let i = 0; i < shots.length; i++) {
      urls.push(await uploadPhoto(`seal_receipts/${payload.client_ref}/${i + 1}.jpg`, shots[i]));
    }
    payload.photo_urls = urls;
  }
  const { error } = await supabase.from('seal_receipts').insert([payload]);
  if (error && error.code !== '23505') throw new Error(error.message);
}

/* One handler shape for all of them: a network-looking failure leaves the job
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
    [SEAL_RECEIPT_JOB]: wrap(sendSealReceipt),
  });
}

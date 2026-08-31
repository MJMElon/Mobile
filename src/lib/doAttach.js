import { supabase } from './supabase';
import { doPdfBlob } from './pdf';

// Attach an issued DO to its Sales Web customer order so the customer portal
// shows it under the order's documents: build the standardized DO PDF, upload
// it to the shared `order-attachments` bucket, then call the
// attach_do_to_order RPC (SECURITY DEFINER on the Sales Web side) which
// resolves the order from the AL number and inserts the
// salesweb_order_attachments + timeline rows. Best-effort: a failure here
// never blocks the DO itself. Returns true when the attachment row landed.
export async function attachDOToOrder({ payload, al, staff, sigDataUrl, photoBase64 }) {
  try {
    const alNumber = payload.al_number || al?.al_number;
    // Manual ALs have no Sales Web order to attach to.
    if (!alNumber || !payload.do_number || /^MANUAL-/i.test(alNumber)) return false;
    const { blob, fileName } = doPdfBlob(payload, al || {}, staff || '—', sigDataUrl || null, photoBase64 || null);
    const path = `do-pdfs/${alNumber}/${payload.do_number.replace(/[/\\]/g, '_')}.pdf`;
    const { error: upErr } = await supabase.storage
      .from('order-attachments')
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (upErr) return false;
    const { data: urlData } = supabase.storage.from('order-attachments').getPublicUrl(path);
    if (!urlData?.publicUrl) return false;
    const { data, error } = await supabase.rpc('attach_do_to_order', {
      _al_number: alNumber,
      _do_number: payload.do_number,
      _file_name: fileName,
      _file_url: urlData.publicUrl,
      _file_size: blob.size,
      _uploaded_by: staff || 'mobile-do-signing',
    });
    return !error && data === true;
  } catch (e) {
    return false;
  }
}

// Per-order running DO number: DO-<orderNo>01, DO-<orderNo>02, … The order
// number is the AL number for Sales Web orders, so the DO number itself
// identifies the customer order. Standardized across the Barcode Counter,
// Mobile, and AI-system DO issuing flows.
export async function generateDONumber(al) {
  const orderNo = String(al?.order_number || al?.al_number || '').trim();
  if (!orderNo) return `DO-${Date.now().toString(36).toUpperCase()}`;
  const prefix = `DO-${orderNo}`;
  const { data, error } = await supabase
    .from('shared_do_records')
    .select('do_number')
    .ilike('do_number', `${prefix}%`);
  /* With no line the pool of existing numbers cannot be read, and guessing
     "01" invites a collision when the queued DO flushes. An OFF placeholder
     with a timestamp is unique by construction — the same convention the FC
     scan app uses, which is why the loop below already skips OFF numbers
     when finding the next real one. */
  if (error) return `${prefix}-OFF${Date.now().toString(36).toUpperCase()}`;
  let max = 0;
  (data || []).forEach((r) => {
    const rest = String(r.do_number || '').slice(prefix.length);
    if (/OFF/i.test(rest)) return; // skip offline placeholders from the scan app
    const num = parseInt(rest.replace(/\D/g, ''), 10) || 0;
    if (num > max) max = num;
  });
  return prefix + String(max + 1).padStart(2, '0');
}

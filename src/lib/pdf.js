import { jsPDF } from 'jspdf';
import { formatSealRanges, rangeQty, SHOW_SEALS_ON_DO } from './sealRanges.js';

// Company letterhead — the standardized DO identity block shared with the
// Barcode Counter app and the Sales Web proforma invoice.
const CO_NAME = 'MEGA JUTAMAS SDN BHD';
const CO_BRAND = 'MJM Nursery';
const CO_ADDR = 'Lot 1180, Bangunan Bei, Krokop 2, Miri, Sarawak, Malaysia';

const INK = [17, 24, 39]; // #111827
const GREY = [85, 85, 85]; // #555
const LIGHT = [229, 231, 235]; // #e5e7eb row separators
const HEAD_BG = [244, 244, 245]; // #f4f4f5 table header

const fmtQty = (n) => Number(n || 0).toLocaleString('en-MY');

// Draw a data-URL image contained (aspect-fit, centred) inside a box.
function fitImage(doc, dataUrl, x, y, boxW, boxH, pad = 1.5) {
  try {
    const props = doc.getImageProperties(dataUrl);
    const availW = boxW - pad * 2;
    const availH = boxH - pad * 2;
    const scale = Math.min(availW / props.width, availH / props.height);
    const w = props.width * scale;
    const h = props.height * scale;
    doc.addImage(dataUrl, props.fileType || 'JPEG', x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
  } catch (e) {
    /* ignore bad image */
  }
}

// Builds the standardized Delivery Order PDF (same layout as the Barcode
// Counter app). `al` is the matching shared_al_orders row (may be partial),
// `staff` is the signed-in staff display name, `sigDataUrl` is an optional
// PNG data-URL of the customer signature, `photoDataUrl` is an optional
// data-URL photo of the customer's vehicle with the loaded goods. Returns
// the jsPDF doc so callers can either save (print) it or upload it as a blob.
export function buildDOPdf(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  const doc = new jsPDF();
  const now = new Date();
  const dateFmt = doRec.delivery_date ? new Date(doRec.delivery_date).toLocaleDateString('en-MY') : '—';
  const customer = al.customer_name || doRec.remark || '—';

  // ── Letterhead ──
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(CO_NAME, 20, 19);
  doc.setFontSize(10.5);
  doc.setTextColor(51, 51, 51);
  doc.text(CO_BRAND, 20, 25);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text(CO_ADDR, 20, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text('DELIVERY ORDER', 190, 19, { align: 'right' });
  doc.setFontSize(9.5);
  doc.text(doRec.do_number || '—', 190, 25.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text('Date: ' + dateFmt, 190, 30, { align: 'right' });

  doc.setDrawColor(...INK);
  doc.setLineWidth(0.8);
  doc.line(20, 34.5, 190, 34.5);

  // ── Deliver To ── (the DO number embeds the order number, so no separate
  // Order No. field is needed)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('DELIVER TO', 20, 44);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(customer), 150), 20, 50);

  // ── Items table ──
  let y = 66;
  doc.setFillColor(...HEAD_BG);
  doc.rect(20, y, 170, 8.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('#', 23, y + 5.7);
  doc.text('Nursery / Plot', 30, y + 5.7);
  doc.text('Breed / Plant', 92, y + 5.7);
  doc.text('Qty', 187, y + 5.7, { align: 'right' });
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.line(20, y + 8.5, 190, y + 8.5);

  const items = [];
  for (let i = 1; i <= 5; i++) {
    const nursery = doRec[`plot_${i}`];
    const breed = doRec[`breed_${i}`];
    const qty = doRec[`qty_${i}`];
    if (nursery || breed || qty) items.push({ nursery: nursery || '—', breed: breed || '—', qty: qty || 0 });
  }
  if (!items.length) items.push({ nursery: '—', breed: '—', qty: doRec.total_qty || 0 });

  y += 15;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  items.forEach((it, i) => {
    doc.setTextColor(...GREY);
    doc.text(String(i + 1), 23, y);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(String(it.nursery), 58)[0], 30, y);
    doc.text(doc.splitTextToSize(String(it.breed), 85)[0], 92, y);
    doc.text(fmtQty(it.qty), 187, y, { align: 'right' });
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.2);
    doc.line(20, y + 3, 190, y + 3);
    y += 9;
  });

  // Total row
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.7);
  doc.line(20, y - 2, 190, y - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text('TOTAL QUANTITY', 92, y + 4);
  doc.text(fmtQty(doRec.total_qty), 187, y + 4, { align: 'right' });

  // ── Seal numbers on this DO ── (FC Portal writes seal_ranges when the DO
  // is issued off a scan card). Capped at four lines so a DO of many short
  // runs cannot push the acknowledgement off the page; the full list is in
  // the system.
  const seals = SHOW_SEALS_ON_DO && Array.isArray(doRec.seal_ranges) ? doRec.seal_ranges : [];
  if (seals.length) {
    y += 11;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text('SEAL NO.', 20, y);
    const sealQty = doRec.seal_qty != null
      ? Number(doRec.seal_qty)
      : seals.reduce((s, r) => s + (Number(r.qty) || rangeQty(r.start, r.end)), 0);
    doc.text('SEAL QTY: ' + fmtQty(sealQty), 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    let lines = doc.splitTextToSize(formatSealRanges(seals), 170);
    if (lines.length > 4) {
      const more = ' ... (' + seals.length + ' ranges, see system)';
      let body = lines[3];
      // Drop whole ranges off the fourth line until the note fits beside
      // it — a seal number cut in half reads as a different seal.
      while (body.includes(', ') && doc.getTextWidth(body + more) > 170) body = body.slice(0, body.lastIndexOf(', '));
      lines = [...lines.slice(0, 3), body.replace(/[,\s-]+$/, '') + more];
    }
    lines.forEach((ln, i) => doc.text(ln, 20, y + 5 + i * 4));
    y += 5 + (lines.length - 1) * 4;
  }

  // ── Customer acknowledgement: collection photo + signature ──
  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text('CUSTOMER ACKNOWLEDGEMENT', 20, y);
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.4);
  doc.line(20, y + 2, 190, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text('I / We acknowledge receipt of the above items in good order and condition.', 20, y + 9);

  y += 15;
  const BOX_H = 58;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(20, y, 82, BOX_H);
  doc.rect(108, y, 82, BOX_H);

  if (photoDataUrl) {
    fitImage(doc, photoDataUrl, 20, y, 82, BOX_H);
  } else {
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('No photo captured', 61, y + BOX_H / 2, { align: 'center' });
  }
  if (sigDataUrl) fitImage(doc, sigDataUrl, 108, y, 82, BOX_H);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('Collection Photo (vehicle & goods)', 20, y + BOX_H + 5);
  doc.text('Customer Signature', 108, y + BOX_H + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(customer), 80)[0], 108, y + BOX_H + 10);

  // ── Footer ──
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(20, 280, 190, 280);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text('Computer-generated by ' + CO_NAME + ' (' + CO_BRAND + ').', 20, 285);
  doc.text('Issued by ' + String(staff || '—'), 190, 285, { align: 'right' });
  doc.setTextColor(150, 150, 150);
  doc.text(
    (doRec.do_number || 'DO') + ' · Generated ' + now.toISOString().slice(0, 19).replace('T', ' '),
    190,
    289.5,
    { align: 'right' }
  );

  return doc;
}

// Filename used both for the downloaded copy and the uploaded attachment.
export function doPdfFileName(doRec) {
  return (doRec.do_number || 'DO').replace(/[/\\]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.pdf';
}

// Generates and downloads the DO PDF (print flow).
export function printDOPdf(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  buildDOPdf(doRec, al, staff, sigDataUrl, photoDataUrl).save(doPdfFileName(doRec));
}

// Generates the DO PDF as a Blob for uploading to storage (order attachment
// flow). Returns { blob, fileName }.
export function doPdfBlob(doRec, al = {}, staff = '—', sigDataUrl = null, photoDataUrl = null) {
  const doc = buildDOPdf(doRec, al, staff, sigDataUrl, photoDataUrl);
  return { blob: doc.output('blob'), fileName: doPdfFileName(doRec) };
}

/* ════════════════ CUSTOMER CONSENT ════════════════
   One consent record, on paper: who signed, for which order, how many
   seedlings, the seals issued, the terms they agreed to, the sticker photo
   and the signature itself.

   IT IS BUILT FROM THE SAVED ROW, never stored as a file. The row already
   carries everything the paper says (the signature is a data URL on it, the
   photos are storage links), so a PDF kept beside it would be a second copy
   that can disagree with the first -- a seal range corrected on the record
   would leave the old one on the file. Built on demand, the paper is always
   what the record says now, and every consent ever signed has one,
   including the ones signed before this button existed.

   The terms are handed IN by the page (`terms` is a list of { lang, heading,
   items, agree }), because the page is where the customer read them: one
   wording, so the paper cannot say something the screen did not. The row
   does not record which language was on screen, so both are printed. */
const stripTags = (s) => String(s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/—/g, '-');

export function buildConsentPdf(rec = {}, opts = {}) {
  const { terms = [], photoDataUrl = null, sealPhotoDataUrl = null, photoNote = '' } = opts;
  const doc = new jsPDF();
  const PAGE_FOOT = 276;
  const signedAt = rec.created_at ? new Date(rec.created_at) : null;
  const signedTxt = signedAt
    ? signedAt.toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '-';
  const ref = 'CONSENT-' + (rec.al_number || '') + (rec.id != null ? '-' + rec.id : '');

  // ── Letterhead ── (the DO's own, so the two papers a customer takes home
  // read as one company)
  const letterhead = () => {
    doc.setTextColor(...INK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(CO_NAME, 20, 19);
    doc.setFontSize(10.5);
    doc.setTextColor(51, 51, 51);
    doc.text(CO_BRAND, 20, 25);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(CO_ADDR, 20, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(...INK);
    doc.text('CUSTOMER CONSENT', 190, 19, { align: 'right' });
    doc.setFontSize(9.5);
    doc.text(String(rec.al_number || '-'), 190, 25.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text('Signed: ' + signedTxt, 190, 30, { align: 'right' });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.8);
    doc.line(20, 34.5, 190, 34.5);
  };
  letterhead();

  // ── The order and the consent ──
  const field = (label, value, x, yy, w) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(label, x, yy);
    doc.setFontSize(10.5);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(String(value == null || value === '' ? '-' : value), w)[0], x, yy + 5.5);
  };
  let y = 44;
  field('CUSTOMER', rec.customer_name, 20, y, 105);
  field('AL NO.', rec.al_number, 130, y, 60);
  y += 14;
  field('ORDER NO.', rec.order_number, 20, y, 60);
  field('CONSENT QTY (SEEDLINGS)', fmtQty(rec.consent_qty), 85, y, 50);
  field('AI STICKER COUNT', rec.ai_sticker_count != null ? fmtQty(rec.ai_sticker_count) : '-', 140, y, 50);

  // ── Seals issued ──
  const seals = Array.isArray(rec.seal_ranges) ? rec.seal_ranges : [];
  y += 15;
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(20, y - 4, 190, y - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('SEALS ISSUED', 20, y);
  if (seals.length) {
    const qty = seals.reduce((s, r) => s + (Number(r.qty) || rangeQty(r.start, r.end)), 0);
    doc.text('SEAL QTY: ' + fmtQty(qty), 190, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    // Every range, however many lines: this paper is the record of what was
    // handed over, so it is never cut short the way the DO is.
    const lines = doc.splitTextToSize(formatSealRanges(seals), 170);
    lines.forEach((ln, i) => doc.text(ln, 20, y + 5 + i * 4));
    y += 5 + (lines.length - 1) * 4;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text('No seals recorded on this consent.', 20, y + 5);
    y += 5;
  }

  // ── Photo + signature ──
  y += 10;
  const BOX_H = 62;
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.rect(20, y, 82, BOX_H);
  doc.rect(108, y, 82, BOX_H);
  if (photoDataUrl) fitImage(doc, photoDataUrl, 20, y, 82, BOX_H);
  else {
    doc.setFontSize(8);
    doc.setTextColor(170, 170, 170);
    doc.text(photoNote || 'No sticker photo on this record', 61, y + BOX_H / 2, { align: 'center' });
  }
  if (rec.signature_data) fitImage(doc, rec.signature_data, 108, y, 82, BOX_H);
  else {
    doc.setFontSize(8);
    doc.setTextColor(170, 170, 170);
    doc.text('No signature on this record', 149, y + BOX_H / 2, { align: 'center' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('Sticker / Seal Photo', 20, y + BOX_H + 5);
  doc.text('Customer Signature', 108, y + BOX_H + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(String(rec.customer_name || '-'), 80)[0], 108, y + BOX_H + 10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GREY);
  doc.text(signedTxt, 108, y + BOX_H + 14.5);
  y += BOX_H + 22;

  // ── Footer, on every page ──
  const footer = () => {
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.line(20, 280, 190, 280);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text('Computer-generated by ' + CO_NAME + ' (' + CO_BRAND + ') from the saved consent record.', 20, 285);
    doc.setTextColor(150, 150, 150);
    doc.text(ref + ' · Generated ' + new Date().toISOString().slice(0, 19).replace('T', ' '), 190, 289.5, { align: 'right' });
  };
  // A block that will not fit takes the next page WHOLE rather than running
  // into the footer band.
  const need = (h) => {
    if (y + h <= PAGE_FOOT) return;
    footer();
    doc.addPage();
    letterhead();
    y = 44;
  };

  // ── The terms the customer agreed to ──
  terms.forEach((t) => {
    need(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(stripTags(t.heading || 'Terms & Conditions'), 20, y);
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.4);
    doc.line(20, y + 2, 190, y + 2);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.3);
    (t.items || []).concat(t.agree ? [t.agree] : []).forEach((item, i, all) => {
      const isAgree = t.agree && i === all.length - 1;
      doc.setFont('helvetica', isAgree ? 'bold' : 'normal');
      doc.setTextColor(...(isAgree ? INK : [55, 65, 81]));
      const lines = stripTags(item).split('\n').flatMap((p) => doc.splitTextToSize(p, 170));
      need(lines.length * 3.9 + 2);
      lines.forEach((ln, k) => doc.text(ln, 20, y + k * 3.9));
      y += lines.length * 3.9 + 2.2;
    });
    y += 5;
  });

  // ── The seal receipt photo, where one was taken ──
  if (sealPhotoDataUrl) {
    need(90);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text('SEAL RECEIPT PHOTO', 20, y);
    doc.setDrawColor(180, 180, 180);
    doc.rect(20, y + 3, 170, 80);
    fitImage(doc, sealPhotoDataUrl, 20, y + 3, 170, 80);
    y += 88;
  }

  footer();
  return doc;
}

export function consentPdfFileName(rec = {}) {
  const day = rec.created_at ? String(rec.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  return ('Consent_' + (rec.al_number || 'AL') + '_' + day + (rec.id != null ? '_' + rec.id : ''))
    .replace(/[^A-Za-z0-9_.-]/g, '_') + '.pdf';
}

/* A storage link turned into a data URL jsPDF can draw. A photo that will
   not load (offline, removed, refused) answers null and the paper says so in
   the box rather than failing the whole download. */
export async function urlToDataUrl(url) {
  if (!url) return null;
  if (String(url).startsWith('data:')) return url;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch (_) {
    return null;
  }
}

export async function downloadConsentPdf(rec, terms) {
  const [photo, sealPhoto] = await Promise.all([urlToDataUrl(rec.photo_url), urlToDataUrl(rec.seal_photo_url)]);
  const doc = buildConsentPdf(rec, {
    terms,
    photoDataUrl: photo,
    sealPhotoDataUrl: sealPhoto,
    photoNote: rec.photo_url && !photo ? 'Sticker photo could not be loaded' : '',
  });
  doc.save(consentPdfFileName(rec));
}

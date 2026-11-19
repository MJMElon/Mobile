/* A CONSENTED RECORD DOWNLOADS AS A PDF.
 *
 * The office: "customer consent - consented record, must have pdf record.
 * I want download it."
 *
 * Every row of the Consent History carries a PDF button. The paper is built
 * from the SAVED ROW with the real jsPDF (no file is stored beside the row,
 * so a corrected seal range is on the paper the next time it is pressed).
 * This drives the shipped buildConsentPdf with the real library, writes the
 * file, and reads it back with pdftotext -- a check that reads the file with
 * the code that wrote it proves nothing about what a reader sees.
 *
 * Run: node tests/a_consent_downloads_as_a_pdf.cjs     (SHOT=/dir draws page 1)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let fails = 0;
function is(got, want, msg) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'pass  ' : 'FAIL  ') + msg + (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src', 'pages', 'Consent.jsx'), 'utf8');

// A 2x1 PNG standing in for the signature and the photo.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAQAAWHvbUQAAAAASUVORK5CYII=';

const REC = {
  id: 418, al_number: 'C2A729', order_number: 'SO-01893', customer_name: 'Ting Ah Kow Plantation',
  created_at: '2026-11-17T02:15:00Z', consent_qty: 1200, ai_sticker_count: 1196,
  signature_data: PNG, photo_url: 'https://example.invalid/photo.jpg',
  seal_ranges: [{ start: '0035001', end: '0035600' }, { start: '0035701', end: '0036300' }],
};

(async () => {
  // ── 1. The button is on every row of the history ──
  is(/import \{ downloadConsentPdf \} from '\.\.\/lib\/pdf\.js'/.test(page), true, 'the page imports the builder');
  is(/<th>PDF<\/th>/.test(page), true, 'the history has a PDF column');
  is(/onClick=\{\(\) => downloadPdf\(c, /.test(page), true, 'each row has a button that downloads its own record');
  is(/colSpan=\{6\}/.test(page) && !/colSpan=\{5\}/.test(page), true, 'the seal line under a row spans the new column');
  is(/items: CONSENT_STRINGS\[lang\]\.terms/.test(page), true, 'the terms on paper are the form\'s own words');

  // ── 2. The real builder, the real jsPDF ──
  let mod;
  try { mod = await import(path.join(root, 'src', 'lib', 'pdf.js')); }
  catch (e) { is('threw: ' + e.message, 'loads', 'src/lib/pdf.js loads'); }
  const build = mod && mod.buildConsentPdf;
  is(typeof build, 'function', 'pdf.js exports buildConsentPdf');
  if (typeof build !== 'function') { console.log('\n' + fails + ' failed'); process.exit(1); }

  const terms = [
    { heading: 'Terms & Conditions (English)', items: ['<strong>1. Physical Verification.</strong> Customer must verify the stickers.', '<strong>2. Seedling Selection.</strong> Accepted.<br><strong>Worker Assistance.</strong> Under the customer’s responsibility.'], agree: 'By signing below, I agree.' },
    { heading: 'Terma & Syarat (Bahasa Melayu)', items: ['<strong>1. Pengesahan Jumlah.</strong> Semak pelekat.'], agree: 'Saya bersetuju.' },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consent-pdf-'));
  const file = path.join(dir, mod.consentPdfFileName(REC));
  const doc = build(REC, { terms, photoDataUrl: PNG });
  fs.writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
  const txt = execFileSync('pdftotext', ['-layout', file, '-']).toString();
  const has = (s) => txt.includes(s);

  is(path.basename(file), 'Consent_C2A729_2026-11-17_418.pdf', 'the file is named after the AL, the day and the record');
  is(has('CUSTOMER CONSENT'), true, 'it is headed Customer Consent');
  is(['Ting Ah Kow Plantation', 'C2A729', 'SO-01893'].every(has), true, 'it names the customer, the AL and the order');
  is(has('1,200') && has('1,196'), true, 'it carries the consent qty and the AI count, grouped');
  is(has('0035001 - 0035600') && has('0035701 - 0036300') && has('SEAL QTY: 1,200'), true, 'every seal range and the seal total');
  is(has('Physical Verification') && has('Pengesahan Jumlah'), true, 'the terms in both languages');
  is(/<strong>|<br>/.test(txt), false, 'with no markup left in them');
  is(has("customer's responsibility"), true, 'a curly apostrophe prints as one');
  is(has('By signing below, I agree.'), true, 'and the sentence the customer signed under');
  is(has('Customer Signature'), true, 'the signature box is labelled');

  // ── 3. A record with nothing optional on it still makes a paper ──
  const bare = build({ al_number: 'X1', consent_qty: 5 }, {});
  const f2 = path.join(dir, 'bare.pdf');
  fs.writeFileSync(f2, Buffer.from(bare.output('arraybuffer')));
  const t2 = execFileSync('pdftotext', [f2, '-']).toString();
  is(t2.includes('No seals recorded') && t2.includes('No signature on this record') && t2.includes('No sticker photo'), true,
    'an empty record says what is missing rather than failing');

  // ── 4. A photo that will not load says so in its box ──
  const f3 = path.join(dir, 'nophoto.pdf');
  fs.writeFileSync(f3, Buffer.from(build(REC, { photoNote: 'Sticker photo could not be loaded' }).output('arraybuffer')));
  is(execFileSync('pdftotext', [f3, '-']).toString().includes('Sticker photo could not be loaded'), true,
    'an unreadable photo is named, not left blank');

  // ── 5. Long terms run onto a second page and never into the footer ──
  const long = [{ heading: 'Long', items: Array.from({ length: 40 }, (_, i) => (i + 1) + '. ' + 'word '.repeat(40)), agree: 'Agree.' }];
  const big = build(REC, { terms: long, photoDataUrl: PNG });
  is(big.getNumberOfPages() > 1, true, 'long terms take a second page');

  if (process.env.SHOT) {
    execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '1', file, path.join(process.env.SHOT, 'consent')]);
    console.log('drew', path.join(process.env.SHOT, 'consent-1.png'));
  }
  console.log('\n' + (fails ? fails + ' failed' : 'all good'));
  process.exit(fails ? 1 : 0);
})();

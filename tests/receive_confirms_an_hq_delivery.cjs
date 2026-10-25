/* RECEIVE SEALS CONFIRMS A DELIVERY FROM HQ.
 *
 * Seals now go supplier -> HQ -> site. HQ packs a delivery on the office
 * Seal Manage page, and site confirms it by scanning the first and last seal
 * of each roll AGAIN on Receive Seals, with the delivery picked. The
 * database closes the delivery and compares the two.
 *
 * What this holds:
 *   - what site scanned is compared with what HQ sent, both ways round, and
 *     a run that meets reads as one range
 *   - a difference warns and never blocks: what site counted is kept
 *   - delivery_id goes on the row ONLY when a delivery is picked, so Receive
 *     goes on working on a database that has not had the delivery SQL
 *   - the picker is kept on the phone, so a delivery can be confirmed with
 *     no line
 *
 * Run: node tests/receive_confirms_an_hq_delivery.cjs
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Seal.jsx'), 'utf8');
const lib = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'sealRanges.js'), 'utf8');

let fails = 0;
function is(got, want, msg) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'pass  ' : 'FAIL  ') + msg + (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// The shipped helpers, lifted out of the files rather than copied.
const cut = (s, from, to) => { const i = s.indexOf(from); return s.slice(i, s.indexOf(to, i)); };
const code = lib.replace(/export /g, '') + '\n'
  + cut(src, 'function normRanges', 'const qtyOf') + '\n'
  + cut(src, 'const qtyOf', '\n\n') + '\n'
  + 'module.exports = { minusRanges, qtyOf, formatSealRanges };';
const m = { exports: {} };
new Function('module', code)(m);
const { minusRanges, qtyOf, formatSealRanges } = m.exports;

const sent = [{ start: '0029001', end: '0030000' }];
is(minusRanges(sent, [{ start: '0029001', end: '0030000' }]), [], 'the right count leaves nothing over');
is(minusRanges(sent, [{ start: '0029001', end: '0029500' }, { start: '0029501', end: '0030000' }]), [],
  'two rolls that meet are the same seals as one');
const short = [{ start: '0029001', end: '0029950' }, { start: '0030001', end: '0030010' }];
is(formatSealRanges(minusRanges(sent, short)), '0029951 - 0030000', 'sent but not scanned is named');
is(formatSealRanges(minusRanges(short, sent)), '0030001 - 0030010', 'scanned but not on the delivery is named');
is(qtyOf(minusRanges(sent, short)) + qtyOf(minusRanges(short, sent)), 60, 'and counted');
is(minusRanges([{ start: '29001', end: '29010' }], [{ start: '0029001', end: '0029010' }]), [], 'seals are numbers: 29001 is 0029001');

is(/if \(delivery\) job\.payload\.delivery_id = delivery\.id;/.test(src), true, 'delivery_id is written only when a delivery is picked');
is(/delivery_id:/.test(cut(src, 'const job = {', 'photoBase64s')), false, 'and is not in the row by default');
is(/deliveryDiffers && !window\.confirm\(/.test(src), true, 'a difference asks, and saves on yes');
is(/recvProblems\.push\([^)]*match/i.test(src), false, 'a difference is never a reason the save is refused');
is(/readCache\(DELIVERY_CACHE\)/.test(src) && /writeCache\(DELIVERY_CACHE/.test(src), true, 'the deliveries are kept on the phone for no line');
is(/\.neq\('status', 'received'\)/.test(src), true, 'only deliveries site has not confirmed are offered');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);

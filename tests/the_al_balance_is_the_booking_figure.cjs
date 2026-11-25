/* The AL balance on Consent and DO Signing is the office Booking page figure.

   balance = quantity_ordered - the total_qty of every DO on that AL that is
   not Cancelled and carries no [CANCELLED] in its remark. The stored
   balance_quantity was written by six screens as "old figure minus this DO"
   and went wrong on 82 of 429 ALs, so the two pages work it out from the
   DOs (src/lib/alBalance.js), and the database keeps the stored column
   equal to the same rule (mjm-ai-system shared/RUN_ME_al_balance_is_the_dos.sql).

   Drives the SHIPPED helper against a fake PostgREST that stops at 1,000
   rows, and reads the shipped pages for the wiring.

   Run: node tests/the_al_balance_is_the_booking_figure.cjs              */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* A fake client: answers .from('shared_do_records').select().in().order().range()
   the way PostgREST does, capped at 1,000 rows a page. */
function fakeSupabase(dos, opts = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    from(table) {
      const q = { table, inList: null, lo: 0, hi: 999 };
      const api = {
        select() { return api; },
        in(col, vals) { q.inList = vals.map(String); return api; },
        order() { return api; },
        range(lo, hi) { q.lo = lo; q.hi = Math.min(hi, lo + 999); return api; },
        then(res, rej) {
          calls++;
          if (opts.fail) return Promise.resolve({ data: null, error: { message: 'no line' } }).then(res, rej);
          const rows = dos.filter((d) => !q.inList || q.inList.includes(String(d.al_number)))
            .sort((a, b) => a.id - b.id).slice(q.lo, q.hi + 1);
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return api;
    },
  };
}

(async () => {
  const mod = await import(path.join(__dirname, '..', 'src/lib/alBalance.js'));

  console.log('\n1. The rule is the office Booking page rule');
  /* Lifted out of the office page itself where it is checked out beside this
     one, so the two cannot drift apart without this failing. */
  const officePath = path.join(__dirname, '..', '..', 'mjm-ai-system', 'operation', 'operation_booking.html');
  if (fs.existsSync(officePath)) {
    const office = fs.readFileSync(officePath, 'utf8');
    const line = (office.match(/const isCancelled = (d\.status === 'Cancelled' \|\| \(d\.remark && d\.remark\.includes\('\[CANCELLED\]'\)\));/) || [])[1];
    check('the office page still says what counts as cancelled', !!line, true);
    if (line) {
      // eslint-disable-next-line no-new-func
      const officeCancelled = new Function('d', 'return !!(' + line + ');');
      const samples = [{ status: 'Issued', remark: '' }, { status: 'Cancelled', remark: '' },
        { status: 'Issued', remark: 'x [CANCELLED] y' }, { status: null, remark: null }, { status: 'cancelled', remark: '' }];
      check('…and the helper counts exactly the DOs the office page counts',
        samples.map((d) => mod.doCounts(d)), samples.map((d) => !officeCancelled(d)));
    }
  } else {
    console.log('  (mjm-ai-system not checked out beside this repository; the office comparison is skipped)');
  }

  console.log('\n2. Worked out from the DOs, past the 1,000-row cap');
  const dos = [];
  let id = 1;
  for (let i = 0; i < 1500; i++) dos.push({ id: id++, al_number: 'BIG', total_qty: 2, status: 'Issued', remark: '' });
  dos.push({ id: id++, al_number: 'BB0RS8', total_qty: 2000, status: 'Issued', remark: '' });
  dos.push({ id: id++, al_number: 'BB0RS8', total_qty: 1000, status: 'Issued', remark: '' });
  dos.push({ id: id++, al_number: 'HJBX24', total_qty: 1200, status: 'Issued', remark: '' });
  dos.push({ id: id++, al_number: 'HJBX24', total_qty: 500, status: 'Cancelled', remark: '' });
  dos.push({ id: id++, al_number: 'HJBX24', total_qty: 300, status: 'Issued', remark: 'x [CANCELLED]' });
  const als = [
    { al_number: 'BB0RS8', quantity_ordered: 3000, balance_quantity: 1769 },
    { al_number: 'HJBX24', quantity_ordered: 3000, balance_quantity: 3000 },
    { al_number: 'BIG', quantity_ordered: 5000, balance_quantity: 5000 },
    { al_number: 'NONE', quantity_ordered: 700, balance_quantity: 650 },
  ];
  const sb = fakeSupabase(dos);
  const live = await mod.withLiveBalance(sb, als);
  check('BB0RS8: 3,000 ordered, 3,000 delivered reads 0 (stored said 1,769)', live[0].balance_quantity, 0);
  check('HJBX24: a cancelled DO and a [CANCELLED] remark take nothing off', live[1].balance_quantity, 1800);
  check('an AL with 1,500 DOs is not cut at 1,000 (5,000 - 3,000)', live[2].balance_quantity, 2000);
  check('an AL with no DO reads its ordered quantity', live[3].balance_quantity, 700);
  check('the stored figure rides along for comparison', live.map((r) => r._storedBalance), [1769, 3000, 5000, 650]);

  console.log('\n3. With no line it keeps the stored figure');
  const off = await mod.withLiveBalance(fakeSupabase(dos, { fail: true }), als);
  check('a refused read leaves every row as it came', off.map((r) => r.balance_quantity), [1769, 3000, 5000, 650]);

  console.log('\n4. The pages are wired to it, and nothing on the phone writes the balance');
  const consent = strip(read('src/pages/Consent.jsx'));
  const signing = strip(read('src/pages/DoSigning.jsx'));
  const queue = strip(read('src/lib/mobileQueue.js'));
  check('Consent works the balance out (active list, completed list, search)',
    (consent.match(/withLiveBalance\(supabase/g) || []).length, 3);
  check('DO Signing works the balance out', /withLiveBalance\(supabase/.test(signing), true);
  check('neither page filters on the stored column any more',
    [/\.gt\('balance_quantity'/.test(consent), /\.lte\('balance_quantity'/.test(consent), /\.gt\('balance_quantity'/.test(signing)],
    [false, false, false]);
  check('the DO send no longer writes balance_quantity', /balance_quantity/.test(queue), false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

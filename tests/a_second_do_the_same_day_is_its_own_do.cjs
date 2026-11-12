/* A SECOND DO THE SAME DAY IS ITS OWN DO, WITH ITS OWN NUMBER.
 *
 * A customer collects in the morning (DO-MUGJB901) and comes back for more
 * the same day. The second DO must be DO-MUGJB902. On 5 Nov the FC Portal
 * wrote 901 twice. This app had a worse version of it: sendDO asked "is
 * this do_number already in the table" and, if so, treated the save as a
 * retry and RETURNED WITHOUT INSERTING, so a genuine second DO handed the
 * same preview number was dropped without a word.
 *
 * Now the database hands out the number (shared/RUN_ME_do_number_never_
 * repeats.sql moves a number already taken), a retry is recognised by
 * client_uid (one id per press of Save), and the printed DO carries the
 * number on the row that came back.
 *
 * The REAL sendDO and its helpers are lifted out of the shipped
 * src/lib/mobileQueue.js.
 *
 * Run: node tests/a_second_do_the_same_day_is_its_own_do.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const ok = (m) => console.log('ok    ' + m);
const bad = (m) => { console.log('FAIL  ' + m); failed++; };
const is = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want) ? ok(m)
  : bad(m + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/lib/mobileQueue.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'src/pages/DoSigning.jsx'), 'utf8');
const grab = (decl, name) => {
  const at = SRC.indexOf(decl + name);
  if (at < 0) return '';
  const from = SRC.indexOf(')', at);
  let depth = 0;
  for (let j = SRC.indexOf('{', from); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1).replace(/^export /, '');
  }
  return '';
};

function makeSupabase(state) {
  const exec = (q) => {
    if (q.table === 'shared_al_orders') {
      if (q.op === 'update') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { balance_quantity: 120 }, error: null });
    }
    if (q.op === 'insert') {
      const r = { id: ++state.nextId, ...q.rows[0] };
      if (state.noUidColumn && 'client_uid' in r) {
        return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'client_uid' column of 'shared_do_records' in the schema cache" } });
      }
      if (r.client_uid && state.dos.some((d) => d.client_uid === r.client_uid)) {
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "shared_do_records_one_per_press"' } });
      }
      // The trigger: a taken number of the order series moves to the next free one.
      const pfx = 'DO-' + r.al_number;
      if (state.dos.some((d) => d.do_number === r.do_number)) {
        let max = 0;
        state.dos.forEach((d) => { const t = String(d.do_number); if (t.startsWith(pfx)) max = Math.max(max, parseInt(t.slice(pfx.length), 10) || 0); });
        r.do_number = pfx + String(max + 1).padStart(2, '0');
      }
      state.dos.push(r);
      if (state.loseAckOnce) { state.loseAckOnce = false; return Promise.reject(new Error('timed out (the row landed)')); }
      return Promise.resolve({ data: r, error: null });
    }
    let rows = state.dos.filter((d) => q.filters.every(([f, v]) => d[f] === v));
    if (state.noUidColumn && q.filters.some(([f]) => f === 'client_uid')) {
      return Promise.resolve({ data: null, error: { code: '42703', message: 'column shared_do_records.client_uid does not exist' } });
    }
    return Promise.resolve({ data: q.single ? rows[0] || null : rows, error: null });
  };
  return {
    from(table) {
      const q = { table, op: 'select', filters: [], single: false };
      const api = {
        select() { return api; }, insert(rows) { q.op = 'insert'; q.rows = rows; return api; },
        update() { q.op = 'update'; return api; }, eq(f, v) { q.filters.push([f, v]); return api; },
        limit() { return api; }, single() { q.single = true; return api; }, maybeSingle() { q.single = true; return api; },
        then(a, b) { return exec(q).then(a, b); },
      };
      return api;
    },
  };
}

function build(state) {
  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Boolean, Promise, parseInt, Error, Date,
    crypto: require('crypto').webcrypto,
    supabase: makeSupabase(state),
    uploadPhoto: async () => 'url', uploadSignature: async () => 'url',
    attachDOToOrder: async ({ payload }) => { state.attached.push(payload.do_number); return true; },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext([
    (SRC.match(/^let _doNoClientUid = .*$/m) || [''])[0],
    grab('export function ', 'newDOPressId'),
    grab('function ', 'namesClientUid'),
    grab('async function ', 'doByPress'),
    grab('export async function ', 'sendDO'),
    ';globalThis.__api = { sendDO, newDOPressId: typeof newDOPressId === "function" ? newDOPressId : null };',
  ].join('\n'), ctx);
  return ctx.__api;
}

const fresh = () => ({ dos: [], nextId: 0, attached: [] });
const job = (num, qty, uid) => ({
  payload: Object.assign({ do_number: num, al_number: 'MUGJB9', delivery_date: '2026-11-05', total_qty: qty, status: 'Delivered' },
    uid ? { client_uid: uid } : {}),
  alId: 1, totalQty: qty, al: { al_number: 'MUGJB9' }, staff: 'x',
});

(async () => {
  console.log('1. The office own morning: two DOs, the second handed the same preview number');
  {
    const s = fresh(); const api = build(s);
    const press = () => (api.newDOPressId ? api.newDOPressId() : undefined);
    const a = await api.sendDO(job('DO-MUGJB901', 13, press()));
    const b = await api.sendDO(job('DO-MUGJB901', 47, press()));
    is(s.dos.map((d) => [d.do_number, d.total_qty]), [['DO-MUGJB901', 13], ['DO-MUGJB902', 47]],
      'BOTH DOs are in the table, as 01 and 02 — the second was not dropped');
    is([a && a.do_number, b && b.do_number], ['DO-MUGJB901', 'DO-MUGJB902'], 'and each save handed back its own row');
    is(s.attached, ['DO-MUGJB901', 'DO-MUGJB902'], 'the customer portal got two PDFs under two numbers');
  }

  console.log('\n2. A save that landed and lost its answer, sent again, is still ONE DO');
  {
    const s = fresh(); const api = build(s);
    const j = job('DO-MUGJB901', 13, 'press-1');
    s.loseAckOnce = true;
    try { await api.sendDO(j); } catch (e) { /* the phone heard nothing back */ }
    const again = await api.sendDO(j);
    is(s.dos.length, 1, 'one row, not two');
    is(again && again.do_number, 'DO-MUGJB901', 'and the retry got that row back');
  }

  console.log('\n3. A database that has not had the SQL run still takes a DO');
  {
    const s = fresh(); s.noUidColumn = true; const api = build(s);
    let err = null;
    try { await api.sendDO(job('DO-MUGJB901', 13, 'press-2')); } catch (e) { err = e.message; }
    is([err, s.dos.length], [null, 1], 'saved, once, without the column it does not have');
  }

  console.log('\n4. The page stamps a press and prints the number on the row');
  {
    is(/client_uid:\s*newDOPressId\(\)/.test(PAGE), true, 'each press of Save carries its own client_uid');
    is(/savedDO\s*&&\s*savedDO\.do_number/.test(PAGE), true, 'the printed DO uses the number the database gave the row');
  }

  console.log('\n' + (failed ? failed + ' FAILED' : 'all checks passed'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('harness died: ' + e.message); process.exit(1); });

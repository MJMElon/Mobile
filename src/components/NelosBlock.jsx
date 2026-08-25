/* ══════════════════════════════════════════════════════════════════════
   NELOS — THE ADMIN PORTAL'S PENDING CASES

   The same to-do list the other portals carry, above the module cards on
   the Admin Portal dashboard: what is waiting for whoever just signed in,
   worst and latest first.

   Ported rather than imported. Nelos ships as two vanilla scripts in the
   mjm-ai-system repo (shared/shared_nelos.js and shared_nelos_dock.js),
   and this is a different site on a different build — mobile.mjmnursery.com
   against ai.mjmnursery.com — so there is no script tag to drop in. What
   is copied is the DECISIONS, and each of them is named below so the two
   can be checked against each other:

     • pending = status in (open, in_progress)
     • due date first (nulls last), then created; priority re-sorted here
       because it is a word in the database, not a number
     • scope: nelos_my_scope() — see whoseCases()
     • queue: assigned_module, falling back to source_module
     • grouped Overdue (pinned) → Assigned to me → Other pending

   If any of those change over there, change them here.

   Everything fails SOFT. The dashboard worked before Nelos existed and
   is not ours to break: a missing table, an un-run migration, a stale
   session or a network blip all render nothing at all rather than an
   error where the cases should be.
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/* Nelos lives on the hub, which is a different origin from this portal —
   so these are absolute where every other link in this app is relative. */
const AI_ROOT = 'https://ai.mjmnursery.com/';
const caseHref = (id) => `${AI_ROOT}nelos/nelos_case.html?id=${encodeURIComponent(id)}`;
const homeHref = () => `${AI_ROOT}nelos/nelos_dashboard.html`;

/* This portal's own key in nelos_cases.source_module / assigned_module.
   'mobile' rather than 'admin': it is what the module was called when the
   case log was built, and renaming it is a database migration, not a
   constant. SOURCE_LABEL below is where it becomes "Admin Portal". */
const MODULE = 'mobile';

const PENDING = ['open', 'in_progress'];
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

/* Fallback labels for the chip on each line. The live ones are rows in
   nelos_modules, which the Nelos User Setting page can rename — this list
   is what shows until then, and it is duplicated in both shared scripts.
   Keep all three in step. */
const SOURCE_LABEL = {
  operation: 'Seedling Stock System',
  nursery_ops: 'Nursery Operation',
  scan: 'FC Portal',
  mobile: 'Admin Portal',
  audit: 'Audit Portal',
  npayroll: 'Payroll',
  nelos: 'Nelos',
};

/* BASE_COLS is everything migration_nelos.sql created — the columns every
   database with a case log has. ROUTED_COLS adds what the routing and seat
   migrations added later. Asking for a column that does not exist does not
   return that column as null: PostgREST rejects the WHOLE select with a
   400, which is how the dock once vanished from every page at once. So the
   routed set is tried first and the base set is the fallback. */
const BASE_COLS =
  'id,case_no,title,category,priority,status,source_module,nursery_name,' +
  'plot_name,batch_name,assignee_id,assignee_name,due_date,created_at';
const ROUTED_COLS = `${BASE_COLS},assigned_module,assigned_seat_no`;

/* How long to wait before deciding the case log is not answering.

   Not belt-and-braces: measured. With the nelos_cases request aborted
   mid-flight — a phone dropping off the nursery wifi — the client retried
   three times and then neither resolved nor rejected, so the block sat on
   "loading cases…" for as long as the page stayed open. A widget bolted
   onto someone else's dashboard does not get to spin forever; after this
   it stands down and the dashboard is simply a dashboard without Nelos on
   it. Long enough for a bad phone signal, short enough to be an answer. */
const TIMEOUT_MS = 12000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out after ' + ms + 'ms')), ms);
    }),
  ]);
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const isOverdue = (c) => !!c.due_date && c.due_date < todayISO();
const queueOf = (c) => c.assigned_module || c.source_module;

function dueText(d) {
  if (!d) return null;
  let label = d;
  try {
    label = new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
  } catch {
    /* keep the ISO string */
  }
  return d < todayISO()
    ? <span className="nelos-due-over">⏰ overdue {label}</span>
    : <span className="whitespace-nowrap">due {label}</span>;
}

/* ── Who sees which cases ────────────────────────────────────────────
   A person is pinned to one home module on the Nelos User Setting page,
   and from that pin sees their home module's queue plus anything assigned
   to them personally in any queue. A case routed to a numbered seat
   ("Admin 1") is only that seat's; one with no seat is the whole module's.

   Not pinned, Nelos admin, or the lookup fails → no restriction. A scope
   check that cannot run must never HIDE cases: showing someone one case
   too many costs a moment, hiding one costs the case. */
async function whoseCases(uid) {
  const open = { unrestricted: true };
  if (!uid) return open;
  try {
    const { data, error } = await supabase.rpc('nelos_my_scope', {});
    if (error) return open;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.is_admin || row.sees_all || !row.primary_module) return open;
    const list = Array.isArray(row.categories) ? row.categories.filter(Boolean) : [];
    return {
      unrestricted: false,
      home: row.primary_module,
      seatNo: row.seat_no ?? null,
      cats: list.length ? new Set(list) : null,
      userId: uid,
    };
  } catch {
    return open;
  }
}

function inScope(c, sc) {
  if (!sc || sc.unrestricted) return true;
  // My name on it — mine wherever it sits, and never category-filtered.
  if (sc.userId && c.assignee_id && c.assignee_id === sc.userId) return true;
  if (queueOf(c) !== sc.home) return false;
  if (c.assigned_seat_no && c.assigned_seat_no !== sc.seatNo) return false;
  if (!sc.cats) return true;
  return !!c.category && sc.cats.has(c.category);
}

async function fetchPending() {
  let uid = null;
  try {
    const { data: sess } = await supabase.auth.getSession();
    uid = sess?.session?.user?.id || null;
  } catch {
    return { rows: [], failed: true };
  }
  if (!uid) return { rows: [], failed: true };

  const ask = (cols) =>
    supabase
      .from('nelos_cases')
      .select(cols)
      .in('status', PENDING)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(50);

  let data, error;
  try {
    ({ data, error } = await ask(ROUTED_COLS));
  } catch (e) {
    // A rejected fetch — the phone dropped off the network mid-request —
    // never reaches the `error` branch below, so it is caught here. Without
    // this the throw escaped the whole component and the block sat on
    // "loading cases…" for as long as the page stayed open.
    console.warn('[nelos] pending cases unreachable:', e?.message || e);
    return { rows: [], failed: true };
  }
  if (error) {
    // 42703 = undefined column: this database has not run the routing and
    // seat migrations. Ask for what it does have rather than standing down
    // — without them every case simply sits in the queue that raised it.
    if (error.code === '42703') {
      console.warn(
        '[nelos] nelos_cases has no routing columns yet — run ' +
          'shared/migration_nelos_routing.sql and shared/migration_nelos_seats.sql. ' +
          'Falling back to source_module.',
      );
      try {
        ({ data, error } = await ask(BASE_COLS));
      } catch (e) {
        console.warn('[nelos] pending cases unreachable:', e?.message || e);
        return { rows: [], failed: true };
      }
    }
    if (error) {
      console.warn('[nelos] pending cases unavailable:', error.message || error);
      return { rows: [], failed: true };
    }
  }

  const rows = (data || [])
    .slice()
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));

  const sc = await whoseCases(uid);
  const seen = sc.unrestricted ? rows : rows.filter((c) => inScope(c, sc));

  /* This is the Admin Portal's own to-do, so it is the Admin Portal's
     queue — plus anything with your name on it, wherever it was routed,
     because that is yours to answer from whichever page you are on. */
  return {
    rows: seen.filter((c) => queueOf(c) === MODULE || c.assignee_id === uid),
    uid,
    failed: false,
  };
}

function Row({ c }) {
  const subject = [c.batch_name && `Batch ${c.batch_name}`, c.plot_name, c.nursery_name]
    .filter(Boolean)
    .join(' · ');
  const bits = [
    c.case_no,
    subject,
    c.assignee_name ? `→ ${c.assignee_name}` : null,
  ].filter(Boolean);
  return (
    <a
      className={`nelos-row${isOverdue(c) ? ' nelos-row-over' : ''}`}
      href={caseHref(c.id)}
      target="_blank"
      rel="noopener"
    >
      <span
        className={`nelos-dot nelos-p-${c.priority || 'normal'}`}
        title={PRIORITY_LABEL[c.priority] || ''}
      />
      <span className="nelos-row-main">
        <span className="nelos-row-title">{c.title}</span>
        <span className="nelos-row-meta">
          <span className="nelos-chip">{SOURCE_LABEL[c.source_module] || c.source_module || ''}</span>
          {bits.map((b) => <span key={b}> · {b}</span>)}
          {c.due_date && <> · {dueText(c.due_date)}</>}
          {!c.assignee_name && <> · <em>unassigned</em></>}
        </span>
      </span>
    </a>
  );
}

export default function NelosBlock() {
  const [state, setState] = useState({ status: 'loading', rows: [], uid: null });

  useEffect(() => {
    let alive = true;
    async function run() {
      let result;
      try {
        result = await withTimeout(fetchPending(), TIMEOUT_MS);
      } catch (e) {
        // Last line of defence. Whatever went wrong, this block standing
        // down is the correct outcome — a dashboard that never finishes
        // loading is worse than one that does not mention Nelos.
        console.warn('[nelos] block standing down:', e?.message || e);
        result = { rows: [], failed: true };
      }
      if (!alive) return;
      setState({ status: result.failed ? 'failed' : 'ready', rows: result.rows, uid: result.uid });
    }
    run();
    /* Long shifts leave this page open. Refresh, but only while somebody is
       actually looking at it — a tab left open on the office machine for a
       week would otherwise keep asking all week for nobody. */
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, []);

  // Nothing to say, and nothing worth breaking the dashboard over.
  if (state.status === 'failed') return null;
  if (state.status === 'loading') {
    return (
      <div className="nelos-todo mb-4">
        <div className="nelos-empty">loading cases…</div>
      </div>
    );
  }

  const { rows, uid } = state;
  const mine = (c) => !!uid && c.assignee_id === uid;
  const over = rows.filter(isOverdue);
  const rest = rows.filter((c) => !isOverdue(c));
  const restMine = rest.filter(mine);
  const restOther = rest.filter((c) => !mine(c));

  /* A heading only earns its place when there is more than one group. */
  const groups = [over.length, restMine.length, restOther.length].filter(Boolean).length;

  return (
    <div className="nelos-todo mb-4">
      <div className="nelos-todo-head">
        {/* Just "Nelos". The longer "Nelos — Pending Cases" wrapped to two
            lines on a phone and pushed the count onto the first one on its
            own; and the words are already carried by the count chip and the
            group headings below it. */}
        <span className="nelos-todo-title">📋 Nelos</span>
        <span className={`nelos-todo-count${rows.length ? '' : ' zero'}`}>
          {rows.length || 'clear'}
        </span>
        <a className="nelos-todo-all" href={homeHref()} target="_blank" rel="noopener">
          Open Nelos →
        </a>
      </div>

      {!rows.length && <div className="nelos-empty">Nothing pending — all clear ✓</div>}

      {/* Overdue leads and says so. It is the one group whose heading shows
          even when it is the only one: "3 pending" and "3 overdue" are not
          the same news. */}
      {!!over.length && (
        <>
          <div className="nelos-sec nelos-sec-over">⏰ Overdue · {over.length}</div>
          {over.map((c) => <Row key={c.id} c={c} />)}
        </>
      )}
      {!!restMine.length && (
        <>
          {groups > 1 && <div className="nelos-sec">Assigned to me · {restMine.length}</div>}
          {restMine.map((c) => <Row key={c.id} c={c} />)}
        </>
      )}
      {!!restOther.length && (
        <>
          {groups > 1 && <div className="nelos-sec">Other pending cases · {restOther.length}</div>}
          {restOther.map((c) => <Row key={c.id} c={c} />)}
        </>
      )}
    </div>
  );
}

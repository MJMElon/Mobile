/* ══════════════════════════════════════════════════════════════════════
   NELOS — WORKING A CASE WITHOUT LEAVING THE ADMIN PORTAL

   A sheet over the dashboard: the case, its thread, a comment box and the
   buttons that move it along. Everything an admin needs to settle a case
   happens here, so nothing on this portal sends anyone to the hub.

   The writes are nelos_case.html's, move for move — same fields, same
   system-note wording, same order — because a case settled here has to be
   indistinguishable from one settled there. Anyone reading the thread
   later cannot be able to tell which page it was worked on:

     Start Work   status → in_progress; claims it if nobody owns it, so
                  "In Progress, unassigned" never becomes a place cases go
                  to be forgotten. Note: "Started work[ and took
                  ownership] — <name>"
     Resolve      status → resolved, with the resolution text, resolved_by
                  and resolved_at. The text is required: a case resolved
                  with no account of what was done is a case nobody can
                  check. Note: "Resolved — <name>"
     Close        status → closed, closed_by, closed_at. Confirmed first —
                  it leaves everyone's to-do list. Note: "Closed — <name>"
     Reopen       status → open, and the resolved/closed stamps cleared
                  rather than left to contradict the status.
                  Note: "Reopened — <name>"

   Resolving straight from Open is allowed. Plenty of cases are dealt with
   the moment they are read, and making someone click Start first is
   theatre — that is nelos_case.html's rule too.

   If nelos_case.html's rules change, change them here.
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
const SOURCE_LABEL = {
  operation: 'Seedling Stock System',
  nursery_ops: 'Nursery Operation',
  scan: 'FC Portal',
  mobile: 'Admin Portal',
  audit: 'Audit Portal',
  npayroll: 'Payroll',
  nelos: 'Nelos',
};

const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtStamp = (ts) =>
  ts ? new Date(ts).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const initials = (n) =>
  String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default function NelosCase({ caseId, me, onClose }) {
  const [c, setC] = useState(null);
  const [thread, setThread] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [flash, setFlash] = useState(null);
  const changed = useRef(false);
  const resolutionRef = useRef(null);
  const commentRef = useRef(null);

  /* select('*') rather than a column list. Nelos has grown columns over
     several migrations (photo_url, resolution, the seat fields) and asking
     for one this database has not got would fail the whole read — the
     mistake that once emptied the dock everywhere. One row, so the width
     costs nothing. */
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('nelos_cases').select('*').eq('id', caseId).single();
    if (error) {
      setErr(error.message || 'Could not open this case.');
      return;
    }
    setC(data);
    const { data: rows } = await supabase
      .from('nelos_case_comments')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: true });
    setThread(rows || []);
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escape closes, as it does on any sheet.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose(changed.current);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* A system note, best-effort. A status change that saved but whose note
     did not is untidy; a status change refused because the note failed
     would be worse. nelos_case.html swallows the same failure. */
  async function note(body, kind = 'status') {
    try {
      await supabase.from('nelos_case_comments').insert([
        { case_id: caseId, body, kind, author_name: me.name, author_id: me.id },
      ]);
    } catch {
      /* the case still moved */
    }
  }

  async function patch(fields, noteText) {
    setBusy(true);
    setFlash(null);
    try {
      const { data, error } = await supabase
        .from('nelos_cases')
        .update({ updated_by: me.name, updated_at: new Date().toISOString(), ...fields })
        .eq('id', caseId)
        .select()
        .single();
      if (error) {
        setFlash({ ok: false, msg: `Could not save — ${error.message}` });
        return false;
      }
      changed.current = true;
      setC(data);
      if (noteText) await note(noteText);
      await load();
      return true;
    } catch (e) {
      setFlash({ ok: false, msg: `Could not save — ${e?.message || 'network'}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const claim = c.assignee_id ? {} : { assignee_id: me.id, assignee_name: me.name };
    await patch(
      { status: 'in_progress', ...claim },
      `Started work${c.assignee_id ? '' : ' and took ownership'} — ${me.name}`,
    );
  }

  async function confirmResolve() {
    const text = resolutionRef.current?.value.trim();
    if (!text) {
      setFlash({ ok: false, msg: 'Say what was done before resolving.' });
      resolutionRef.current?.focus();
      return;
    }
    const ok = await patch(
      { status: 'resolved', resolution: text, resolved_by: me.name, resolved_at: new Date().toISOString() },
      `Resolved — ${me.name}`,
    );
    if (ok) {
      setResolving(false);
      setFlash({ ok: true, msg: 'Case resolved.' });
    }
  }

  async function closeCase() {
    if (!window.confirm("Close this case? It leaves everyone's To-Do list.")) return;
    await patch(
      { status: 'closed', closed_by: me.name, closed_at: new Date().toISOString() },
      `Closed — ${me.name}`,
    );
  }

  async function reopen() {
    await patch(
      { status: 'open', resolved_at: null, resolved_by: null, closed_at: null, closed_by: null },
      `Reopened — ${me.name}`,
    );
  }

  async function postComment() {
    const body = commentRef.current?.value.trim();
    if (!body) return;
    setBusy(true);
    await note(body, 'comment');
    commentRef.current.value = '';
    changed.current = true;
    await load();
    setBusy(false);
  }

  const sheet = (inner) => (
    <div className="nc-scrim" onClick={(e) => e.target === e.currentTarget && onClose(changed.current)}>
      <div className="nc-sheet" role="dialog" aria-label="Nelos case">{inner}</div>
    </div>
  );

  if (err) {
    return sheet(
      <>
        <div className="nc-head">
          <button className="nc-x" onClick={() => onClose(changed.current)} aria-label="Close">✕</button>
        </div>
        <div className="nelos-empty">{err}</div>
      </>,
    );
  }
  if (!c) return sheet(<div className="nelos-empty">loading case…</div>);

  const s = c.status;
  const subject = [c.batch_name && `Batch ${c.batch_name}`, c.plot_name && `Plot ${c.plot_name}`, c.nursery_name]
    .filter(Boolean)
    .join('  ·  ');
  const overdue = c.due_date && c.due_date < new Date().toISOString().slice(0, 10) && (s === 'open' || s === 'in_progress');
  /* Every status this page knows offers at least one move, so the "nothing
     to do" line is a fallback for a status that arrives from somewhere
     else — never something shown beside a live button. It read as a
     contradiction next to Reopen on a closed case. */
  const hasActions = s === 'open' || s === 'in_progress' || s === 'resolved' || s === 'closed';

  return sheet(
    <>
      <div className="nc-head">
        <span className="nelos-chip">{SOURCE_LABEL[c.source_module] || c.source_module || ''}</span>
        <span className="nc-no">{c.case_no || ''}</span>
        <button className="nc-x" onClick={() => onClose(changed.current)} aria-label="Close">✕</button>
      </div>

      <h2 className="nc-title">{c.title}</h2>

      <div className="nc-pills">
        <span className={`nc-pill nc-pi-${c.priority || 'normal'}`}>{PRIORITY_LABEL[c.priority] || c.priority}</span>
        <span className={`nc-pill nc-st-${s}`}>{STATUS_LABEL[s] || s}</span>
      </div>

      {subject && <div className="nc-subject">📍 {subject}</div>}

      <dl className="nc-facts">
        <div><dt>Raised by</dt><dd>{c.raised_by || '—'}</dd></div>
        <div><dt>Assigned to</dt><dd>{c.assignee_name || <em>unassigned</em>}</dd></div>
        <div><dt>Category</dt><dd>{c.category || '—'}</dd></div>
        <div><dt>Due</dt><dd style={overdue ? { color: '#b91c1c' } : undefined}>{fmtDate(c.due_date)}</dd></div>
      </dl>

      {c.resolution && (
        <div className="nc-resolution">
          <div className="nc-sec-label">Resolution</div>
          <div className="nc-resolution-text">{c.resolution}</div>
          <div className="nc-resolution-meta">
            Resolved by {c.resolved_by || 'unknown'} · {fmtStamp(c.resolved_at)}
            {c.closed_at ? `  ·  Closed by ${c.closed_by || 'unknown'} · ${fmtStamp(c.closed_at)}` : ''}
          </div>
        </div>
      )}

      {flash && <div className={`nc-flash${flash.ok ? '' : ' nc-flash-bad'}`}>{flash.msg}</div>}

      <div className="nc-actions">
        {s === 'open' && <button className="nc-act nc-act-start" disabled={busy} onClick={start}>▶ Start Work</button>}
        {(s === 'open' || s === 'in_progress') && (
          <button className="nc-act nc-act-resolve" disabled={busy} onClick={() => setResolving((v) => !v)}>
            ✓ Mark Resolved
          </button>
        )}
        {s === 'resolved' && <button className="nc-act nc-act-close" disabled={busy} onClick={closeCase}>🔒 Close Case</button>}
        {(s === 'resolved' || s === 'closed') && (
          <button className="nc-act nc-act-reopen" disabled={busy} onClick={reopen}>↩ Reopen</button>
        )}
        {!hasActions && <span className="nc-nothing">Nothing to do on this case.</span>}
      </div>

      {resolving && (
        <div className="nc-resolve-box">
          <textarea ref={resolutionRef} className="nc-input" rows={3} placeholder="What was done?" autoFocus />
          <button className="nc-act nc-act-resolve" disabled={busy} onClick={confirmResolve}>Confirm Resolved</button>
        </div>
      )}

      <div className="nc-sec-label nc-thread-label">Thread</div>
      <div className="nc-thread">
        {thread.length ? (
          thread.map((r) => {
            const sys = r.kind !== 'comment';
            return (
              <div className="nc-item" key={r.id || `${r.created_at}-${r.body}`}>
                <div className={`nc-av${sys ? ' nc-av-sys' : ''}`}>{sys ? '⚙' : initials(r.author_name)}</div>
                <div className="min-w-0 flex-1">
                  <span className="nc-who">{r.author_name || 'Unknown'}</span>
                  <span className="nc-when"> · {fmtStamp(r.created_at)}</span>
                  <div className={`nc-body${sys ? ' nc-body-sys' : ''}`}>{r.body}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="nc-nothing">No comments yet.</div>
        )}
      </div>

      <textarea ref={commentRef} className="nc-input" rows={2} placeholder="Add a comment…" />
      <button className="nc-act nc-act-comment" disabled={busy} onClick={postComment}>Post Comment</button>
    </>,
  );
}

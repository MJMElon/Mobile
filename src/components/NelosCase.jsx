/* ══════════════════════════════════════════════════════════════════════
   NELOS — WORKING A CASE WITHOUT LEAVING THE ADMIN PORTAL

   A sheet over the dashboard: what the case says, and the block that
   solves it. The conversation is not here — the thread and its comment
   box are on the hub's own case page, which is where a case is read at
   length; this is where one gets answered.

   The writes are nelos_case.html's, move for move — same fields, same
   system-note wording, same order — because a case settled here has to be
   indistinguishable from one settled there. Anyone reading the thread
   later cannot be able to tell which page it was worked on:

     Resolve      status → resolved, with the resolution text, resolved_by
                  and resolved_at. The text is required: a case resolved
                  with no account of what was done is a case nobody can
                  check. Note: "Resolved — <name>"
     Close        status → closed, closed_by, closed_at. Confirmed first —
                  it leaves everyone's to-do list. Note: "Closed — <name>"
     Reopen       status → open, and the resolved/closed stamps cleared
                  rather than left to contradict the status.
                  Note: "Reopened — <name>"

   Resolving straight from Open is allowed and is now the only way through:
   Start Work has gone. Plenty of cases are dealt with the moment they are
   read, and a button that only moves a case to "in progress" was a step
   between opening it and answering it. nelos_case.html still offers it.

   If nelos_case.html's rules change, change them here.
   ══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

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

export default function NelosCase({ caseId, me, onClose }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const changed = useRef(false);
  const resolutionRef = useRef(null);
  const [shot, setShot] = useState(null);        // the photo of the fix, if one was taken

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

  /* The photo of the fix, into the same bucket and path shape the dock
     uses (shared/shared_nelos_dock.js → uploadShot) so one case's picture
     is in the same place whichever surface solved it. Upload first, then
     patch: a failed upload leaves the case as it was, whereas patching
     first would mark work solved and then lose the picture of it. */
  async function uploadShot(file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `solve/${caseId}-${Date.now()}.${ext || 'jpg'}`;
    const { error } = await supabase.storage.from('nelos-photos')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) return null;
    return supabase.storage.from('nelos-photos').getPublicUrl(path).data?.publicUrl || null;
  }

  async function confirmResolve() {
    const text = resolutionRef.current?.value.trim();
    if (!text) {
      setFlash({ ok: false, msg: 'Say what was done before resolving.' });
      resolutionRef.current?.focus();
      return;
    }
    const url = shot ? await uploadShot(shot) : null;
    const fields = { status: 'resolved', resolution: text, resolved_by: me.name,
                     resolved_at: new Date().toISOString() };
    /* Only when there is one: a database that has not run
       migration_nelos_solve_photo.sql has no such column, and asking it to
       write one would fail the whole resolve over a picture. */
    if (url) fields.resolution_photo_url = url;

    const ok = await patch(fields, `Resolved — ${me.name}`);
    if (ok) {
      setShot(null);
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
  const pending = s === 'open' || s === 'in_progress';
  /* Where the work is: the nursery with its plot in brackets, and the batch
     only when there is one — a batch case that did not say so would be
     missing the thing that identifies it. */
  let where = c.nursery_name ? c.nursery_name + (c.plot_name ? ` (${c.plot_name})` : '')
                             : (c.plot_name || '');
  if (c.batch_name) where = (where ? `${where} · ` : '') + `Batch ${c.batch_name}`;
  /* Every status this page knows offers at least one move, so the "nothing
     to do" line is a fallback for a status that arrives from somewhere
     else — never something shown beside a live button. It read as a
     contradiction next to Reopen on a closed case. */
  const hasActions = s === 'open' || s === 'in_progress' || s === 'resolved' || s === 'closed';

  /* The dock's case pane, move for move (shared/shared_nelos_dock.js →
     detailHtml). Two blocks in the order the job is done: read what is
     being asked, then answer it. Keep the two in step.

     What went: the priority and status pills and the module chip, which
     between them read "Nelos · Normal · Open" on very nearly every case —
     three words of nothing between the title and the work — and the
     Raised by / Assigned to / Category / Due grid, which said the same
     things at greater length. The case number stays in the head. */
  return sheet(
    <>
      <div className="nc-head">
        <span className="nc-no">{c.case_no || ''}</span>
        <button className="nc-x" onClick={() => onClose(changed.current)} aria-label="Close">✕</button>
      </div>

      <div className="nc-sec">Case Details</div>
      <h2 className="nc-title">{c.title}</h2>
      <div className="nc-meta">
        Created {fmtDate((c.created_at || '').slice(0, 10))}
        {c.raised_by ? ` · by ${c.raised_by}` : ''}
      </div>

      <div className="nc-facts">
        <div className="nc-fact"><div className="nc-k">Nursery (Plot)</div><div className="nc-v">{where || '—'}</div></div>
        <div className="nc-fact"><div className="nc-k">Assigned to</div>
          <div className="nc-v">{SOURCE_LABEL[c.assigned_module || c.source_module] || c.assigned_module || c.source_module || '—'}</div></div>
        <div className="nc-fact"><div className="nc-k">PIC</div>
          <div className="nc-v">{c.assignee_name || <em>Unassigned</em>}</div></div>
      </div>

      {/* What was written about it. The sheet never showed this at all,
          which left an admin deciding what to do from the title alone. */}
      {c.description
        ? <div className="nc-desc">{c.description}</div>
        : <div className="nc-nothing nc-desc">No further detail was written.</div>}

      {c.resolution && (
        <div className="nc-resolution">
          <div className="nc-sec-label">Resolution</div>
          <div className="nc-resolution-text">{c.resolution}</div>
          {c.resolution_photo_url &&
            <img className="nc-resolution-img" src={c.resolution_photo_url} alt="Photo of the fix" />}
          <div className="nc-resolution-meta">
            Resolved by {c.resolved_by || 'unknown'} · {fmtStamp(c.resolved_at)}
            {c.closed_at ? `  ·  Closed by ${c.closed_by || 'unknown'} · ${fmtStamp(c.closed_at)}` : ''}
          </div>
        </div>
      )}

      {flash && <div className={`nc-flash${flash.ok ? '' : ' nc-flash-bad'}`}>{flash.msg}</div>}

      <div className="nc-actions">
        {s === 'resolved' && <button className="nc-act nc-act-close" disabled={busy} onClick={closeCase}>🔒 Close Case</button>}
        {(s === 'resolved' || s === 'closed') && (
          <button className="nc-act nc-act-reopen" disabled={busy} onClick={reopen}>↩ Reopen</button>
        )}
        {!hasActions && <span className="nc-nothing">Nothing to do on this case.</span>}
      </div>

      {/* Solving is the whole reason a pending case gets opened, so the block
          to do it is ON SCREEN — the dock's case pane works this way and this
          did not: it hid the photo and the remark behind a "Mark Resolved"
          button, so opening a case showed no way to solve it until you had
          pressed something that sounded like it would solve it already. */}
      {pending && (
        <div className="nc-solve">
          <div className="nc-sec">Solve Case</div>

          {shot ? (
            <div className="nc-shot-prev">
              <img src={URL.createObjectURL(shot)} alt="Photo of the fix" />
              <button type="button" className="nc-shot-x" onClick={() => setShot(null)} aria-label="Remove photo">✕</button>
            </div>
          ) : (
            <label className="nc-shot">
              <span aria-hidden="true">📷</span>
              <span>Take or attach a photo</span>
              <input type="file" accept="image/*" capture="environment"
                     onChange={(e) => setShot(e.target.files?.[0] || null)} />
            </label>
          )}

          {/* Labelled rather than prompted from inside the box: a placeholder
              is gone the moment anybody types, so the one thing saying what
              the box is for disappears as they start filling it in. */}
          <div className="nc-solve-lab">Solve Case Remark</div>
          <textarea ref={resolutionRef} className="nc-input" rows={3} />
          <button className="nc-act nc-act-resolve" disabled={busy} onClick={confirmResolve}>Save &amp; Solve</button>
        </div>
      )}

    </>,
  );
}

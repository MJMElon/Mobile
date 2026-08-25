/* ══════════════════════════════════════════════════════════════════════
   NELOS — RAISING A CASE FROM THE ADMIN PORTAL

   The other half of settling cases here: noticing one. Somebody is in the
   middle of a delivery note, sees something wrong, and can say so without
   losing the page.

   The form asks the questions in the order the person answering them
   thinks:

     Assign to    which system works this — Seedling Stock, HQ Operation,
                  FC, Admin, Auditor.
                  Read from nelos_modules, not hardcoded: the User Setting
                  page can rename or add one, and this follows.
     Work         that system's own case titles. nelos_categories.module_key
                  scopes them, which is the whole point of that column —
                  the Audit Portal should not be offering "Height Shortfall".
     PIC          the people pinned to that system in nelos_handlers, by
                  name. Optional: a case with nobody on it is the system's
                  to pick up, which is how the queue is meant to work.
     Nursery      then the plots that nursery actually has.
     Photo        one picture, into the public nelos-photos bucket.
     Remarks      what you saw.

   Priority is not asked. It belongs to the KIND of case, not to the moment
   somebody is raising one — nelos_categories.default_priority already says
   what each kind is normally raised at, and the control only ever
   pre-filled itself from there.

   No date field. The date a case is raised is today, it is printed under
   the heading, and asking somebody to confirm the current date is asking
   them to do the computer's job. A due date still exists — the category's
   default_days sets it, exactly as the hub's form does.

   The insert mirrors MJMNelos.raise(), the dock's submitCase() and
   nelos_dashboard.html's own drawer: same columns, same defaults, the
   opening remark also posted into the thread so the case reads as one
   conversation from its first line, and the photo uploaded the same way to
   the same bucket.

   source_module stays 'mobile' — where it was raised. assigned_module is
   what the person chose, and the nelos_cases_route trigger honours an
   explicit one ("routing is the default, not a rule").
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/* The four nurseries and the plots each one has, copied from
   audit/audit_pending.js in the hub — which itself copies the module
   scripts, deliberately, because each runs on its own page. If a nursery
   gains plots there, it gains them here. */
const NURSERY_PLOTS = {
  PN: Array.from({ length: 52 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`),
  BNN: Array.from({ length: 14 }, (_, i) => `B${String(i + 1).padStart(2, '0')}`),
  UNN1: Array.from({ length: 18 }, (_, i) => `U${String(i + 1).padStart(2, '0')}`),
  UNN2: Array.from({ length: 20 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`),
};
const NURSERY_LABEL = { PN: 'Pre Nursery', BNN: 'BNN', UNN1: 'UNN1', UNN2: 'UNN2' };

/* Shown only if nelos_modules cannot be read. The five systems as they
   stand, in the order that table seeds them, under the short names
   nelos_modules.handler_label already carries. */
const FALLBACK_MODULES = [
  { key: 'operation', label: 'Seedling Stock' },
  { key: 'nursery_ops', label: 'HQ Operation' },
  { key: 'scan', label: 'FC' },
  { key: 'mobile', label: 'Admin' },
  { key: 'audit', label: 'Auditor' },
];

const MAX_PHOTO = 8 * 1024 * 1024;

export default function NelosNewCase({ module: sourceModule, me, onClose }) {
  const [modules, setModules] = useState(FALLBACK_MODULES);
  const [cats, setCats] = useState([]);
  const [people, setPeople] = useState([]);

  const [assignTo, setAssignTo] = useState('');
  const [work, setWork] = useState('');
  const [pic, setPic] = useState('');
  const [nursery, setNursery] = useState('');
  const [plot, setPlot] = useState('');
  const [photo, setPhoto] = useState(null); // { file, url }

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const titleRef = useRef(null);
  const remarksRef = useRef(null);
  const fileRef = useRef(null);

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const todayLabel = today.toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  /* Systems, case titles and people, all three read once. Each fails on its
     own terms: no modules leaves the five above, no categories turns Work
     into a free-text line, no people leaves the case unassigned — which is
     a valid case, not a blocked form. */
  useEffect(() => {
    let alive = true;

    /* handler_label is the short name — Seedling Stock, HQ Operation, FC,
       Admin, Auditor — and it already exists: migration_nelos_seats.sql seeded it as the half of
       "Admin 1" that is not the number. "Assign to" wants the same five
       words, so it reads them rather than inventing a second set that could
       drift. `label` is the fallback for a system added later that has not
       been given one. */
    supabase
      .from('nelos_modules')
      .select('key,label,handler_label')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (!alive || error || !data?.length) return;
        setModules(data.map((m) => ({ key: m.key, label: m.handler_label || m.label })));
      });

    supabase
      .from('nelos_categories')
      .select('name,module_key,default_priority,default_days')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!alive || error) return;
        setCats(data || []);
      });

    /* nelos_handlers, not the nelos_people() RPC: that one is admin-only
       (it checks manage_users or nelos admin), and anybody entitled to
       raise a case needs to be able to name who should get it. The table
       is readable by any authenticated user and carries the pin this
       needs. */
    supabase
      .from('nelos_handlers')
      .select('user_id,full_name,email,primary_module')
      .then(({ data, error }) => {
        if (!alive || error) return;
        setPeople(data || []);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Revoke the preview's object URL rather than leaking it.
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);

  const worksFor = assignTo ? cats.filter((c) => c.module_key === assignTo) : [];
  /* Sorted by name inside the system, which is what makes a list of people
     scannable — the pin decides who is in it, the name decides the order. */
  const picsFor = assignTo
    ? people
        .filter((p) => p.primary_module === assignTo)
        .map((p) => ({ id: p.user_id, name: p.full_name || p.email || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  /* Changing the system invalidates the two answers that hang off it. */
  function pickAssignTo(key) {
    setAssignTo(key);
    setWork('');
    setPic('');
  }

  /* Priority is no longer asked for. It is a property of the KIND of case,
     not a judgement the person raising it should have to make at the moment
     they are raising it — nelos_categories.default_priority already says
     what each kind is normally raised at, and the control only ever
     pre-filled itself from there. No default_priority, or no set titles for
     that system at all, means normal. */
  function priorityFromWork() {
    const c = worksFor.find((x) => x.name === work);
    return c?.default_priority || 'normal';
  }

  function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO) {
      setErr('That photo is over 8 MB — take a smaller one.');
      e.target.value = '';
      return;
    }
    setErr(null);
    if (photo?.url) URL.revokeObjectURL(photo.url);
    setPhoto({ file, url: URL.createObjectURL(file) });
  }

  function dropPhoto() {
    if (photo?.url) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  /* The due date the chosen work normally gets, counted from today. No
     default_days means no due date, which is honest — a case nobody set a
     deadline for does not get an invented one. */
  function dueFromWork() {
    const c = worksFor.find((x) => x.name === work);
    if (!c || c.default_days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() + Number(c.default_days));
    return d.toISOString().slice(0, 10);
  }

  async function submit() {
    /* The chosen work IS the case's title — that is what "choose work"
       means. A system with no case titles set up yet falls back to a typed
       line, so an empty nelos_categories cannot make this form unusable. */
    const title = (worksFor.length ? work : titleRef.current?.value.trim()) || '';
    if (!assignTo) return setErr('Choose who this is for.');
    if (!title) {
      setErr(worksFor.length ? 'Choose the work.' : 'Say what the case is.');
      if (!worksFor.length) titleRef.current?.focus();
      return;
    }

    setBusy(true);
    setErr(null);
    const remarks = remarksRef.current?.value.trim() || null;

    try {
      /* Photo first. If it fails the case is not raised, and the form stays
         open with everything still typed in — better than a case that
         quietly lost its picture. */
      let photoUrl;
      if (photo?.file) {
        const f = photo.file;
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `${todayISO}/${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('nelos-photos')
          .upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) {
          setErr(`Photo upload failed — ${upErr.message}`);
          setBusy(false);
          return;
        }
        photoUrl = supabase.storage.from('nelos-photos').getPublicUrl(path).data.publicUrl;
      }

      const picRow = picsFor.find((p) => p.id === pic);
      const row = {
        title: title.slice(0, 300),
        description: remarks,
        category: worksFor.length ? work : null,
        priority: priorityFromWork(),
        status: 'open',
        source_module: sourceModule,
        assigned_module: assignTo,
        nursery_name: nursery || null,
        plot_name: plot || null,
        assignee_id: picRow?.id || null,
        assignee_name: picRow?.name || null,
        due_date: dueFromWork(),
        raised_by: me.name,
        raised_by_id: me.id,
      };
      // photo_url arrives with migration_nelos_case_tools.sql. Only send the
      // column when there is a photo, so a database without it still takes
      // the insert.
      if (photoUrl) row.photo_url = photoUrl;

      const { data, error } = await supabase.from('nelos_cases').insert([row]).select().single();
      if (error) {
        setErr(`Could not raise it — ${error.message}`);
        setBusy(false);
        return;
      }
      if (data && remarks) {
        try {
          await supabase.from('nelos_case_comments').insert([
            { case_id: data.id, body: remarks, kind: 'comment', author_name: me.name, author_id: me.id },
          ]);
        } catch {
          /* the case is raised; the opening note is not worth failing over */
        }
      }
      onClose(true);
    } catch (e) {
      setErr(`Could not raise it — ${e?.message || 'network'}`);
      setBusy(false);
    }
  }

  return (
    <div className="nc-scrim" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="nc-sheet" role="dialog" aria-label="Add new case">
        <div className="nc-head">
          <div className="min-w-0">
            <div className="nc-new-title">Add New Case</div>
            {/* The date, said rather than asked. */}
            <div className="nc-new-date">{todayLabel}</div>
          </div>
          <button className="nc-x" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>

        {err && <div className="nc-flash nc-flash-bad">{err}</div>}

        <label className="nc-label" htmlFor="nnc-to">Assign to</label>
        <select id="nnc-to" className="nc-input" value={assignTo} onChange={(e) => pickAssignTo(e.target.value)}>
          <option value="">— choose a system —</option>
          {modules.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>

        <label className="nc-label" htmlFor="nnc-work">Work</label>
        {worksFor.length ? (
          <select id="nnc-work" className="nc-input" value={work} onChange={(e) => setWork(e.target.value)}>
            <option value="">— choose the work —</option>
            {worksFor.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        ) : (
          /* Either no system is chosen yet, or that system has no case
             titles set up. Both are answered by saying so rather than by an
             empty dropdown that looks broken. */
          <input
            id="nnc-work"
            ref={titleRef}
            className="nc-input"
            placeholder={assignTo ? 'No set titles for this system — type one' : 'Choose a system first'}
            disabled={!assignTo}
          />
        )}

        <label className="nc-label" htmlFor="nnc-pic">PIC</label>
        <select
          id="nnc-pic"
          className="nc-input"
          value={pic}
          onChange={(e) => setPic(e.target.value)}
          disabled={!assignTo}
        >
          <option value="">
            {assignTo && !picsFor.length ? 'Nobody pinned to this system yet' : 'Anyone in that system'}
          </option>
          {picsFor.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <div className="nc-two">
          <div>
            <label className="nc-label" htmlFor="nnc-nursery">Nursery</label>
            <select
              id="nnc-nursery"
              className="nc-input"
              value={nursery}
              onChange={(e) => { setNursery(e.target.value); setPlot(''); }}
            >
              <option value="">— none —</option>
              {Object.keys(NURSERY_PLOTS).map((n) => (
                <option key={n} value={n}>{NURSERY_LABEL[n]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="nc-label" htmlFor="nnc-plot">Plot</label>
            <select
              id="nnc-plot"
              className="nc-input"
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              disabled={!nursery}
            >
              <option value="">{nursery ? '— none —' : 'Nursery first'}</option>
              {(NURSERY_PLOTS[nursery] || []).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="nc-label">Photo</label>
        {photo ? (
          <div className="nc-photo">
            <img src={photo.url} alt="" />
            <button type="button" className="nc-photo-x" onClick={dropPhoto} aria-label="Remove photo">✕</button>
          </div>
        ) : (
          /* capture="environment" opens the camera straight onto the back
             lens on a phone, and is simply ignored on a desktop, where the
             same control is a file picker. One control, both jobs. */
          <label className="nc-photo-pick">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={pickPhoto}
              hidden
            />
            <span>📷 Take or upload a photo</span>
          </label>
        )}

        <label className="nc-label" htmlFor="nnc-remarks">Remarks</label>
        <textarea id="nnc-remarks" ref={remarksRef} className="nc-input" rows={3} placeholder="What you saw" />

        <button className="nc-act nc-act-start nc-act-wide" disabled={busy} onClick={submit}>
          {busy ? 'Creating…' : 'Create New Case'}
        </button>
      </div>
    </div>
  );
}

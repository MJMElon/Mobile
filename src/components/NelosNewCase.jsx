/* ══════════════════════════════════════════════════════════════════════
   NELOS — RAISING A CASE FROM THE ADMIN PORTAL

   The other half of settling cases here: noticing one. Somebody is in the
   middle of a delivery note, sees something wrong, and can say so without
   losing the page.

   The form asks the questions in the order the person answering them
   thinks:

     Work         THE FIRST QUESTION, because the destination follows from
                  it. This system's own case titles — see worksFor below
                  for why they are the RAISING system's and not the
                  destination's.
     Assign to    which system works this — Seedling Stock, HQ Operation,
                  FC, Admin, Auditor.
                  Read from nelos_modules, not hardcoded: the User Setting
                  page can rename or add one, and this follows.
                  NOT ON SCREEN until the work is chosen: the rule answers
                  it, and a box asking who solves this, standing open above
                  a Work list full of jobs this system does not solve, is
                  two instructions where there is one question. See showDest
                  in shared_nelos_dock.js, which is the same rule.
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
import CfSelect from './CfSelect.jsx';
import { supabase } from '../lib/supabase';
import Icon from './Icon.jsx';

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
  /* THE RULES THE OFFICE SET ON CASE ROUTING. Read because this form writes
     assigned_module itself, and nelos_route_case() returns early on a case
     that already names its queue — so without them every rule on that
     screen is dead for anything raised here. Fails soft: no table, no
     rules, and the destination stays wherever the person left it. */
  const [routes, setRoutes] = useState([]);
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
      .from('nelos_routes')
      .select('source_module,category,to_module,to_user_id,to_user_name')
      .then(({ data, error }) => { if (alive && !error) setRoutes(data || []); });

    /* EVERY COLUMN, not the four this reads. raise_modules, pic_seat_no and
       pic_user_id arrive with RUN_ME_nelos_routing_is_the_category.sql, and
       naming a column a table has not got is not an empty cell in
       PostgREST — the whole select comes back 400 and the Work list is
       empty. Both the office dock and nelos_user_setting.html read this
       table the same way for the same reason. */
    supabase
      .from('nelos_categories')
      .select('*')
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
    /* `*`, so seat_no comes with it: the PIC the office sets on Case
       Routing is a SEAT ("Admin 2") and the box on this form is a PERSON,
       so the seat has to be resolved to whoever holds it. Naming seat_no
       on a database without it would empty the whole PIC list rather than
       leave out one field. */
    supabase
      .from('nelos_handlers')
      .select('*')
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

  /* WHICH LIST THE WORK DROPDOWN IS FILLED FROM: the titles the system this
     case is raised in is allowed to raise. Nothing else.

     It was the DESTINATION's titles once, and the office walked into what
     that means: choosing "give this to Admin" offered ADMIN's titles, so a
     title this system was meant to raise could not be chosen here at all.
     It was then this system's OWN titles, which was right as far as it went
     and still asked the question of a column that meant something else —
     nelos_categories.module_key is the system that SOLVES a title now, and
     who may raise one is the From System tick list on Case Routing.

     IT NEEDS NO FALLBACK ANY MORE. A system with no titles of its own used
     to borrow the destination's; a title the office has left open to any
     system is in every Work list, so that is answered by the rule rather
     than by an exception.

     SHARED RULE: the office dock's workList() / mayRaiseFrom() in
     mjm-ai-system shared/shared_nelos_dock.js is the same decision, and
     RUN_ME_nelos_routing_is_the_category.sql states the three meanings of
     raise_modules in its own words. Change one, change the others. */
  const ANY_SYSTEM = '*';
  const mayRaiseFrom = (c, key) => {
    const rm = c.raise_modules;
    // Absent or null is nobody having been asked, which is not a no
    // anywhere here; an EMPTY array is a deliberate nobody-by-hand, which
    // is what an automatic title wants. The two must not be folded in
    // together.
    if (rm === undefined || rm === null) return true;
    if (!rm.length) return false;
    return rm.includes(ANY_SYSTEM) || rm.includes(key);
  };
  const worksFor = cats.filter((c) => mayRaiseFrom(c, sourceModule));

  /* A SECTION DEFAULT, which is all of nelos_routes that is still live. A
     per-category row there is inert: the title names its own solver and
     both this form and nelos_route_case() read that first. What a default
     still answers is a title neither knows — a line somebody typed. */
  const defaultRouteFor = () =>
    routes.find((r) => r.source_module === sourceModule && !r.category) || null;

  /* WHO HOLDS A SEAT, e.g. who "Admin 2" is. The office sets the PIC as a
     seat, because a seat is a job and outlasts whoever sits in it; this
     form names a person. Nobody in that seat answers empty, which leaves
     the PIC unset — and no PIC has always meant the whole queue. */
  const seatHolder = (key, seatNo) => {
    if (!key || seatNo == null || seatNo === '') return '';
    const p = people.find((x) => x.primary_module === key
                              && Number(x.seat_no) === Number(seatNo));
    return p ? String(p.user_id) : '';
  };
  /* Sorted by name inside the system, which is what makes a list of people
     scannable — the pin decides who is in it, the name decides the order. */
  const picsFor = assignTo
    ? people
        .filter((p) => p.primary_module === assignTo)
        .map((p) => ({ id: p.user_id, name: p.full_name || p.email || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  /* Changing the system invalidates the PIC, which belongs to it. THE WORK
     ALWAYS SURVIVES now: the list is the titles this system may raise, so
     the destination cannot change it, and clearing the work would throw
     away an answer nothing had invalidated. */
  function pickAssignTo(key) {
    setAssignTo(key);
    setPic('');
  }

  /* CHOOSING THE WORK SAYS WHERE IT GOES, because that is what the office
     set on Case Routing. Applied on every change of work rather than only
     the first: picking the work is the later act, so it wins, and picking a
     different one moves the destination again. Changing the destination
     afterwards still overrides it for this one case.

     NO RULE FALLS BACK TO THE SYSTEM THAT RAISED IT — what Case Routing
     promises in those words at the foot of every block, and what
     nelos_route_case() does with a case that names no queue. Left alone
     instead, the row would come back on screen carrying whatever the LAST
     work put there, which is nobody's answer reading as if it were one.
     Nelos itself is the exception, as in the dashboard's routedTo(): the
     case log is not a queue anybody works, so the row asks.

     NO ROUTES TO READ leaves both as they are — the fail-open every other
     gate here follows. SHARED RULE: onWork() in the office dock
     (mjm-ai-system shared/shared_nelos_dock.js). Change one, change the
     other. */
  function pickWork(name) {
    setWork(name);
    if (!name) return;

    /* THE TITLE NAMES THE QUEUE, so the page this was opened on decides
       nothing. Asked in the same order nelos_route_case() asks it: the
       title, then the section default, then the system it was raised in. */
    const row = worksFor.find((c) => c.name === name) || null;
    let dest = row?.module_key || null;
    if (!dest) dest = defaultRouteFor()?.to_module || null;

    if (!dest) {
      // FAILS OPEN: nothing readable at all is a database that could not
      // answer, not an answer of nobody, so both boxes are left alone.
      if (cats.length || routes.length) {
        const home = sourceModule === 'nelos' ? '' : sourceModule;
        if (home !== assignTo) { setAssignTo(home); setPic(''); }
      }
      return;
    }

    const movedTo = dest !== assignTo;
    if (movedTo) setAssignTo(dest);

    /* The PIC the office named, resolved from the seat where it is one.
       Applied where the destination just MOVED — which takes the old PIC
       with it, a person pinned to the system this was going to not being in
       the one it is going to now — or where nobody has been chosen yet. A
       choice somebody made against a destination that has not moved is
       theirs and stands.

       CHECKED AGAINST THE PEOPLE, not against the dropdown: setAssignTo has
       not taken effect yet at this point, so the list on screen is still
       the old system's. A PIC the office named who is not pinned to the
       destination names nobody, and the whole queue takes the case. */
    const named = row && row.pic_user_id && people.some(
      (p) => String(p.user_id) === String(row.pic_user_id) && p.primary_module === dest)
      ? String(row.pic_user_id) : '';
    const want = named || seatHolder(dest, row?.pic_seat_no);
    if (want && (movedTo || !pic)) setPic(want);
    else if (movedTo) setPic('');
  }

  /* THE SEAT THE OFFICE SET FOR THE CHOSEN WORK, and only while the
     destination is still the one the title names. Overriding Assign to
     sends this one case to another system, where that number is a
     different person or nobody at all, so the seat does not travel with
     it and the whole of the new queue takes the case. SHARED RULE:
     seatOfWork() in the office dock. */
  function seatFromWork() {
    const row = worksFor.find((c) => c.name === work) || null;
    if (!row || row.pic_seat_no == null) return null;
    if (assignTo !== row.module_key) return null;
    return Number(row.pic_seat_no);
  }

  /* WHO SOLVES IT IS SHOWN ONCE THERE IS SOMETHING TO SHOW — a work has
     been chosen and the rule has had its say, or there is no work list to
     derive anything from and the person has to say where it goes. Hidden in
     that second case the form could not be filled in at all. SHARED RULE:
     showDest() in the office dock. */
  const showDest = !!work || !worksFor.length;

  /* `mine` is gone with the destination fallback: the Work list no longer
     has two possible sources, so there is nothing to tell apart. A
     variable nothing reads is the half-removal the office repository has a
     rule about. */

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
    /* THE WORK IS ASKED FIRST, because the destination is hidden until it
       has been answered. The other order refused with "Choose who this is
       for" over a box that is not on the form — a refusal pointing at
       nothing. SHARED RULE: submitCase() in the office dock. */
    if (!title) {
      setErr(worksFor.length ? 'Choose the work.' : 'Say what the case is.');
      if (!worksFor.length) titleRef.current?.focus();
      return;
    }
    if (!assignTo) return setErr('Choose who this is for.');

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
      /* THE SEAT, so the office setting actually reaches the case. The
         trigger cannot supply it: it returns early on a case that already
         names its queue — routing is the default, not a rule — and this
         form always names one, so a PIC set as "Admin 2" on Case Routing
         had never once landed on a case raised from a form. NULL there
         means the whole queue, which is what no PIC means and stays the
         default, so it is only sent when there is one — a database without
         the column still takes the insert. SHARED RULE: submitCase() in
         the office dock. */
      const seatNo = seatFromWork();
      if (seatNo != null) row.assigned_seat_no = seatNo;

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
          <button className="nc-x" onClick={() => onClose(false)} aria-label="Close"><Icon name="close" className="w-4 h-4" /></button>
        </div>

        {err && <div className="nc-flash nc-flash-bad">{err}</div>}

        {/* WORK FIRST, because the destination follows from it. Asked the
            other way round — as it was — the form moved an answer the
            person had just given. */}
        <label className="nc-label" htmlFor="nnc-work">Work</label>
        {worksFor.length ? (
          <CfSelect id="nnc-work" value={work} onChange={(e) => pickWork(e.target.value)}>
            <option value="">— choose the work —</option>
            {worksFor.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </CfSelect>
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

        {showDest && (
          <>
            <label className="nc-label" htmlFor="nnc-to">Assign to</label>
            <CfSelect id="nnc-to" value={assignTo} onChange={(e) => pickAssignTo(e.target.value)}>
              <option value="">— choose a system —</option>
              {modules.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </CfSelect>

            <label className="nc-label" htmlFor="nnc-pic">PIC</label>
            <CfSelect
              id="nnc-pic"
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
            </CfSelect>
          </>
        )}

        <div className="nc-two">
          <div>
            <label className="nc-label" htmlFor="nnc-nursery">Nursery</label>
            <CfSelect
              id="nnc-nursery"
              value={nursery}
              onChange={(e) => { setNursery(e.target.value); setPlot(''); }}
            >
              <option value="">— none —</option>
              {Object.keys(NURSERY_PLOTS).map((n) => (
                <option key={n} value={n}>{NURSERY_LABEL[n]}</option>
              ))}
            </CfSelect>
          </div>
          <div>
            <label className="nc-label" htmlFor="nnc-plot">Plot</label>
            <CfSelect
              id="nnc-plot"
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              disabled={!nursery}
            >
              <option value="">{nursery ? '— none —' : 'Nursery first'}</option>
              {(NURSERY_PLOTS[nursery] || []).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </CfSelect>
          </div>
        </div>

        <label className="nc-label">Photo</label>
        {photo ? (
          <div className="nc-photo">
            <img src={photo.url} alt="" />
            <button type="button" className="nc-photo-x" onClick={dropPhoto} aria-label="Remove photo"><Icon name="close" className="w-4 h-4" /></button>
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
            <span className="inline-flex items-center gap-1.5"><Icon name="camera" className="w-4 h-4" /> Take or upload a photo</span>
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

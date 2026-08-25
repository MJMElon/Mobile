/* ══════════════════════════════════════════════════════════════════════
   NELOS — RAISING A CASE FROM THE ADMIN PORTAL

   The other half of settling cases here: noticing one. Somebody is in the
   middle of a delivery note, sees something wrong, and can say so without
   losing the page — which is the whole reason the hub's dock grew this
   form too.

   The insert mirrors MJMNelos.raise() and the dock's submitCase(): same
   columns, same defaults, and the opening detail also posted into the
   thread so the case reads as one conversation from its first line. A
   case raised here has to be indistinguishable from one raised anywhere
   else.

   Where it LANDS is not decided here. The nelos_cases_route trigger reads
   the category and routes the case to a module and a seat; this only says
   which module it was raised in (source_module = 'mobile').
   ══════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'normal', label: 'Normal' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

export default function NelosNewCase({ module: sourceModule, me, onClose }) {
  const [cats, setCats] = useState([]);
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('normal');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const titleRef = useRef(null);
  const descRef = useRef(null);

  /* Categories are rows, not a constant — the Nelos User Setting page owns
     them, and each carries the priority and the number of days a case of
     that kind normally gets. A database without the table simply offers no
     category, which the insert accepts. */
  useEffect(() => {
    let alive = true;
    supabase
      .from('nelos_categories')
      .select('name,default_priority,default_days')
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (!alive || error) return;
        setCats(data || []);
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

  /* Picking a category fills in what that kind of case usually gets, and
     stops short of overwriting a date already typed. */
  function pickCategory(name) {
    setCategory(name);
    const c = cats.find((x) => x.name === name);
    if (!c) return;
    if (c.default_priority) setPriority(c.default_priority);
    if (c.default_days != null && !due) {
      const d = new Date();
      d.setDate(d.getDate() + Number(c.default_days));
      setDue(d.toISOString().slice(0, 10));
    }
  }

  async function submit() {
    const title = titleRef.current?.value.trim();
    if (!title) {
      setErr('A case needs a title.');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr(null);
    const description = descRef.current?.value.trim() || null;
    try {
      const { data, error } = await supabase
        .from('nelos_cases')
        .insert([
          {
            title: title.slice(0, 300),
            description,
            category: category || null,
            priority,
            status: 'open',
            source_module: sourceModule,
            due_date: due || null,
            raised_by: me.name,
            raised_by_id: me.id,
          },
        ])
        .select()
        .single();
      if (error) {
        setErr(`Could not raise it — ${error.message}`);
        setBusy(false);
        return;
      }
      // Best effort: the case exists either way.
      if (data && description) {
        try {
          await supabase.from('nelos_case_comments').insert([
            { case_id: data.id, body: description, kind: 'comment', author_name: me.name, author_id: me.id },
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
      <div className="nc-sheet" role="dialog" aria-label="Raise a Nelos case">
        <div className="nc-head">
          <span className="nc-new-title">Raise a Case</span>
          <button className="nc-x" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>

        {err && <div className="nc-flash nc-flash-bad">{err}</div>}

        <label className="nc-label" htmlFor="nnc-title">What is wrong?</label>
        <input
          id="nnc-title"
          ref={titleRef}
          className="nc-input"
          placeholder="One line — the thing that needs doing"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <label className="nc-label" htmlFor="nnc-desc">Detail</label>
        <textarea id="nnc-desc" ref={descRef} className="nc-input" rows={3} placeholder="Optional — what you saw" />

        {!!cats.length && (
          <>
            <label className="nc-label" htmlFor="nnc-cat">Category</label>
            <select
              id="nnc-cat"
              className="nc-input"
              value={category}
              onChange={(e) => pickCategory(e.target.value)}
            >
              <option value="">— none —</option>
              {cats.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </>
        )}

        <label className="nc-label">Priority</label>
        <div className="nc-pri">
          {PRIORITIES.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`nc-pri-btn nc-pi-${p.key}${priority === p.key ? ' on' : ''}`}
              onClick={() => setPriority(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="nc-label" htmlFor="nnc-due">Due</label>
        <input id="nnc-due" type="date" className="nc-input" value={due} onChange={(e) => setDue(e.target.value)} />

        <button className="nc-act nc-act-start nc-act-wide" disabled={busy} onClick={submit}>
          {busy ? 'Raising…' : 'Raise Case'}
        </button>
      </div>
    </div>
  );
}

/* Seal ranges keyed with the Bluetooth gun — shared by Seal Management
   (seals arriving at UNN 1) and Customer Consent (seals going out to a
   customer).

   The gun is a keyboard: it types the digits and presses Enter. So Enter in
   Start moves to End, and Enter in End closes that range and opens a new
   Start — a whole box of seals is scan, scan, scan, scan with no tapping.
   An End left empty is a single seal.

   The online check (seal_check_range) answers per range and FAILS OPEN: no
   line, or an RPC that errors, and the range is simply not checked. The
   database triggers check everything again when the row lands and raise a
   NELOS case for anything wrong, so a phone with no signal never has to
   stop work for a check it cannot run. */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isOnline } from '../lib/auth';
import { rangeQty, sealDigits, sealNo } from '../lib/sealRanges.js';

let _rowSeq = 0;
export const newSealRow = () => ({ id: 'sr' + (++_rowSeq), start: '', end: '' });

/** A row as it will be saved: { start, end } in digits, or null when blank.
    `bad` says why a non-blank row cannot be saved. */
export function readSealRow(r) {
  const s = sealDigits(r.start);
  const e = sealDigits(r.end);
  const blank = !String(r.start || '').trim() && !String(r.end || '').trim();
  if (blank) return { blank: true };
  if (!s) return { bad: 'Start seal missing' };
  if (String(r.end || '').trim() && !e) return { bad: 'End seal is not a number' };
  const end = e || s;
  if (sealNo(end) < sealNo(s)) return { bad: 'End is before Start' };
  return { start: s, end, qty: rangeQty(s, end), key: s + '|' + end };
}

/** Every complete range in the form, in the shape the database takes. */
export function sealRangesOf(rows) {
  return rows.map(readSealRow).filter((x) => x.key).map(({ start, end }) => ({ start, end }));
}

/** Indexes of rows that overlap another row in the same form. */
export function overlappingRows(rows) {
  const read = rows.map(readSealRow);
  const out = new Set();
  for (let i = 0; i < read.length; i++) {
    if (!read[i].key) continue;
    for (let j = i + 1; j < read.length; j++) {
      if (!read[j].key) continue;
      const a1 = sealNo(read[i].start), a2 = sealNo(read[i].end);
      const b1 = sealNo(read[j].start), b2 = sealNo(read[j].end);
      if (a1 <= b2 && b1 <= a2) { out.add(i); out.add(j); }
    }
  }
  return out;
}

/** Per-range answers from seal_check_range, keyed by "start|end":
    { state: 'checking' | 'done' | 'skipped', rows: [...] }.
    'skipped' is the fail-open answer — offline or the RPC refused. */
export function useSealChecks(rows, kind) {
  const [checks, setChecks] = useState({});
  const asked = useRef(new Set());
  const keys = rows.map(readSealRow).filter((x) => x.key);
  const sig = keys.map((k) => k.key).join(',');

  useEffect(() => {
    const t = setTimeout(() => {
      keys.forEach(({ start, end, key }) => {
        if (asked.current.has(key)) return;
        asked.current.add(key);
        if (!isOnline()) {
          setChecks((p) => ({ ...p, [key]: { state: 'skipped', rows: [] } }));
          return;
        }
        setChecks((p) => ({ ...p, [key]: { state: 'checking', rows: [] } }));
        supabase
          .rpc('seal_check_range', { p_start: start, p_end: end, p_kind: kind })
          .then(({ data, error }) => {
            if (error) {
              // Fail open, and let the next edit of this range ask again.
              asked.current.delete(key);
              setChecks((p) => ({ ...p, [key]: { state: 'skipped', rows: [] } }));
              return;
            }
            setChecks((p) => ({ ...p, [key]: { state: 'done', rows: data || [] } }));
          })
          .catch(() => {
            asked.current.delete(key);
            setChecks((p) => ({ ...p, [key]: { state: 'skipped', rows: [] } }));
          });
      });
    }, 350);
    return () => clearTimeout(t);
  }, [sig, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Forget everything — a fresh form asks again. */
  const reset = () => { asked.current = new Set(); setChecks({}); };
  return { checks, reset };
}

/** The entry rows themselves. `notes(row, index)` returns extra JSX under a
    row (the check result), so each page words its own answer. */
export default function SealRangeInput({ rows, onChange, notes, disabled, hint = true }) {
  const startRefs = useRef({});
  const endRefs = useRef({});
  const [focusId, setFocusId] = useState(null);

  useEffect(() => {
    if (!focusId) return;
    const el = startRefs.current[focusId];
    if (el) el.focus();
    setFocusId(null);
  }, [focusId, rows]);

  const overlaps = overlappingRows(rows);
  const read = rows.map(readSealRow);
  const total = read.reduce((s, r) => s + (r.qty || 0), 0);

  function setField(id, field, value) {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id) {
    const next = rows.filter((r) => r.id !== id);
    onChange(next.length ? next : [newSealRow()]);
  }

  function onStartKey(e, r) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const el = endRefs.current[r.id];
    if (el) el.focus();
  }

  function onEndKey(e, r, i) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!sealDigits(r.start)) {
      const el = startRefs.current[r.id];
      if (el) el.focus();
      return;
    }
    // The next row's Start — a new one when this is the last row.
    if (i === rows.length - 1) {
      const nr = newSealRow();
      onChange([...rows, nr]);
      setFocusId(nr.id);
    } else {
      setFocusId(rows[i + 1].id);
    }
  }

  function addRow() {
    const nr = newSealRow();
    onChange([...rows, nr]);
    setFocusId(nr.id);
  }

  const inputCls = 'search-input font-mono text-sm';
  return (
    <div>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const rd = read[i];
          return (
            <div key={r.id} className={`rounded-xl border p-2.5 ${rd.bad || overlaps.has(i) ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 w-5 shrink-0 text-center">{i + 1}</span>
                <input
                  ref={(el) => { startRefs.current[r.id] = el; }}
                  className={inputCls}
                  style={{ padding: '9px 12px', minWidth: 0 }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Start seal"
                  value={r.start}
                  disabled={disabled}
                  onChange={(e) => setField(r.id, 'start', e.target.value)}
                  onKeyDown={(e) => onStartKey(e, r)}
                />
                <span className="text-slate-300 font-black shrink-0">–</span>
                <input
                  ref={(el) => { endRefs.current[r.id] = el; }}
                  className={inputCls}
                  style={{ padding: '9px 12px', minWidth: 0 }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="End (blank = 1)"
                  value={r.end}
                  disabled={disabled}
                  onChange={(e) => setField(r.id, 'end', e.target.value)}
                  onKeyDown={(e) => onEndKey(e, r, i)}
                />
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  disabled={disabled}
                  title="Remove this range"
                  className="w-8 h-8 shrink-0 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-red-500 hover:border-red-300 font-black cursor-pointer"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5 pl-7">
                <span className="text-[10px] font-bold text-slate-400">
                  {rd.qty ? <>Qty <span className="font-black text-slate-700">{rd.qty.toLocaleString()}</span></> : rd.blank && hint ? 'Scan the first seal, then the last' : ''}
                </span>
                {rd.bad && <span className="text-[10px] font-black text-red-600">{rd.bad}</span>}
                {!rd.bad && overlaps.has(i) && <span className="text-[10px] font-black text-red-600">Overlaps another range above</span>}
              </div>
              {rd.key && notes ? notes(rd, i) : null}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3">
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="text-[10px] font-black text-emerald-700 uppercase tracking-widest bg-emerald-50 px-4 py-2 rounded-full border border-emerald-200 cursor-pointer"
        >
          + Add range
        </button>
        <span className="text-[11px] font-black text-slate-600">
          Total: <span className="text-emerald-700">{total.toLocaleString()}</span> seal{total === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

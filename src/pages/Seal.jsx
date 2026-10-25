import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/gemini';
import { SEAL_RECEIPT_JOB, looksOffline, queueJob, sendSealReceipt } from '../lib/mobileQueue.js';
import { isOnline } from '../lib/auth';
import { formatSealRanges, rangeQty, sealCode, sealNo } from '../lib/sealRanges.js';
import AuthGate from '../components/AuthGate';
import TopNav from '../components/TopNav';
import CfSelect from '../components/CfSelect.jsx';
import SealRangeInput, { newSealRow, overlappingRows, readSealRow, sealRangesOf, useSealChecks } from '../components/SealRangeInput.jsx';
import { useToast } from '../components/Toast';
import Icon from '../components/Icon.jsx';

export default function SealPage() {
  return <AuthGate page="seal">{({ session, userName }) => <Seal session={session} userName={userName} />}</AuthGate>;
}

/* What happens to a seal, in order: received at UNN 1 (in stock), put on a
   signed consent (pending collection), scanned at the lorry in the FC Portal
   (scanned), and on a DO (collected). Colours are the same four everywhere
   seals are shown. */
const STATUS = {
  in_stock: { label: 'In stock', badge: 'bg-slate-100 text-slate-700 border-slate-300', chip: 'border-slate-300', on: 'bg-slate-700 text-white border-slate-700' },
  pending: { label: 'Pending collection', badge: 'bg-amber-50 text-amber-700 border-amber-300', chip: 'border-amber-300', on: 'bg-amber-500 text-white border-amber-500' },
  scanned: { label: 'Scanned', badge: 'bg-blue-50 text-blue-700 border-blue-300', chip: 'border-blue-300', on: 'bg-blue-600 text-white border-blue-600' },
  collected: { label: 'Collected', badge: 'bg-emerald-50 text-emerald-700 border-emerald-300', chip: 'border-emerald-300', on: 'bg-emerald-600 text-white border-emerald-600' },
};
const STATUS_ORDER = ['in_stock', 'pending', 'scanned', 'collected'];

// Browser storage is a convenience here, never the record: the list and the
// receipts are what the server said last time, shown when there is no line.
const LIST_CACHE = 'mjm_seal_list_v1';
const RECEIPT_CACHE = 'mjm_seal_receipts_v1';
const ORDER_CACHE = 'mjm_seal_orders_v1';
const DELIVERY_CACHE = 'mjm_seal_deliveries_v1';

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full or blocked — the list still shows */ }
}

/* Today in the phone's own day. toISOString() is UTC, which is yesterday in
   Malaysia for the first eight hours of every morning. */
function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(String(v).length === 10 ? v + 'T00:00:00' : v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtWhen = (at) => {
  try { return new Date(at).toLocaleString('en-MY', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(at); }
};
const rangeText = (a, b) => (a === b ? a : a + ' – ' + b);

/* The seals in A that are not in B, as ranges. What a delivery from HQ sent
   that site did not key, and the other way round. Running numbers join, so
   two rolls that meet read as one. */
function normRanges(list) {
  const out = [];
  (list || []).forEach((g) => {
    const a = sealNo(g.start), b = sealNo(g.end || g.start);
    if (a == null || b == null) return;
    const w = Math.max(String(g.start || '').replace(/\D+/g, '').length, String(g.end || g.start || '').replace(/\D+/g, '').length);
    out.push({ s: Math.min(a, b), e: Math.max(a, b), w });
  });
  out.sort((x, y) => x.s - y.s);
  const m = [];
  out.forEach((r) => {
    const last = m[m.length - 1];
    if (last && r.s <= last.e + 1) { last.e = Math.max(last.e, r.e); last.w = Math.max(last.w, r.w); } else m.push({ ...r });
  });
  return m;
}
function minusRanges(a, b) {
  const bb = normRanges(b);
  const out = [];
  normRanges(a).forEach((r) => {
    let cur = r.s;
    bb.forEach((x) => {
      if (x.e < cur || x.s > r.e) return;
      if (x.s > cur) out.push({ start: sealCode(cur, r.w), end: sealCode(x.s - 1, r.w) });
      cur = Math.max(cur, x.e + 1);
    });
    if (cur <= r.e) out.push({ start: sealCode(cur, r.w), end: sealCode(r.e, r.w) });
  });
  return out;
}
const qtyOf = (list) => (list || []).reduce((t, r) => t + rangeQty(r.start, r.end), 0);

/* An offline search has only the saved list to look in, so it asks the
   same question seal_list asks — all digits is a seal number, anything else
   is customer, AL or DO — of the rows already on the phone. */
function matchesOffline(row, q) {
  const s = String(q || '').trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) {
    const n = sealNo(s);
    return n >= Number(row.start_no) && n <= Number(row.end_no);
  }
  const l = s.toLowerCase();
  return [row.customer_name, row.al_number, row.do_number].some((v) => String(v || '').toLowerCase().includes(l));
}

function Seal({ session, userName }) {
  const { ToastHost, showToast } = useToast();
  const [tab, setTab] = useState('seals'); // seals | receipts

  // ── Seal list ──
  const [rows, setRows] = useState(null); // null = loading
  const [listErr, setListErr] = useState('');
  const [cachedAt, setCachedAt] = useState(null); // set when showing the saved copy
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const searchTimer = useRef(null);
  const searchToken = useRef(0);

  // ── Receipts ──
  const [receipts, setReceipts] = useState(null);
  const [receiptsCachedAt, setReceiptsCachedAt] = useState(null);
  const [orders, setOrders] = useState([]);
  const [deliveries, setDeliveries] = useState([]); // from HQ, not yet received
  const [viewer, setViewer] = useState(null); // full-size photo url

  const loadList = useCallback(async (q) => {
    const token = ++searchToken.current;
    const fallback = () => {
      const c = readCache(LIST_CACHE);
      if (c && Array.isArray(c.rows)) {
        setRows(c.rows.filter((r) => matchesOffline(r, q)));
        setCachedAt(c.at);
        setListErr('');
      } else {
        setRows([]);
        setCachedAt(null);
        setListErr('No line, and no saved list on this phone yet.');
      }
    };
    if (!isOnline()) { fallback(); return; }
    try {
      const { data, error } = await supabase.rpc('seal_list', { p_search: q || null, p_status: null });
      if (token !== searchToken.current) return; // a newer search is in flight
      if (error) {
        if (looksOffline(error)) { fallback(); return; }
        setListErr(error.message);
        setRows([]);
        return;
      }
      setRows(data || []);
      setCachedAt(null);
      setListErr('');
      // The unsearched list is the one worth keeping: an offline search
      // filters it on the phone.
      if (!q) writeCache(LIST_CACHE, { at: Date.now(), rows: data || [] });
    } catch (e) {
      if (token !== searchToken.current) return;
      fallback();
    }
  }, []);

  const loadReceipts = useCallback(async () => {
    const fallback = () => {
      const c = readCache(RECEIPT_CACHE);
      setReceipts(c && Array.isArray(c.rows) ? c.rows : []);
      setReceiptsCachedAt(c ? c.at : null);
    };
    if (!isOnline()) { fallback(); return; }
    try {
      const { data, error } = await supabase
        .from('seal_receipts')
        .select('*')
        .order('received_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) { fallback(); return; }
      setReceipts(data || []);
      setReceiptsCachedAt(null);
      // Photos can be base64 when an upload failed — those are left out of
      // the saved copy so one receipt cannot fill the phone's storage.
      writeCache(RECEIPT_CACHE, {
        at: Date.now(),
        rows: (data || []).map((r) => ({ ...r, photo_urls: (r.photo_urls || []).filter((u) => !String(u).startsWith('data:')) })),
      });
    } catch (e) {
      fallback();
    }
  }, []);

  const loadOrders = useCallback(async () => {
    const cached = readCache(ORDER_CACHE);
    if (cached && Array.isArray(cached.rows)) setOrders(cached.rows);
    if (!isOnline()) return;
    try {
      const { data, error } = await supabase
        .from('seal_orders')
        .select('id, order_no, supplier, qty, status, order_date')
        .neq('status', 'Closed')
        .order('order_date', { ascending: false });
      if (error) return;
      setOrders(data || []);
      writeCache(ORDER_CACHE, { at: Date.now(), rows: data || [] });
    } catch (e) { /* the dropdown is optional */ }
  }, []);

  /* Deliveries HQ has sent and site has not confirmed. Kept on the phone so
     a delivery can be confirmed with no line; the database closes it when
     the receipt arrives. */
  const loadDeliveries = useCallback(async () => {
    const cached = readCache(DELIVERY_CACHE);
    if (cached && Array.isArray(cached.rows)) setDeliveries(cached.rows);
    if (!isOnline()) return;
    try {
      const { data, error } = await supabase
        .from('seal_deliveries')
        .select('id, site, ranges, status, packed_by, packed_at, delivered_by, delivered_at, remark')
        .neq('status', 'received')
        .order('id', { ascending: false });
      if (error) return; // not set up yet: Receive works as it always did
      setDeliveries(data || []);
      writeCache(DELIVERY_CACHE, { at: Date.now(), rows: data || [] });
    } catch (e) { /* the picker is optional */ }
  }, []);

  useEffect(() => {
    loadReceipts();
    loadOrders();
    loadDeliveries();
  }, [loadReceipts, loadOrders, loadDeliveries]);

  // The search, debounced — the gun types a whole seal number in a blink,
  // a person types one digit at a time.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadList(search.trim()), search.trim() ? 300 : 0);
    return () => clearTimeout(searchTimer.current);
  }, [search, loadList]);

  const summary = useMemo(() => {
    const s = {};
    STATUS_ORDER.forEach((k) => { s[k] = { count: 0, qty: 0 }; });
    (rows || []).forEach((r) => {
      const k = s[r.seg_status];
      if (!k) return;
      k.count++;
      k.qty += Number(r.qty) || 0;
    });
    return s;
  }, [rows]);

  const shown = useMemo(
    () => (rows || []).filter((r) => !statusFilter || r.seg_status === statusFilter),
    [rows, statusFilter],
  );

  // ── Receive modal ──
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvRows, setRecvRows] = useState(() => [newSealRow()]);
  const [orderId, setOrderId] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [recvDate, setRecvDate] = useState(localISO());
  const [remark, setRemark] = useState('');
  const [isOpening, setIsOpening] = useState(false);
  const [photos, setPhotos] = useState([]); // compressed data URLs
  const [saving, setSaving] = useState(false);
  const photoInput = useRef(null);
  const { checks, reset: resetChecks } = useSealChecks(recvRows, 'receive');

  function openReceive() {
    setRecvRows([newSealRow()]);
    setOrderId('');
    setDeliveryId('');
    setRecvDate(localISO());
    setRemark('');
    setIsOpening(false);
    setPhotos([]);
    setSaving(false);
    resetChecks();
    setRecvOpen(true);
  }

  async function onPhotos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of files) {
      const raw = await new Promise((res) => {
        const rd = new FileReader();
        rd.onload = (ev) => res(ev.target.result);
        rd.onerror = () => res(null);
        rd.readAsDataURL(f);
      });
      if (!raw) continue;
      const small = await compressImage(raw);
      setPhotos((p) => [...p, small]);
    }
  }

  // A range somebody already received blocks; the server says so per part.
  const receivedHits = (rd) => {
    const c = checks[rd.key];
    return c && c.state === 'done' ? (c.rows || []).filter((x) => x.problem === 'received') : [];
  };

  const recvRead = recvRows.map(readSealRow);
  const recvRanges = sealRangesOf(recvRows);
  const recvTotal = recvRanges.reduce((s, r) => s + rangeQty(r.start, r.end), 0);
  const recvOverlaps = overlappingRows(recvRows);
  const recvBlocked = recvRead.some((rd) => rd.key && receivedHits(rd).length);
  const recvProblems = [];
  if (!recvRanges.length) recvProblems.push('Scan at least one seal range');
  if (recvRead.some((rd) => rd.bad)) recvProblems.push('Fix the incomplete range');
  if (recvOverlaps.size) recvProblems.push('Two ranges overlap');
  if (recvBlocked) recvProblems.push('Remove the seals already received');
  if (!photos.length) recvProblems.push('Take at least one photo');
  if (!recvDate) recvProblems.push('Pick the received date');

  /* Site keys the delivery itself, then sees whether it matches what HQ
     sent. A difference never stops the save -- what site counted is what is
     kept, and the database opens a NELOS case to HQ. */
  const delivery = deliveryId ? deliveries.find((d) => String(d.id) === deliveryId) : null;
  const sentQty = delivery ? qtyOf(delivery.ranges) : 0;
  const notKeyed = delivery && recvRanges.length ? minusRanges(delivery.ranges, recvRanges) : [];
  const notSent = delivery && recvRanges.length ? minusRanges(recvRanges, delivery.ranges) : [];
  const deliveryDiffers = !!delivery && recvRanges.length > 0 && (notKeyed.length > 0 || notSent.length > 0);

  async function saveReceipt() {
    if (recvProblems.length || saving) return;
    setSaving(true);
    const clientRef = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    const job = {
      payload: {
        client_ref: clientRef,
        order_id: orderId ? Number(orderId) : null,
        site: 'UNN 1',
        received_date: recvDate,
        ranges: recvRanges,
        photo_urls: [],
        is_opening: delivery ? false : isOpening,
        remark: remark.trim() || null,
        received_by: userName || null,
        received_by_id: session?.user?.id || null,
      },
      photoBase64s: photos,
    };
    // Only when one is picked: a database without the delivery SQL has no
    // such column, and Receive must go on working there.
    if (delivery) job.payload.delivery_id = delivery.id;
    if (deliveryDiffers && !window.confirm('What you keyed does not match what HQ sent. Save it as you counted it? HQ will get a NELOS case.')) {
      setSaving(false);
      return;
    }

    let offline = false;
    try {
      await sendSealReceipt(job);
    } catch (e) {
      if (!looksOffline(e)) {
        showToast('❌ Error: ' + e.message);
        setSaving(false);
        return;
      }
      await queueJob(SEAL_RECEIPT_JOB, job);
      offline = true;
    }
    setSaving(false);
    setRecvOpen(false);
    showToast(offline ? '📴 Saved offline — will sync' : 'Saved — ' + recvTotal.toLocaleString() + ' seals received');
    if (delivery) {
      // Off the picker now, online or not -- it is confirmed.
      const left = deliveries.filter((d) => d.id !== delivery.id);
      setDeliveries(left);
      writeCache(DELIVERY_CACHE, { at: Date.now(), rows: left });
    }
    if (!offline) {
      loadReceipts();
      loadList(search.trim());
      loadDeliveries();
    }
  }

  const deliveryLabel = (d) => ['Delivery #' + d.id, qtyOf(d.ranges).toLocaleString() + ' seals',
    d.status === 'delivered' ? 'Delivered ' + fmtDate(d.delivered_at) : 'Packed ' + fmtDate(d.packed_at)].join(' · ');
  const orderLabel = (o) => [o.order_no || '#' + o.id, o.supplier, o.qty != null ? Number(o.qty).toLocaleString() : null].filter(Boolean).join(' · ');
  const orderById = useMemo(() => Object.fromEntries(orders.map((o) => [String(o.id), o])), [orders]);

  return (
    <>
      <TopNav title="Seal Management" userName={userName} />

      <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-6 space-y-5" style={{ background: '#f1f5f9', minHeight: 'calc(100vh - 65px)' }}>
        <button
          onClick={openReceive}
          className="w-full flex items-center justify-center gap-3 py-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm uppercase tracking-widest border-none cursor-pointer shadow-lg transition-colors"
        >
          <Icon name="box" className="w-6 h-6" /> Receive Seals
        </button>
        {deliveries.length > 0 && (
          <div className="text-[11px] font-black text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 -mt-2">
            {deliveries.length} deliver{deliveries.length === 1 ? 'y' : 'ies'} from HQ waiting to be received — press Receive Seals and pick it.
          </div>
        )}

        <div className="tab-row">
          <button className={`tab-btn ${tab === 'seals' ? 'active' : ''}`} onClick={() => setTab('seals')}><Icon name="tag" className="w-3.5 h-3.5 inline-block align-[-2px]" /> Seals</button>
          <button className={`tab-btn ${tab === 'receipts' ? 'active' : ''}`} onClick={() => setTab('receipts')}><Icon name="download" className="w-3.5 h-3.5 inline-block align-[-2px]" /> Receipts</button>
        </div>

        {tab === 'seals' ? (
          <div className="dash-card p-4 sm:p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {STATUS_ORDER.map((k) => {
                const m = STATUS[k];
                const on = statusFilter === k;
                return (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(on ? null : k)}
                    className={`text-left rounded-xl border-2 px-3 py-2 cursor-pointer transition-colors ${on ? m.on : 'bg-white ' + m.chip}`}
                  >
                    <div className={`text-[9px] font-black uppercase tracking-widest ${on ? 'text-white/80' : 'text-slate-400'}`}>{m.label}</div>
                    <div className="text-base font-black leading-tight">{summary[k].qty.toLocaleString()}</div>
                    <div className={`text-[10px] font-bold ${on ? 'text-white/80' : 'text-slate-400'}`}>{summary[k].count} range{summary[k].count === 1 ? '' : 's'}</div>
                  </button>
                );
              })}
            </div>

            <input
              type="text"
              className="search-input mb-3"
              placeholder="Seal number, customer, AL or DO…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {cachedAt && (
              <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                <Icon name="offline" className="w-3.5 h-3.5 inline-block align-[-3px]" /> No line — showing saved list from {fmtWhen(cachedAt)}
              </div>
            )}
            {listErr && <div className="text-xs font-bold text-red-500 mb-3">{listErr}</div>}

            {rows === null ? (
              <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">Loading…</div>
            ) : !shown.length ? (
              <div className="text-center py-10">
                <Icon name="tag" className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">
                  {search.trim() ? 'No seals match ' + search.trim() : 'No seals yet'}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {shown.map((r, i) => {
                  const m = STATUS[r.seg_status] || STATUS.in_stock;
                  const probs = Number(r.open_problems) || 0;
                  return (
                    <div key={(r.allocation_id || r.receipt_id || '') + '-' + r.start_no + '-' + i} className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono font-black text-slate-800 text-sm break-all">{rangeText(r.start_code, r.end_code)}</div>
                          <div className="text-[11px] font-bold text-slate-400 mt-0.5">Qty <span className="font-black text-slate-700">{Number(r.qty || 0).toLocaleString()}</span></div>
                        </div>
                        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full border ${m.badge}`}>{m.label}</span>
                      </div>
                      {(r.customer_name || r.al_number) && (
                        <div className="text-xs font-bold text-slate-600 mt-2">
                          {r.customer_name || '—'} {r.al_number && <span className="text-slate-400">· {r.al_number}</span>}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] font-bold text-slate-400">
                        {r.seg_status === 'in_stock'
                          ? r.consent_at && <span>Received {fmtDate(r.consent_at)}</span>
                          : r.consent_at && <span>Consent {fmtDate(r.consent_at)}</span>}
                        {r.do_number && <span>DO <span className="text-slate-600">{r.do_number}</span></span>}
                        {probs > 0 && (
                          <span className="text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 font-black inline-flex items-center gap-1"><Icon name="warning" className="w-3 h-3" /> {probs} problem{probs === 1 ? '' : 's'}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="dash-card p-4 sm:p-6">
            {receiptsCachedAt && (
              <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                <Icon name="offline" className="w-3.5 h-3.5 inline-block align-[-3px]" /> No line — showing saved receipts from {fmtWhen(receiptsCachedAt)}
              </div>
            )}
            {receipts === null ? (
              <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">Loading…</div>
            ) : !receipts.length ? (
              <div className="text-center py-10">
                <Icon name="download" className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">No receipts yet</div>
              </div>
            ) : (
              <div className="space-y-2">
                {receipts.map((rc) => {
                  const rg = Array.isArray(rc.ranges) ? rc.ranges : [];
                  const qty = rg.reduce((s, x) => s + rangeQty(x.start, x.end), 0);
                  const order = rc.order_id != null ? orderById[String(rc.order_id)] : null;
                  return (
                    <div key={rc.id || rc.client_ref} className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-slate-800">{fmtDate(rc.received_date)}</div>
                          <div className="text-[10px] font-bold text-slate-400">by {rc.received_by || '—'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-black text-emerald-700">{qty.toLocaleString()} seals</div>
                          {rc.is_opening && <div className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Opening stock</div>}
                        </div>
                      </div>
                      <div className="font-mono text-[11px] font-bold text-slate-600 mt-2 break-words">{formatSealRanges(rg) || '—'}</div>
                      {rc.delivery_id && <div className="text-[10px] font-bold text-slate-400 mt-1">Delivery #{rc.delivery_id} from HQ</div>}
                      {order && <div className="text-[10px] font-bold text-slate-400 mt-1">Order: {orderLabel(order)}</div>}
                      {rc.remark && <div className="text-[11px] font-bold text-slate-500 mt-1">{rc.remark}</div>}
                      {(rc.photo_urls || []).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {rc.photo_urls.map((u, i) => (
                            <button key={i} onClick={() => setViewer(u)} className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer p-0">
                              <img src={u} className="w-full h-full object-cover" loading="lazy" alt="Receipt" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ RECEIVE SEALS ══ */}
      <div className={`modal-overlay ${recvOpen ? 'open' : ''}`} onClick={() => !saving && setRecvOpen(false)}>
        <div className="modal-box" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#064e3b,#065f46)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="box" className="w-3.5 h-3.5" /> Receive Seals</div>
              <div className="text-base font-black text-white">Seals arriving at UNN 1</div>
            </div>
            <button onClick={() => setRecvOpen(false)} disabled={saving} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center shrink-0 ml-4 border-none cursor-pointer">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="box" className="w-3.5 h-3.5" /> Delivery from HQ</div>
              <CfSelect value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)}>
                <option value="">— Not a delivery from HQ (opening stock, other) —</option>
                {deliveries.map((d) => (
                  <option key={d.id} value={String(d.id)}>{deliveryLabel(d)}</option>
                ))}
              </CfSelect>
              {delivery && (
                <p className="text-[11px] font-bold text-slate-500 mt-2">
                  HQ sent <span className="font-black text-slate-700">{sentQty.toLocaleString()}</span> seals. Scan the first and last seal of each roll that arrived — it is checked against what HQ sent.
                </p>
              )}
              {deliveryDiffers && (
                <div className="text-[11px] font-black text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-2">
                  Does not match what HQ sent.
                  {notKeyed.length > 0 && <> {qtyOf(notKeyed).toLocaleString()} sent but not scanned: {formatSealRanges(notKeyed)}.</>}
                  {notSent.length > 0 && <> {qtyOf(notSent).toLocaleString()} scanned but not on the delivery: {formatSealRanges(notSent)}.</>}
                  {' '}You can still save — HQ will get a NELOS case.
                </div>
              )}
              {delivery && recvRanges.length > 0 && !deliveryDiffers && (
                <div className="text-[11px] font-black text-emerald-700 mt-2">✔ Matches what HQ sent.</div>
              )}
            </div>

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="tag" className="w-3.5 h-3.5" /> Seal ranges</div>
              <p className="text-[10px] font-bold text-slate-400 mb-3">Scan the first seal, then the last. Enter moves on by itself.</p>
              {recvOpen && (
                <SealRangeInput
                  rows={recvRows}
                  onChange={setRecvRows}
                  disabled={saving}
                  notes={(rd) => {
                    const c = checks[rd.key];
                    if (!c) return null;
                    if (c.state === 'checking') return <div className="text-[10px] font-bold text-slate-400 mt-1 pl-7">Checking…</div>;
                    const hits = receivedHits(rd);
                    if (!hits.length) return null;
                    return (
                      <div className="mt-1.5 pl-7 space-y-1">
                        {hits.map((h, i) => (
                          <div key={i} className="text-[10px] font-black text-red-600">
                            {rangeText(h.from_code, h.to_code)}: {h.detail}
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
              )}
            </div>

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="receipt" className="w-3.5 h-3.5" /> Seal order (optional)</div>
              <CfSelect value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                <option value="">— Not linked to an order —</option>
                {orders.map((o) => (
                  <option key={o.id} value={String(o.id)}>{orderLabel(o)}</option>
                ))}
              </CfSelect>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="calendar" className="w-3.5 h-3.5" /> Received date</div>
                <input type="date" className="search-input text-sm" style={{ padding: '10px 14px' }} value={recvDate} onChange={(e) => setRecvDate(e.target.value)} />
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="pencilNote" className="w-3.5 h-3.5" /> Remark</div>
                <input type="text" className="search-input text-sm" style={{ padding: '10px 14px' }} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            {!delivery && <label className="flex items-start gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={isOpening} onChange={(e) => setIsOpening(e.target.checked)} className="w-5 h-5 shrink-0 mt-0.5 accent-emerald-600 cursor-pointer" />
              <span>
                <span className="text-sm font-black text-slate-700">Opening stock</span>
                <span className="block text-[11px] font-bold text-slate-400">Tick when keying seals that were already at UNN 1 before the system.</span>
              </span>
            </label>}

            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="camera" className="w-3.5 h-3.5" /> Photos <span className="text-red-500">*</span></div>
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                    <img src={p} className="w-full h-full object-cover cursor-pointer" alt="Seal receipt" onClick={() => setViewer(p)} />
                    <button
                      onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs font-black border-none cursor-pointer"
                      title="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => photoInput.current && photoInput.current.click()}
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-emerald-400 hover:text-emerald-600 font-black text-2xl cursor-pointer"
                  title="Take photo"
                >
                  +
                </button>
              </div>
            </div>

            {recvProblems.length > 0 && (
              <div className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                {recvProblems.join(' · ')}
              </div>
            )}
          </div>

          <div className="px-5 sm:px-6 pb-6 flex flex-col sm:flex-row gap-3 justify-end border-t border-slate-100 pt-5">
            <button onClick={() => setRecvOpen(false)} disabled={saving} className="w-full sm:w-auto h-11 px-8 text-[10px] font-black text-slate-500 uppercase tracking-widest bg-slate-50 rounded-full border border-slate-200 cursor-pointer">Cancel</button>
            <button
              onClick={saveReceipt}
              disabled={!!recvProblems.length || saving}
              className="w-full sm:w-auto h-11 px-8 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-full border-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save · ' + recvTotal.toLocaleString() + ' seals'}
            </button>
          </div>
        </div>
      </div>

      {/* ══ PHOTO VIEWER ══ */}
      <div className={`modal-overlay ${viewer ? 'open' : ''}`} style={{ zIndex: 300 }} onClick={() => setViewer(null)}>
        {viewer && <img src={viewer} alt="Full size" style={{ maxWidth: '100%', maxHeight: '92vh', borderRadius: '12px' }} />}
      </div>

      <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={onPhotos} />

      <ToastHost />
    </>
  );
}

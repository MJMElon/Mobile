import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { displayName } from '../lib/auth';
import { callGeminiScan, compressImage } from '../lib/gemini';
import { printDOPdf } from '../lib/pdf';
import AuthGate from '../components/AuthGate';
import TopNav from '../components/TopNav';
import SignaturePad from '../components/SignaturePad';
import { useToast } from '../components/Toast';

export default function DoSigningPage() {
  return <AuthGate>{({ session, userName }) => <DoSigning session={session} userName={userName} />}</AuthGate>;
}

const SCAN_PROMPT = `You are an AI assistant for MJM Nursery Malaysia.
Examine this photo of a nursery delivery document, plant label, collection slip, or handwritten note.
The document may list MULTIPLE nurseries/farms with different plant breeds and quantities.

Extract ALL items visible. Also extract the customer/recipient name if shown on the document.
Return ONLY this JSON (no extra text):
{
  "customer_name": "string or null",
  "items": [
    {"nursery": "string or null", "breed": "string or null", "quantity": integer_or_null}
  ],
  "date": "YYYY-MM-DD or null"
}
Include one object per distinct nursery+breed combination. If a field is unreadable use null.`;

let rowSeq = 0;
const newRow = (nursery = '', breed = '', qty = '', aiTagged = false) => ({ id: ++rowSeq, nursery, breed, qty, aiTagged });

function DoSigning({ session, userName }) {
  const { ToastHost, showToast } = useToast();
  const staff = displayName(session);

  // ── Data ──
  const [alData, setAlData] = useState([]);
  const [consentALSet, setConsentALSet] = useState(() => new Set());
  const [plotsData, setPlotsData] = useState([]);
  const [breedsData, setBreedsData] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 640);

  // ── Manage modal ──
  const [activeAL, setActiveAL] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [doRows, setDoRows] = useState(null); // null=loading, []=empty
  const [doErr, setDoErr] = useState('');
  const [consents, setConsents] = useState(null);
  const [consentErr, setConsentErr] = useState('');

  // ── Choice modal ──
  const [choiceOpen, setChoiceOpen] = useState(false);

  // ── Scan modal ──
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPhoto, setScanPhoto] = useState(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanNotice, setScanNotice] = useState(false);
  const [scanAiBadge, setScanAiBadge] = useState(false);
  const [scanDoNumber, setScanDoNumber] = useState('');
  const [scanDate, setScanDate] = useState('');
  const [scanCustomer, setScanCustomer] = useState('');
  const [items, setItems] = useState([newRow()]);
  const [savingScan, setSavingScan] = useState(false);
  const [scanSigTime, setScanSigTime] = useState('');
  const scanSigRef = useRef(null);
  const cameraRef = useRef(null);

  // ── Print prompt ──
  const [printPrompt, setPrintPrompt] = useState(null); // { doNum, rec, sig }

  // ── Load ──
  const loadActiveALs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shared_al_orders')
      .select('*')
      .not('status', 'in', '("Cancelled","Collected")')
      .gt('balance_quantity', 0)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadErr(error.message);
      setLoading(false);
      return;
    }
    setAlData(data || []);
    const { data: c } = await supabase.from('mobile_consent_records').select('al_number');
    setConsentALSet(new Set((c || []).map((r) => r.al_number)));
    setLoading(false);
  }, []);

  const loadDropdownData = useCallback(async () => {
    const [{ data: plots }, { data: breeds }] = await Promise.all([
      supabase.from('shared_plots').select('plot_name, nursery_name'),
      supabase.from('shared_breeds').select('name'),
    ]);
    setPlotsData(plots || []);
    setBreedsData(breeds || []);
  }, []);

  useEffect(() => {
    loadActiveALs();
    loadDropdownData();
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [loadActiveALs, loadDropdownData]);

  const plotMap = useMemo(() => {
    const m = {};
    plotsData.forEach((p) => {
      m[p.plot_name] = p.nursery_name;
    });
    return m;
  }, [plotsData]);

  // ── Grouped list ──
  const groups = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const matched = [];
    const consentSigned = [];
    const activePending = [];
    alData.forEach((r) => {
      const isMatch =
        lower.length >= 1 &&
        ((r.al_number || '').toLowerCase().includes(lower) ||
          (r.order_number || '').toLowerCase().includes(lower) ||
          (r.customer_name || '').toLowerCase().includes(lower));
      const hasConsent = consentALSet.has(r.al_number);
      if (isMatch) matched.push(r);
      else if (hasConsent) consentSigned.push(r);
      else activePending.push(r);
    });
    const g = [];
    if (lower.length >= 1 && matched.length) g.push({ label: '🔍 Search Match', rows: matched, theme: 'amber' });
    if (consentSigned.length) g.push({ label: '✅ Consent Signed — Awaiting Collection', rows: consentSigned, theme: 'emerald' });
    if (activePending.length) g.push({ label: '📋 Active AL — Consent Pending', rows: activePending, theme: 'blue' });
    return g;
  }, [alData, consentALSet, query]);

  const themeMap = {
    amber: { header: 'bg-amber-50 text-amber-700 border-amber-200', row: 'bg-amber-50/60', bal: 'text-amber-700', border: 'border-l-4 border-amber-400' },
    emerald: { header: 'bg-emerald-50 text-emerald-700 border-emerald-200', row: 'bg-emerald-50/50', bal: 'text-emerald-700', border: 'border-l-4 border-emerald-500' },
    blue: { header: 'bg-blue-50 text-blue-700 border-blue-200', row: 'bg-blue-50/50', bal: 'text-blue-700', border: 'border-l-4 border-blue-400' },
  };

  // ── Manage DOs ──
  async function manageDOs(alNumber) {
    const al = alData.find((r) => r.al_number === alNumber);
    if (!al) return;
    setActiveAL(al);
    setManageOpen(true);
    setDoRows(null);
    setConsents(null);
    setDoErr('');
    setConsentErr('');
    loadDOsForAL(alNumber);
    loadConsentsForAL(alNumber);
  }

  async function loadDOsForAL(alNumber) {
    const { data, error } = await supabase
      .from('shared_do_records')
      .select('*')
      .eq('al_number', alNumber)
      .order('delivery_date', { ascending: false });
    if (error) {
      setDoErr(error.message);
      setDoRows([]);
      return;
    }
    setDoRows(data || []);
  }

  async function loadConsentsForAL(alNumber) {
    const { data, error } = await supabase
      .from('mobile_consent_records')
      .select('*')
      .eq('al_number', alNumber)
      .order('created_at', { ascending: false });
    if (error) {
      setConsentErr(error.message);
      setConsents([]);
      return;
    }
    setConsents(data || []);
  }

  const totalIssued = useMemo(() => {
    if (!doRows) return 0;
    return doRows.filter((d) => d.status !== 'Cancelled').reduce((s, d) => s + (parseInt(d.total_qty) || 0), 0);
  }, [doRows]);

  // ── Choice / camera ──
  function openCamera(alNumber) {
    const al = alData.find((r) => r.al_number === alNumber) || null;
    if (!al) return;
    setActiveAL(al);
    setChoiceOpen(true);
  }

  function triggerCamera() {
    setChoiceOpen(false);
    if (cameraRef.current) {
      cameraRef.current.value = '';
      cameraRef.current.click();
    }
  }

  async function onCameraFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = await compressImage(ev.target.result);
      await openScanModal(base64);
      runAIScan(base64, 'image/jpeg');
    };
    reader.readAsDataURL(file);
  }

  function openManualEntry() {
    setChoiceOpen(false);
    openScanModal(null);
  }

  async function retakeScan() {
    setScanOpen(false);
    setTimeout(triggerCamera, 150);
  }

  // ── DO number ──
  async function generateDONumber() {
    const year = new Date().getFullYear();
    const prefix = `DO-${year}-`;
    const { data } = await supabase
      .from('shared_do_records')
      .select('do_number')
      .ilike('do_number', `${prefix}%`)
      .order('do_number', { ascending: false })
      .limit(1);
    let next = 1;
    if (data && data.length) {
      const num = parseInt(String(data[0].do_number).slice(prefix.length).replace(/\D/g, '')) || 0;
      next = num + 1;
    }
    return prefix + String(next).padStart(4, '0');
  }

  // ── Scan modal ──
  async function openScanModal(base64) {
    setScanPhoto(base64);
    setScanLoading(!!base64);
    setScanNotice(false);
    setScanAiBadge(false);
    setScanCustomer(activeAL?.customer_name || '');
    setScanDate(new Date().toISOString().split('T')[0]);
    setItems([newRow()]);
    setScanSigTime('');
    setScanOpen(true);
    const doNum = await generateDONumber();
    setScanDoNumber(doNum);
  }

  function closeScanModal() {
    setScanOpen(false);
    setScanPhoto(null);
  }

  async function runAIScan(base64, mimeType) {
    let result = { items: [], date: null };
    let failed = false;
    try {
      result = await callGeminiScan(base64, mimeType, SCAN_PROMPT);
    } catch (err) {
      console.error('AI scan error:', err);
      failed = true;
    }
    setScanLoading(false);
    if (failed || !result.items?.length) {
      setScanNotice(true);
      return;
    }
    const rows = result.items.slice(0, 5).map((it) => newRow(it.nursery || '', it.breed || '', it.quantity || '', true));
    setItems(rows.length ? rows : [newRow()]);
    if (result.date) setScanDate(result.date);
    if (result.customer_name) setScanCustomer(result.customer_name);
    setScanAiBadge(true);
  }

  // ── Item rows ──
  const totalQty = useMemo(() => items.reduce((s, it) => s + (parseInt(it.qty) || 0), 0), [items]);
  const balanceRemain = (activeAL?.balance_quantity ?? 0) - totalQty;

  function addItemRow() {
    setItems((prev) => (prev.length >= 5 ? (showToast('Maximum 5 item rows'), prev) : [...prev, newRow()]));
  }
  function removeItemRow(id) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }
  function updateItem(id, field, value) {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  const customerMatch = useMemo(() => {
    const v = scanCustomer.trim().toLowerCase();
    if (!v) return null;
    return v === (activeAL?.customer_name || '').toLowerCase();
  }, [scanCustomer, activeAL]);

  // ── Save DO ──
  async function saveScanDO() {
    const collected = items
      .map((it) => ({ nursery: it.nursery.trim(), breed: it.breed.trim(), qty: parseInt(it.qty) || 0 }))
      .filter((it) => it.nursery || it.breed || it.qty > 0);
    const total = collected.reduce((s, it) => s + it.qty, 0);

    if (!scanDate) return alert('Please select a Delivery Date.');
    if (!collected.length) return alert('Please add at least one item row.');
    if (total <= 0) return alert('Total Qty must be greater than 0.');
    if (total > (activeAL?.balance_quantity ?? 0)) return alert(`Total Qty (${total}) exceeds remaining balance (${activeAL.balance_quantity}).`);
    if (!scanSigRef.current?.hasSignature()) return alert('Please ask the customer to sign before saving.');

    const sigDataUrl = scanSigRef.current.toDataURL();
    setSavingScan(true);

    // Upload photo if present
    let imageUrl = null;
    if (scanPhoto) {
      try {
        const filePath = `do_photos/${activeAL.al_number}/${scanDoNumber}_${Date.now()}.jpg`;
        const bytes = atob(scanPhoto.split(',')[1]);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        const { error: upErr } = await supabase.storage.from('documents').upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
          imageUrl = urlData?.publicUrl || null;
        }
      } catch (e) {
        imageUrl = scanPhoto;
      }
    }

    const payload = {
      do_number: scanDoNumber,
      al_number: activeAL.al_number,
      delivery_date: scanDate,
      total_qty: total,
      remark: activeAL.customer_name,
      status: 'Delivered',
      image_url: imageUrl,
    };
    collected.slice(0, 5).forEach((it, i) => {
      const n = i + 1;
      const matched = plotsData.find((p) => p.nursery_name?.toLowerCase() === it.nursery?.toLowerCase());
      payload[`plot_${n}`] = matched ? matched.plot_name : it.nursery || null;
      payload[`breed_${n}`] = it.breed || null;
      payload[`qty_${n}`] = it.qty || null;
    });

    const { error: insertErr } = await supabase.from('shared_do_records').insert([payload]);
    if (insertErr) {
      setSavingScan(false);
      return alert('Error saving DO: ' + insertErr.message);
    }

    // Deduct balance
    const newBalance = (activeAL.balance_quantity ?? 0) - total;
    await supabase.from('shared_al_orders').update({ balance_quantity: newBalance }).eq('id', activeAL.id);

    const updatedAL = { ...activeAL, balance_quantity: newBalance };
    setAlData((prev) => {
      const next = prev.map((r) => (r.id === activeAL.id ? updatedAL : r));
      return newBalance <= 0 ? next.filter((r) => r.id !== activeAL.id) : next;
    });
    setActiveAL(updatedAL);
    setSavingScan(false);
    closeScanModal();

    // Refresh manage list + show print prompt
    setManageOpen(true);
    loadDOsForAL(updatedAL.al_number);
    setTimeout(() => setPrintPrompt({ doNum: scanDoNumber, rec: payload, sig: sigDataUrl }), 400);
  }

  function doPrint(rec, sig = null) {
    const al = activeAL || alData.find((r) => r.al_number === rec.al_number) || {};
    printDOPdf(rec, al, staff, sig);
    showToast(`${rec.do_number} printed!`);
  }

  // ════════════════ RENDER ════════════════
  return (
    <>
      <TopNav title="Issue Collection DO — Sign & Print" userName={userName} />

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-5" style={{ background: '#f1f5f9', minHeight: 'calc(100vh - 65px)' }}>
        <div className="dash-card p-5 sm:p-6">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">🔍 Search Order Number / Customer Name</div>
          <div className="flex gap-3 mb-5">
            <input
              type="text"
              className="search-input"
              placeholder="AL No., Order No. or Customer Name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="shrink-0 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
              Search
            </button>
          </div>

          <div className="flex flex-wrap gap-3 mb-5">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700"><span className="w-3 h-3 rounded bg-amber-400 inline-block"></span>Search Match</span>
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span>Consent Signed — Awaiting Collection</span>
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-blue-700"><span className="w-3 h-3 rounded bg-blue-400 inline-block"></span>Active AL — Consent Pending</span>
          </div>

          {loading ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">Loading…</div>
          ) : loadErr ? (
            <div className="text-center py-8 text-red-400 text-xs font-bold">{loadErr}</div>
          ) : !groups.length ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">📭</div>
              <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">No active approval letters found</div>
            </div>
          ) : isMobile ? (
            groups.map((g) => {
              const t = themeMap[g.theme];
              return (
                <div className="mb-5" key={g.label}>
                  <div className={`text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border mb-3 ${t.header}`}>{g.label} ({g.rows.length})</div>
                  {g.rows.map((r) => (
                    <div key={r.id} className={`bg-white rounded-2xl p-4 mb-2 shadow-sm border border-slate-200 ${t.border}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-black text-slate-800">{r.al_number || '—'}</div>
                          <div className="text-xs font-bold text-slate-500 mt-0.5">{r.customer_name || '—'}</div>
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border ${t.header}`}>{r.status || 'Unverified'}</span>
                      </div>
                      <div className="text-xs font-bold text-slate-400 mb-3">📋 {r.order_number || '—'} &nbsp;·&nbsp; Qty: {r.quantity_ordered ?? '—'} &nbsp;·&nbsp; Bal: <span className={`${t.bal} font-black`}>{r.balance_quantity ?? '—'}</span></div>
                      <div className="flex gap-2">
                        <button className="btn-open flex-1 text-center" onClick={() => manageDOs(r.al_number)}>Manage DOs</button>
                        <button onClick={() => openCamera(r.al_number)} title="Add DO via camera scan" className="shrink-0 flex items-center justify-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-xl border-none cursor-pointer transition-colors">
                          <CameraIcon />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>AL No.</th><th>Order #</th><th>Customer</th><th>Qty Ordered</th><th>Balance</th><th>Action</th></tr></thead>
                <tbody>
                  {groups.map((g) => {
                    const t = themeMap[g.theme];
                    return (
                      <Fragment key={g.label}>
                        <tr><td colSpan={6} className={`py-2 px-4 text-[9px] font-black uppercase tracking-widest ${t.header} border-b`}>{g.label} &nbsp;({g.rows.length})</td></tr>
                        {g.rows.map((r) => (
                          <tr key={r.id} className={t.row}>
                            <td><span className="font-black text-slate-800">{r.al_number || '—'}</span></td>
                            <td>{r.order_number || '—'}</td>
                            <td>{r.customer_name || '—'}</td>
                            <td>{r.quantity_ordered ?? '—'}</td>
                            <td><span className={`font-black ${t.bal}`}>{r.balance_quantity ?? '—'}</span></td>
                            <td className="whitespace-nowrap">
                              <button className="btn-open mr-1" onClick={() => manageDOs(r.al_number)}>Manage DOs</button>
                              <button onClick={() => openCamera(r.al_number)} title="Add DO via camera scan" className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white border-none cursor-pointer transition-colors align-middle">
                                <CameraIcon />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Hidden camera input */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onCameraFile} />

      {/* MANAGE MODAL */}
      <div className={`modal-overlay ${manageOpen ? 'open' : ''}`} onClick={() => setManageOpen(false)}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">📋 Delivery Orders</div>
              <div className="text-xl font-black text-white tracking-wide">Manage DOs for {activeAL?.al_number || '—'}</div>
            </div>
            <button onClick={() => setManageOpen(false)} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">✕</button>
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            {activeAL && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  ['AL Number', activeAL.al_number || '—'],
                  ['Order Number', activeAL.order_number || '—'],
                  ['Customer Name', activeAL.customer_name || '—'],
                  ['Purchased Product', activeAL.product_name || '—'],
                  ['Qty Ordered', activeAL.quantity_ordered ?? '—'],
                  ['Balance to Collect', activeAL.balance_quantity ?? '—', true],
                ].map(([label, value, big]) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                    <div className={`font-black ${big ? 'text-blue-700 text-base' : 'text-slate-800 text-sm'} leading-snug`}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* DO records */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">DO Records Issued</div>
                <button onClick={() => activeAL && openCamera(activeAL.al_number)} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-xl border-none cursor-pointer transition-colors">
                  <CameraIcon /> Add DO
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
                <table className="data-table">
                  <thead><tr><th>Delivery Date</th><th>DO Number</th><th>Nursery</th><th>Breed</th><th>Qty</th><th>Photo</th></tr></thead>
                  <tbody>
                    {doRows === null ? (
                      <tr><td colSpan={6} className="text-center py-6 text-slate-400 text-xs font-bold uppercase tracking-widest">Loading…</td></tr>
                    ) : doErr ? (
                      <tr><td colSpan={6} className="text-center py-6 text-red-400 text-xs font-bold">{doErr}</td></tr>
                    ) : !doRows.length ? (
                      <tr><td colSpan={6} className="text-center py-10"><div className="text-3xl mb-2">📭</div><div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No DOs issued yet for this AL</div></td></tr>
                    ) : (
                      doRows.map((d) => <DoRow key={d.id} d={d} plotMap={plotMap} onPrint={() => doPrint(d)} />)
                    )}
                  </tbody>
                </table>
              </div>
              {doRows && doRows.length > 0 && (
                <div className="text-[10px] font-bold text-slate-400 mt-2 text-right">
                  Total Issued: <span className="font-black text-slate-700">{totalIssued}</span> &nbsp;·&nbsp; Balance to Collect: <span className="font-black text-blue-700">{activeAL?.balance_quantity ?? '—'}</span>
                </div>
              )}
            </div>

            {/* Consents */}
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">✍️ Signed Consent Records</div>
              <ConsentArea consents={consents} err={consentErr} />
            </div>
          </div>

          <div className="px-5 sm:px-6 pb-6 flex justify-end border-t border-slate-100 pt-5">
            <button onClick={() => setManageOpen(false)} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Close</button>
          </div>
        </div>
      </div>

      {/* CHOICE MODAL */}
      <div className={`modal-overlay ${choiceOpen ? 'open' : ''}`} onClick={() => setChoiceOpen(false)}>
        <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-3xl mb-2">📋</div>
          <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">Add New DO</div>
          <div className="text-xs font-bold text-slate-400 mb-1">{activeAL?.al_number || '—'} · {activeAL?.customer_name || '—'}</div>
          <div className="text-[11px] font-bold text-slate-300 mb-6">Order: {activeAL?.order_number || '—'}</div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <button onClick={triggerCamera} className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 hover:border-blue-500 transition-all cursor-pointer">
              <CameraIcon className="w-8 h-8 text-blue-600" />
              <span className="text-[11px] font-black text-blue-700 uppercase tracking-wide">Take Photo<br /><span className="text-[9px] font-bold text-blue-400 normal-case">AI will scan the doc</span></span>
            </button>
            <button onClick={openManualEntry} className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-50 hover:bg-slate-100 border-2 border-slate-200 hover:border-slate-400 transition-all cursor-pointer">
              <PencilIcon />
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-wide">Key in Manually<br /><span className="text-[9px] font-bold text-slate-400 normal-case">Fill form directly</span></span>
            </button>
          </div>
          <button onClick={() => setChoiceOpen(false)} className="text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest cursor-pointer border-none bg-transparent">Cancel</button>
        </div>
      </div>

      {/* SCAN MODAL */}
      <div className={`modal-overlay ${scanOpen ? 'open' : ''}`} onClick={closeScanModal}>
        <div className="modal-box" style={{ maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{scanPhoto ? '📷 AI-Powered Scan' : '✏️ Manual Entry'}</div>
              <div className="text-xl font-black text-white">New Delivery Order</div>
              <div className="text-[11px] font-bold text-slate-400 mt-1">
                <span className="text-white font-black">{activeAL?.al_number || '—'}</span>
                <span className="text-amber-400 mx-2">✦</span>
                <span className="text-slate-300">{activeAL?.customer_name || '—'}</span>
                <span className="text-amber-400 mx-2">✦</span>
                <span className="text-slate-300">{activeAL?.order_number || '—'}</span>
              </div>
            </div>
            <button onClick={closeScanModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">✕</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {scanPhoto && (
              <div className="rounded-2xl overflow-hidden border-2 border-slate-200 bg-slate-50 relative" style={{ maxHeight: '240px' }}>
                <img src={scanPhoto} alt="scan" className="w-full object-contain" style={{ maxHeight: '240px' }} />
                <button onClick={retakeScan} className="absolute bottom-3 right-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white bg-black/60 hover:bg-black/80 px-3 py-2 rounded-xl border-none cursor-pointer transition-colors backdrop-blur-sm">
                  <CameraIcon className="w-3.5 h-3.5" /> Retake
                </button>
              </div>
            )}

            {scanLoading ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🤖</div>
                <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">AI is reading the document…</div>
                <div className="text-[10px] font-bold text-slate-300 mt-1">Extracting nursery, breed &amp; quantity</div>
              </div>
            ) : (
              <>
                {scanNotice && <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">⚠️ AI could not read all fields — please fill in or correct manually below.</div>}
                {scanAiBadge && <div className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 uppercase tracking-wider">✨ AI scan complete — verify the details below before saving.</div>}

                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">DO Number <span className="text-blue-500">AUTO</span></label>
                      <input value={scanDoNumber} readOnly className="search-input text-sm font-black bg-blue-50 border-blue-200 cursor-default" style={{ padding: '10px 14px' }} />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Delivery Date *</label>
                      <input type="date" value={scanDate} onChange={(e) => setScanDate(e.target.value)} className="search-input text-sm" style={{ padding: '10px 14px' }} />
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Customer Name</label>
                    <div className="flex gap-2 items-center">
                      <input value={scanCustomer} onChange={(e) => setScanCustomer(e.target.value)} className="search-input text-sm flex-1" style={{ padding: '10px 14px' }} />
                      {customerMatch !== null && (
                        <div className={`shrink-0 text-[10px] font-black px-3 py-2 rounded-xl border ${customerMatch ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                          {customerMatch ? '✓ Match' : '⚠ Mismatch'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Items (Nursery · Breed · Qty) <span className="text-slate-300">max 5 rows</span></label>
                      {items.length < 5 && (
                        <button onClick={addItemRow} className="text-[9px] font-black text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors uppercase tracking-widest">+ Add Row</button>
                      )}
                    </div>
                    <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
                      <table className="w-full" style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="p-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest w-6">#</th>
                            <th className="p-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Nursery</th>
                            <th className="p-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">Breed / Plant</th>
                            <th className="p-2 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest w-20">Qty</th>
                            <th className="p-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => (
                            <tr key={it.id}>
                              <td className="p-2 text-center text-[10px] font-black text-slate-400 w-6">{i + 1}</td>
                              <td className="p-1.5">
                                <input list="nursery-list" value={it.nursery} onChange={(e) => updateItem(it.id, 'nursery', e.target.value)} placeholder="Nursery / Farm" className="search-input text-xs w-full" style={{ padding: '7px 10px' }} />
                                {it.aiTagged && <span className="text-[9px] text-emerald-600 font-black"> ✨AI</span>}
                              </td>
                              <td className="p-1.5">
                                <input list="breed-list" value={it.breed} onChange={(e) => updateItem(it.id, 'breed', e.target.value)} placeholder="Breed / Plant" className="search-input text-xs w-full" style={{ padding: '7px 10px' }} />
                              </td>
                              <td className="p-1.5 w-20">
                                <input type="number" min="0" value={it.qty} onChange={(e) => updateItem(it.id, 'qty', e.target.value)} placeholder="0" className="search-input text-xs w-full" style={{ padding: '7px 10px' }} />
                              </td>
                              <td className="p-1.5 w-8 text-center">
                                <button onClick={() => removeItemRow(it.id)} className="text-slate-300 hover:text-red-500 font-black text-xl leading-none transition-colors cursor-pointer border-none bg-transparent">×</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 mt-2 text-right">
                      Total Qty: <span className="font-black text-slate-700">{totalQty}</span>
                      &nbsp;·&nbsp; Balance: <span className={`font-black ${balanceRemain < 0 ? 'text-red-600' : 'text-blue-700'}`}>{balanceRemain}</span>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-5">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">✍️ Customer Signature</div>
                    <p className="text-[10px] font-bold text-slate-300 mb-3">By signing, the customer acknowledges receipt of the above items in good condition.</p>
                    {scanOpen && <SignaturePad ref={scanSigRef} height={160} hint="Touch or click here to sign" onSignedAt={(d) => setScanSigTime(d.toLocaleDateString('en-MY') + ' ' + d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }))} />}
                    <div className="flex justify-between items-center mt-2">
                      <button onClick={() => { scanSigRef.current?.clear(); setScanSigTime(''); }} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors">✕ Clear</button>
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{scanSigTime}</span>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-1 border-t border-slate-100">
                    <button onClick={closeScanModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-5 py-2.5 rounded-full border border-slate-200 cursor-pointer transition-colors">Cancel</button>
                    <button onClick={saveScanDO} disabled={savingScan} className="text-[10px] font-black text-white uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 px-7 py-2.5 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50">{savingScan ? 'Saving…' : '💾 Save & Sign DO'}</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* PRINT PROMPT */}
      <div className={`modal-overlay ${printPrompt ? 'open' : ''}`}>
        <div className="bg-white rounded-3xl p-7 w-full max-w-sm shadow-2xl text-center">
          <div className="text-4xl mb-3">🖨️</div>
          <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">DO Saved!</div>
          <div className="text-sm font-bold text-slate-500 mb-1">{printPrompt?.doNum || '—'}</div>
          <div className="text-xs font-bold text-slate-400 mb-6">Print this DO for the customer?</div>
          <div className="flex flex-col gap-3">
            <button onClick={() => { const p = printPrompt; setPrintPrompt(null); if (p) doPrint(p.rec, p.sig); }} className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">🖨️ Yes — Print PDF</button>
            <button onClick={() => { setPrintPrompt(null); showToast('DO saved!'); }} className="w-full py-2.5 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 border border-slate-200 rounded-xl cursor-pointer transition-colors">Maybe Later</button>
          </div>
        </div>
      </div>

      <datalist id="nursery-list">{[...new Set(plotsData.map((p) => p.nursery_name).filter(Boolean))].map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="breed-list">{breedsData.filter((b) => b.name).map((b) => <option key={b.name} value={b.name} />)}</datalist>

      <ToastHost />
    </>
  );
}

// ── Small helpers ──
function DoRow({ d, plotMap, onPrint }) {
  const isCancelled = d.status === 'Cancelled';
  const dateFmt = d.delivery_date ? new Date(d.delivery_date).toLocaleDateString('en-MY') : '—';
  const lines = [];
  for (let i = 1; i <= 5; i++) {
    const plot = d[`plot_${i}`];
    const breed = d[`breed_${i}`];
    const qty = parseInt(d[`qty_${i}`]) || 0;
    if (plot || breed || qty > 0) lines.push({ nursery: plotMap[plot] || plot || '—', breed: breed || '—', qty });
  }
  return (
    <tr className={isCancelled ? 'opacity-50' : ''}>
      <td className="text-slate-500 font-bold whitespace-nowrap">{dateFmt}</td>
      <td><span className={`font-black ${isCancelled ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{d.do_number || '—'}</span></td>
      <td className="text-slate-600 text-xs">{lines.length ? lines.map((l, i) => <div key={i} className="leading-5">{l.nursery}</div>) : '—'}</td>
      <td className="text-slate-600 text-xs">{lines.length ? lines.map((l, i) => <div key={i} className="leading-5">{l.breed}</div>) : '—'}</td>
      <td>{lines.length ? lines.map((l, i) => <div key={i} className="leading-5 font-black text-emerald-700">{l.qty}</div>) : <span className="font-black text-emerald-700">{d.total_qty ?? '—'}</span>}</td>
      <td>
        <div className="flex items-center gap-1.5">
          {d.image_url ? (
            <button onClick={() => window.open(d.image_url, '_blank')} className="w-11 h-11 rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 transition-colors shrink-0 cursor-pointer bg-slate-50">
              <img src={d.image_url} className="w-full h-full object-cover" loading="lazy" alt="DO" />
            </button>
          ) : (
            <span className="text-slate-200 text-xs">—</span>
          )}
          <button onClick={onPrint} title="Print this DO" className="w-11 h-11 rounded-lg border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 flex items-center justify-center cursor-pointer transition-colors bg-slate-50 shrink-0">
            <PrintIcon />
          </button>
        </div>
      </td>
    </tr>
  );
}

function ConsentArea({ consents, err }) {
  if (consents === null) return <div className="text-center py-4 text-slate-300 text-xs font-bold uppercase tracking-widest">Loading…</div>;
  if (err) return <div className="text-xs text-red-400 font-bold">{err}</div>;
  if (!consents.length)
    return (
      <div className="text-center py-5 bg-slate-50 rounded-xl border border-slate-100">
        <div className="text-2xl mb-2">📋</div>
        <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No consent records for this AL</div>
      </div>
    );
  const total = consents.reduce((s, c) => s + (c.consent_qty || 0), 0);
  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-slate-400">{consents.length} consent(s)</span>
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">Total Consented: {total.toLocaleString()}</span>
      </div>
      {consents.map((c, i) => {
        const dt = c.created_at ? new Date(c.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        return (
          <div key={c.id || i} className="bg-white rounded-2xl border border-emerald-200 p-4 mb-3 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Consent #{i + 1}</span>
                <div className="text-xs font-bold text-slate-500 mt-0.5">{dt}</div>
              </div>
              <span className="text-sm font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-xl border border-emerald-200">{(c.consent_qty || 0).toLocaleString()} seedlings</span>
            </div>
            {c.ai_sticker_count != null && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-2 mt-2">
                <span className="text-[9px] font-black text-blue-700 uppercase tracking-widest">🤖 AI Count:</span>
                <span className="font-black text-blue-700">{c.ai_sticker_count.toLocaleString()}</span>
              </div>
            )}
            {c.photo_url && (
              <div className="mt-2">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">📷 Sticker Photo</div>
                <img src={c.photo_url} className="rounded-xl border border-slate-200" style={{ maxHeight: '120px', maxWidth: '100%', objectFit: 'contain' }} alt="Sticker" />
              </div>
            )}
            {c.signature_data && (
              <div className="mt-2">
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">✍️ Signature</div>
                <img src={c.signature_data} style={{ height: '48px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc' }} alt="Signature" />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function CameraIcon({ className = 'w-4 h-4' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400 hover:text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
    </svg>
  );
}

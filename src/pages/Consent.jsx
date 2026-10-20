import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callGeminiScan, compressImage } from '../lib/gemini';
import { CONSENT_JOB, looksOffline, queueJob, sendConsent } from '../lib/mobileQueue.js';
import { isOnline } from '../lib/auth';
import AuthGate from '../components/AuthGate';
import TopNav from '../components/TopNav';
import SignaturePad from '../components/SignaturePad';
import SealRangeInput, { newSealRow, overlappingRows, readSealRow, sealRangesOf, useSealChecks } from '../components/SealRangeInput.jsx';
import { useToast } from '../components/Toast';
import { formatSealRanges, rangeQty, sealNo } from '../lib/sealRanges.js';
import Icon from '../components/Icon.jsx';

export default function ConsentPage() {
  return <AuthGate>{({ session, userName }) => <Consent session={session} userName={userName} />}</AuthGate>;
}

// AI sticker-count prompt — preserved verbatim from the legacy page.
const STICKER_PROMPT =
  'You are an expert at counting plant seedling stickers/labels in nursery photos. ' +
  'Count the total number of individual stickers or labels visible in this photo. ' +
  'Each sticker represents one seedling unit. ' +
  'Return JSON: { "sticker_count": <number>, "confidence": "high"|"medium"|"low", "notes": "<any observations>" }';

// ── Bilingual consent (English / Bahasa Malaysia) ──
// Terms mirror the official MJM Nursery Customer Consent form.
const CONSENT_STRINGS = {
  en: {
    tcHeader: 'Terms & Conditions',
    heading: 'MJM Nursery — Customer Consent',
    terms: [
      '<strong>1. Physical Verification.</strong> Customer must verify the number of identification stickers matches the total purchase quantity before proceeding to the nursery.',
      '<strong>2. Seedling Selection.</strong> Seedlings with stickers attached are considered selected and accepted in terms of size, quality, and condition.<br><strong>Worker Assistance.</strong> If customers request workers to help stick stickers or select seedlings, all selection risks are under the customer’s responsibility. The company will not be responsible for the quality or characteristics of seedlings selected under the customer’s instruction.',
      '<strong>3. Loading Verification.</strong> Customers must verify the quantity of seedlings loaded onto the lorry before signing the Delivery Note (DO).',
      '<strong>4. After DO Signature.</strong> No exchange, replacement, or claims will be entertained after the DO is signed.',
      '<strong>5. Form Verification.</strong> The Declaration Form (L3) must be checked before leaving the nursery. Any errors must be corrected at the office first.',
    ],
    agree: 'By signing below, I have read the terms and I hereby accept and agree to the terms as stated above.',
    photoTitle: 'Attach Photo — Seals / Stickers',
    photoHelp: 'Take a photo of the seedling stickers. AI will count the sticker quantity automatically.',
    tapTitle: 'Tap to Take Photo',
    tapSub: 'Camera will open to capture sticker image',
    signTitle: 'Customer Signature',
    signHelp: 'Customer signs below to consent to the collection terms for this trip.',
    cancel: 'Cancel',
    save: 'Save',
  },
  ms: {
    tcHeader: 'Terma & Syarat',
    heading: 'MJM Nursery — Persetujuan Pelanggan',
    terms: [
      '<strong>1. Pengesahan Jumlah.</strong> Pelanggan mesti semak jumlah pelekat sama dengan jumlah pembelian sebelum masuk nursery.',
      '<strong>2. Pemilihan Anak Benih.</strong> Anak benih yang telah ditampal pelekat dianggap telah dipilih dan dipersetujui dari segi saiz, kualiti, dan keadaan.<br><strong>Bantuan Pekerja.</strong> Jika pelanggan meminta pekerja membantu tampal pelekat atau pilih anak benih, segala risiko pemilihan adalah tanggungjawab pelanggan sendiri. Syarikat tidak akan bertanggungjawab terhadap kualiti atau ciri-ciri anak benih yang dipilih oleh pekerja atas arahan pelanggan.',
      '<strong>3. Semakan Muatan.</strong> Pelanggan mesti semak jumlah anak benih yang dimuat naik ke lori sebelum tandatangan nota penghantaran (DO).',
      '<strong>4. Selepas Tandatangan DO.</strong> Tiada pertukaran, gantian, atau tuntutan akan dilayan selepas DO ditandatangani.',
      '<strong>5. Semakan Borang.</strong> Borang Akuan (L3) mesti disemak sebelum keluar dari nursery. Sebarang kesilapan perlu dibetulkan di pejabat terlebih dahulu.',
    ],
    agree: 'Dengan menandatangani di bawah, saya mengesahkan bahawa saya telah membaca, memahami dan saya bersetuju dengan terma dinyatakan di atas.',
    photoTitle: 'Lampirkan Foto — Pelekat',
    photoHelp: 'Ambil foto pelekat anak benih. AI akan mengira jumlah pelekat secara automatik.',
    tapTitle: 'Ketik untuk Ambil Foto',
    tapSub: 'Kamera akan dibuka untuk menangkap imej pelekat',
    signTitle: 'Tandatangan Pelanggan',
    signHelp: 'Pelanggan menandatangani di bawah untuk bersetuju dengan terma pengambilan bagi perjalanan ini.',
    cancel: 'Batal',
    save: 'Simpan',
  },
};

const QTY_PRESETS = [
  { qty: 50, label: '+50' },
  { qty: 100, label: '+100' },
  { qty: 500, label: '+500' },
  { qty: 1000, label: '+1,000' },
];

// Scoped styles for legacy-specific classes not in the shared stylesheet.
const SCOPED_CSS = `
.btn-consent { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; color:#065f46; background:#ecfdf5; border:1px solid #a7f3d0; padding:6px 14px; border-radius:20px; cursor:pointer; transition:all .2s; font-family:'Outfit',sans-serif; white-space:nowrap; }
.btn-consent:hover { background:#10b981; color:white; border-color:#10b981; }
.qty-btn { padding:10px 18px; border-radius:14px; border:2px solid #e2e8f0; background:white; font-weight:900; font-size:14px; cursor:pointer; transition:all .2s; font-family:'Outfit',sans-serif; color:#334155; }
.qty-btn:hover { border-color:#10b981; background:#ecfdf5; color:#065f46; }
.qty-btn.active { border-color:#10b981; background:#10b981; color:white; box-shadow:0 4px 12px rgba(16,185,129,.3); }
.consent-body { background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:12px; padding:1.1rem; font-size:13px; color:#374151; line-height:1.75; max-height:380px; overflow-y:auto; }
.cs-lang-btn { font-size:10px; font-weight:900; letter-spacing:.06em; padding:3px 10px; border-radius:9999px; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all .15s; }
.cs-lang-btn.active { background:#059669; border-color:#059669; color:#fff; }
.consent-body h4 { font-size:11px; font-weight:900; color:#111827; margin:0 0 .5rem; text-transform:uppercase; letter-spacing:.04em; }
.consent-body p { margin-bottom:.6rem; }
.consent-body p:last-child { margin-bottom:0; }
.history-table { width:100%; border-collapse:collapse; font-size:12px; }
.history-table th { background:#f8fafc; padding:8px 12px; text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; color:#64748b; border-bottom:2px solid #e2e8f0; }
.history-table td { padding:8px 12px; border-bottom:1px solid #f1f5f9; font-weight:600; vertical-align:middle; }
.photo-area { border:2px dashed #cbd5e1; border-radius:16px; background:#f8fafc; text-align:center; padding:.9rem; cursor:pointer; transition:all .2s; }
.photo-area:hover { border-color:#10b981; background:#ecfdf5; }
.photo-area.has-photo { border-style:solid; border-color:#10b981; padding:.5rem; }
.scan-barcode-btn { display:inline-flex; align-items:center; gap:6px; padding:12px 16px; border-radius:14px; border:2px solid #e2e8f0; background:white; cursor:pointer; transition:all .2s; font-family:'Outfit',sans-serif; font-weight:900; font-size:12px; color:#334155; }
.scan-barcode-btn:hover { border-color:#10b981; background:#ecfdf5; color:#065f46; }
@keyframes consent-pulse-glow { 0%,100%{box-shadow:0 0 8px rgba(16,185,129,.3)} 50%{box-shadow:0 0 20px rgba(16,185,129,.6)} }
`;

function Consent({ session, userName }) {
  const { ToastHost, showToast } = useToast();

  // ── Data ──
  const [alData, setAlData] = useState([]);
  // Recently completed ALs (balance already 0) for the permanent Completed
  // group at the bottom — see loadCompletedALs below for why these are
  // fetched separately rather than just dropping alData's own
  // balance_quantity > 0 filter.
  const [completedData, setCompletedData] = useState([]);
  const [completedLoadError, setCompletedLoadError] = useState('');
  const [consentCountMap, setConsentCountMap] = useState({});
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  // Rows found by a live, server-side search for anything outside the
  // windows above (an older completed AL, mainly) — see queueLiveSearch.
  const [liveMatches, setLiveMatches] = useState([]);
  const liveSearchTimerRef = useRef(null);
  const liveSearchTokenRef = useRef(0);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
  const [collapsedGroups, setCollapsedGroups] = useState(() => ({ emerald: true }));
  // Which of the three ordinary groups to show -- 'all' | 'consent' |
  // 'pending' | 'completed'. A search ignores this entirely (see groups
  // below): it is only the unsearched browse view this narrows.
  const [activeTab, setActiveTab] = useState('all');

  // ── Consent detail modal ──
  const [detailOpen, setDetailOpen] = useState(false);
  const [currentAL, setCurrentAL] = useState(null);
  const [totalPreviouslyConsented, setTotalPreviouslyConsented] = useState(0);
  const [selectedQty, setSelectedQty] = useState(0);
  const [customQty, setCustomQty] = useState('');
  const [fullActive, setFullActive] = useState(false);
  const [history, setHistory] = useState(null); // null=loading, []=empty, [...]=rows
  const [historyErr, setHistoryErr] = useState('');
  // Seal (barcode) scans against each consent, from the FC scan app —
  // keyed by consent_id, so ConsentHistory can show "which seals were
  // actually scanned for THIS collection trip" under each row. Fetched in
  // one request per AL rather than one per row.
  const [sealLogs, setSealLogs] = useState({});

  // ── Sign modal ──
  const [signOpen, setSignOpen] = useState(false);
  const [signTitle, setSignTitle] = useState('—');
  const [signQty, setSignQty] = useState(0);
  const [consentLang, setConsentLang] = useState('en');
  const [agreed, setAgreed] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [aiStickerCount, setAiStickerCount] = useState(null);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiResultShown, setAiResultShown] = useState(false);
  const [aiCountLabel, setAiCountLabel] = useState('0');
  const [aiNotice, setAiNotice] = useState(''); // '' = hidden
  const [submitting, setSubmitting] = useState(false);
  const sigRef = useRef(null);

  // ── Seals issued with this consent ──
  // Optional: a consent signed with no seals is the old flow and still
  // saves. Once a range is keyed it has to be whole, and a photo of the
  // customer receiving the seals goes with it.
  const [sealRows, setSealRows] = useState(() => [newSealRow()]);
  const [sealPhotoBase64, setSealPhotoBase64] = useState(null);
  const [sealPopup, setSealPopup] = useState(null); // allocated hits to show
  const sealPopped = useRef(new Set());
  const sealPhotoInputRef = useRef(null);
  const { checks: sealChecks, reset: resetSealChecks } = useSealChecks(sealRows, 'consent');

  // ── Admin: edit seal numbers after the fact, view the receipt photo ──
  // Same top-level admin flag DoSigning.jsx checks (shared_profiles
  // permissions.manage_users -- the same flag mjm-ai-system's own pages
  // check) reused here rather than inventing a separate one.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: profile } = await supabase
        .from('shared_profiles')
        .select('permissions')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!profile?.permissions?.manage_users);
    })();
    return () => { cancelled = true; };
  }, [session]);

  const [photoViewer, setPhotoViewer] = useState(null); // a seal_photo_url, or null

  // The consent row currently being corrected, or null. Seeded from its own
  // seal_ranges on open, so cancelling just drops this state and touches
  // nothing.
  const [editingConsent, setEditingConsent] = useState(null);
  const [editRows, setEditRows] = useState(() => [newSealRow()]);
  // Keys present when the editor opened -- a row still carrying one of
  // these is the consent's OWN existing allocation, not something to warn
  // about (see coveredByOriginal below, for the case where a row changed
  // but still overlaps what was already its own).
  const [editOriginalKeys, setEditOriginalKeys] = useState(() => new Set());
  const [editSaving, setEditSaving] = useState(false);
  // Checked only for rows that are NEW or CHANGED -- an unedited row would
  // otherwise come back "already belongs to" itself, since its own
  // allocation is still sitting in seal_allocations until the save lands.
  const editRowsToCheck = editRows.filter((r) => !editOriginalKeys.has(readSealRow(r).key));
  const { checks: editChecks, reset: resetEditChecks } = useSealChecks(editRowsToCheck, 'consent');

  function openEditSeals(c) {
    const rows = Array.isArray(c.seal_ranges) && c.seal_ranges.length
      ? c.seal_ranges.map((r) => ({ ...newSealRow(), start: r.start, end: r.end }))
      : [newSealRow()];
    setEditingConsent(c);
    setEditRows(rows);
    setEditOriginalKeys(new Set(rows.map((r) => readSealRow(r).key).filter(Boolean)));
    resetEditChecks();
  }
  function closeEditSeals() {
    setEditingConsent(null);
  }

  // A conflict hit that falls entirely inside one of the consent's OWN
  // original ranges is this consent's own allocation, not another one's --
  // seal_check_range has no consent_id to filter on, so this is read off
  // the numbers themselves.
  function coveredByOriginal(fromCode, toCode) {
    const f = sealNo(fromCode), t = sealNo(toCode);
    if (f == null || t == null || !editingConsent) return false;
    return (editingConsent.seal_ranges || []).some((r) => {
      const rs = sealNo(r.start), re = sealNo(r.end);
      return rs != null && re != null && f >= rs && t <= re;
    });
  }

  const editRead = editRows.map(readSealRow);
  const editRanges = sealRangesOf(editRows);
  const editTotal = editRanges.reduce((sum, r) => sum + rangeQty(r.start, r.end), 0);
  const editOverlaps = overlappingRows(editRows);
  const editIncomplete = editRead.some((rd) => rd.bad);
  const editConflicts = editRead
    .filter((rd) => rd.key && !editOriginalKeys.has(rd.key))
    .flatMap((rd) => {
      const c = editChecks[rd.key];
      return c && c.state === 'done'
        ? (c.rows || []).filter((x) => x.problem === 'allocated' && !coveredByOriginal(x.from_code, x.to_code))
        : [];
    });
  // A consent's seal tracking is optional (see the comment on sealRows
  // above) -- clearing every range is a valid "no seal data" state and is
  // not held to the qty rule below. Any ranges left on the form DO have to
  // sum to exactly what this consent was for: an edit corrects WHICH
  // seals, never how many.
  const editQtyMismatch = editRanges.length > 0 && editingConsent && editTotal !== (editingConsent.consent_qty || 0);
  const editReady = !!editingConsent && !editIncomplete && !editOverlaps.size && !editConflicts.length && !editQtyMismatch;

  async function saveEditSeals() {
    if (!editingConsent || !editReady || editSaving) return;
    if (!isOnline()) {
      showToast('📴 You need a connection to save a seal number correction');
      return;
    }
    setEditSaving(true);
    const consent = editingConsent;
    try {
      const { error } = await supabase
        .from('mobile_consent_records')
        .update({ seal_ranges: editRanges })
        .eq('id', consent.id);
      if (error) throw error;
      // The seal_sync_consent trigger re-derives seal_allocations from the
      // new seal_ranges the instant this UPDATE lands -- the FC Portal's
      // scan screen and the Seal Management page both read off that table
      // (or the consent row itself), so neither needs a separate push.
      showToast('✅ Seal numbers updated');
      setEditingConsent(null);
      await loadConsentHistory(consent.al_number);
    } catch (e) {
      showToast('❌ Could not update: ' + (e && e.message ? e.message : e));
    } finally {
      setEditSaving(false);
    }
  }

  // ── Barcode modal ──
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState('Scanning…');
  const barcodeStreamRef = useRef(null);
  const barcodeVideoRef = useRef(null);

  // The device's own camera app (capture="environment") rather than an
  // in-page live feed: it gives the real camera UI — zoom, flash, switch
  // lens — that a bare getUserMedia video never does.
  const photoInputRef = useRef(null);

  // ════════════════ LOAD DATA ════════════════
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

    const { data: consents } = await supabase.from('mobile_consent_records').select('al_number');
    const map = {};
    (consents || []).forEach((c) => {
      map[c.al_number] = (map[c.al_number] || 0) + 1;
    });
    setConsentCountMap(map);
    setLoading(false);
  }, []);

  // Completed ALs for the permanent "Completed" group at the bottom of the
  // list, windowed the same way History's own 92-day fix replaced a row
  // count (CLAUDE.md, "A row count is not a window") — except the right
  // date to window on here is NOT shared_al_orders.created_at (when the AL
  // was first raised). An AL can sit open for months of partial deliveries
  // before the LAST DO finally brings its balance to zero, so an AL raised
  // long ago can still have become "completed" only this week. The date
  // that actually means "recently completed" is the most recent delivery
  // against it, so this windows shared_do_records.delivery_date instead
  // and only keeps the ALs that delivery activity touched. A calibration
  // DO (CAL-…) is a stock correction, not a delivery, so it is excluded
  // the same way operation_stock_sales.js (mjm-ai-system) excludes it from
  // every other "collected" figure, and a cancelled DO is excluded too.
  // Anything outside this window is still reachable — see
  // queueLiveSearch/liveSearchFallback below, which query Supabase
  // directly rather than trusting whatever loaded on page-open.
  const COMPLETED_WINDOW_DAYS = 90;
  const loadCompletedALs = useCallback(async () => {
    setCompletedLoadError('');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - COMPLETED_WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const { data: doRows, error: doErr } = await supabase
      .from('shared_do_records')
      .select('al_number,delivery_date,status,do_number')
      .gte('delivery_date', cutoffStr);
    if (doErr) {
      setCompletedLoadError('Could not read delivery records (' + doErr.message + ').');
      setCompletedData([]);
      return;
    }

    const recentAlNumbers = [...new Set(
      (doRows || [])
        .filter((d) => d.status !== 'Cancelled' && !/^CAL-/i.test(String(d.do_number || '')))
        .map((d) => d.al_number)
        .filter(Boolean)
    )];
    if (!recentAlNumbers.length) {
      setCompletedData([]);
      return;
    }

    const { data, error } = await supabase
      .from('shared_al_orders')
      .select('*')
      .not('status', 'in', '("Cancelled","Collected")')
      .lte('balance_quantity', 0)
      .in('al_number', recentAlNumbers)
      .order('created_at', { ascending: false });
    if (error) {
      setCompletedLoadError('Could not read the matching orders (' + error.message + ').');
      setCompletedData([]);
      return;
    }
    setCompletedData(data || []);
  }, []);

  useEffect(() => {
    loadActiveALs();
    loadCompletedALs();
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [loadActiveALs, loadCompletedALs]);

  // Debounced live search — reaches a completed AL older than the window
  // above (or anything else alData/completedData did not happen to load)
  // by querying Supabase directly, filtered server-side, so it cannot be
  // truncated by a project row cap the way trusting an unbounded fetch can.
  useEffect(() => {
    clearTimeout(liveSearchTimerRef.current);
    const lower = query.trim();
    if (lower.length < 2) {
      setLiveMatches([]);
      return;
    }
    liveSearchTimerRef.current = setTimeout(async () => {
      const token = ++liveSearchTokenRef.current;
      const safe = lower.replace(/([%_])/g, '\\$1');
      const { data, error } = await supabase
        .from('shared_al_orders')
        .select('*')
        .not('status', 'in', '("Cancelled","Collected")')
        .or('al_number.ilike.%' + safe + '%,order_number.ilike.%' + safe + '%,customer_name.ilike.%' + safe + '%')
        .order('created_at', { ascending: false })
        .limit(50);
      if (token !== liveSearchTokenRef.current) return; // a newer search is already in flight
      if (error) { setLiveMatches([]); return; }
      const rows = data || [];
      setLiveMatches(rows);

      const alNumbers = rows.map((r) => r.al_number).filter(Boolean);
      if (alNumbers.length) {
        const { data: consents } = await supabase
          .from('mobile_consent_records')
          .select('al_number')
          .in('al_number', alNumbers);
        if (token !== liveSearchTokenRef.current) return;
        setConsentCountMap((prev) => {
          const next = { ...prev };
          alNumbers.forEach((n) => {
            next[n] = (consents || []).filter((c) => c.al_number === n).length;
          });
          return next;
        });
      }
    }, 300);
    return () => clearTimeout(liveSearchTimerRef.current);
  }, [query]);

  // ════════════════ GROUPED LIST ════════════════
  const groups = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const matched = [];
    const hasConsent = [];
    const noneYet = [];
    const completedGroup = [];

    const isMatchOf = (r) =>
      lower.length >= 1 &&
      ((r.al_number || '').toLowerCase().includes(lower) ||
        (r.order_number || '').toLowerCase().includes(lower) ||
        (r.customer_name || '').toLowerCase().includes(lower));

    alData.forEach((r) => {
      const count = consentCountMap[r.al_number] || 0;
      if (isMatchOf(r)) matched.push(r);
      else if (count > 0) hasConsent.push(r);
      else noneYet.push(r);
    });

    // completedData (loadCompletedALs, last COMPLETED_WINDOW_DAYS) is its
    // own permanent group at the very bottom — a search match still pulls
    // a row OUT of it and into Search Match instead, same rule alData's
    // own rows follow above.
    completedData.forEach((r) => {
      if (isMatchOf(r)) matched.push(r);
      else completedGroup.push(r);
    });

    // liveMatches is how a completed AL OLDER than the window above (or
    // anything else not in alData/completedData) reaches Search Match.
    // Deduped by id against what the two loops above already found.
    const matchedIds = new Set(matched.map((r) => r.id));
    liveMatches.forEach((r) => { if (!matchedIds.has(r.id)) matched.push(r); });

    // Search Match is never narrowed by the tab — a search is a question
    // about every record regardless of which one is open, so it always
    // shows everything it finds. The tab only decides which of the three
    // ordinary (unsearched) groups below it are worth drawing.
    const g = [];
    if (lower.length >= 1 && matched.length) g.push({ icon: 'search', label: 'Search Match', rows: matched, theme: 'amber' });
    if ((activeTab === 'all' || activeTab === 'consent') && hasConsent.length) g.push({ icon: 'checkCircle', label: 'Consent Issued', rows: hasConsent, theme: 'emerald' });
    if ((activeTab === 'all' || activeTab === 'pending') && noneYet.length) g.push({ icon: 'clipboard', label: 'Awaiting Consent', rows: noneYet, theme: 'blue' });
    if ((activeTab === 'all' || activeTab === 'completed') && completedGroup.length) g.push({ icon: 'check', label: 'Completed - Last ' + COMPLETED_WINDOW_DAYS + ' days', rows: completedGroup, theme: 'slate' });
    return g;
  }, [alData, completedData, liveMatches, consentCountMap, query, activeTab]);

  const themeMap = {
    amber: { header: 'bg-amber-50 text-amber-700 border-amber-200', row: 'bg-amber-50/60', bal: 'text-amber-700', border: 'border-l-4 border-amber-400' },
    emerald: { header: 'bg-emerald-50 text-emerald-700 border-emerald-200', row: 'bg-emerald-50/50', bal: 'text-emerald-700', border: 'border-l-4 border-emerald-500' },
    blue: { header: 'bg-blue-50 text-blue-700 border-blue-200', row: 'bg-blue-50/50', bal: 'text-blue-700', border: 'border-l-4 border-blue-400' },
    slate: { header: 'bg-slate-100 text-slate-600 border-slate-300', row: 'bg-slate-50/60', bal: 'text-slate-500', border: 'border-l-4 border-slate-300' },
  };

  function toggleGroup(theme) {
    setCollapsedGroups((prev) => ({ ...prev, [theme]: !prev[theme] }));
  }

  // ════════════════ BARCODE SCANNER ════════════════
  async function startBarcodeScan() {
    setBarcodeOpen(true);
    setBarcodeStatus('Starting camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      });
      barcodeStreamRef.current = stream;
      const video = barcodeVideoRef.current;
      if (video) video.srcObject = stream;

      if ('BarcodeDetector' in window) {
        // eslint-disable-next-line no-undef
        const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'] });
        setBarcodeStatus('Scanning…');
        const scanLoop = async () => {
          if (!barcodeStreamRef.current || !video) return;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
              handleBarcodeResult(barcodes[0].rawValue);
              return;
            }
          } catch (e) {
            /* keep scanning */
          }
          requestAnimationFrame(scanLoop);
        };
        if (video) video.onplaying = () => scanLoop();
      } else {
        setBarcodeStatus('BarcodeDetector not supported — type AL number manually');
      }
    } catch (e) {
      setBarcodeStatus('Camera error: ' + e.message);
    }
  }

  function handleBarcodeResult(val) {
    stopBarcodeScan();
    setQuery(val);
    showToast('✅ Barcode found: ' + val);
  }

  function stopBarcodeScan() {
    if (barcodeStreamRef.current) {
      barcodeStreamRef.current.getTracks().forEach((t) => t.stop());
      barcodeStreamRef.current = null;
    }
    if (barcodeVideoRef.current) barcodeVideoRef.current.srcObject = null;
    setBarcodeOpen(false);
  }

  // ════════════════ CONSENT DETAIL MODAL ════════════════
  async function openConsentModal(alNumber) {
    // A completed or live-search-only row never lives in alData (see
    // loadCompletedALs / the live search effect) — without checking those
    // too, opening one of those rows' "View Consent Log" button did
    // nothing, silently, because al came back undefined.
    const al =
      alData.find((r) => r.al_number === alNumber) ||
      completedData.find((r) => r.al_number === alNumber) ||
      liveMatches.find((r) => r.al_number === alNumber);
    if (!al) return;

    setCurrentAL(al);
    setSelectedQty(0);
    setCustomQty('');
    setFullActive(false);
    setHistory(null);
    setHistoryErr('');
    setDetailOpen(true);

    // Total previously consented for this AL
    let prevTotal = 0;
    const { data: prevConsents } = await supabase
      .from('mobile_consent_records')
      .select('consent_qty')
      .eq('al_number', alNumber);
    if (prevConsents) prevTotal = prevConsents.reduce((sum, c) => sum + (c.consent_qty || 0), 0);
    setTotalPreviouslyConsented(prevTotal);

    loadConsentHistory(alNumber);
  }

  function closeConsentModal() {
    setDetailOpen(false);
    setCurrentAL(null);
  }

  // ── Derived qty math ──
  // Consent allowance is gated by the AL's TOTAL ORDERED qty, not its
  // remaining balance. Each consent records customer agreement for part
  // of what they ordered; cumulative consents across collection events
  // can total the full ordered qty, regardless of how much has already
  // been delivered (DO'd).
  const ordered = currentAL?.quantity_ordered || 0;
  const remaining = Math.max(0, ordered - totalPreviouslyConsented);

  function getMaxConsentQty() {
    if (!currentAL) return 0;
    return Math.max(0, (currentAL.quantity_ordered || 0) - totalPreviouslyConsented);
  }

  function selectQty(qty) {
    const max = getMaxConsentQty();
    if (max <= 0) {
      showToast('⚠️ All ordered qty already consented');
      return;
    }
    if (qty > max) {
      showToast('⚠️ Cannot exceed remaining qty (' + max.toLocaleString() + ')');
      return;
    }
    setSelectedQty(qty);
    setCustomQty('');
    setFullActive(false);
  }

  function selectCustomQty(value) {
    setCustomQty(value);
    setFullActive(false);
    const val = parseInt(value);
    const max = getMaxConsentQty();
    if (val > max) {
      showToast('⚠️ Cannot exceed remaining qty (' + max.toLocaleString() + ')');
      setSelectedQty(0);
      return;
    }
    if (val > 0) setSelectedQty(val);
    else setSelectedQty(0);
  }

  function selectFull() {
    const max = getMaxConsentQty();
    if (max <= 0) {
      showToast('⚠️ All ordered qty already consented');
      return;
    }
    setSelectedQty(max);
    setCustomQty('');
    setFullActive(true);
  }

  const maxQtyHint = '(Max: ' + remaining.toLocaleString() + ' remaining of ' + ordered.toLocaleString() + ' ordered)';

  // ════════════════ CONSENT HISTORY ════════════════
  async function loadConsentHistory(alNumber) {
    setHistory(null);
    setHistoryErr('');
    setSealLogs({});
    const { data, error } = await supabase
      .from('mobile_consent_records')
      .select('*')
      .eq('al_number', alNumber)
      .order('created_at', { ascending: false });
    if (error) {
      setHistoryErr(error.message);
      setHistory([]);
      return;
    }
    setHistory(data || []);
    loadSealLogs((data || []).map((c) => c.id));
  }

  // The barcodes actually scanned against each consent in this AL's
  // history, from fcportal_scan_records — the same table the FC scan app
  // (Barcode_Counter) writes to and reads from (fetchScanRecords there is
  // the per-consent version of this same query). One request covering
  // every consent id in the history, grouped client-side by consent_id,
  // rather than one request per row.
  async function loadSealLogs(consentIds) {
    if (!consentIds.length) return;
    const { data, error } = await supabase
      .from('fcportal_scan_records')
      .select('consent_id, barcode, scanned_at')
      .in('consent_id', consentIds);
    if (error) return; // seal log is supplementary — a failure here shouldn't block the history itself
    const byConsent = {};
    (data || []).forEach((r) => {
      (byConsent[r.consent_id] = byConsent[r.consent_id] || []).push(r);
    });
    setSealLogs(byConsent);
  }

  // ════════════════ PROCEED TO SIGN ════════════════
  function proceedToSign() {
    if (selectedQty <= 0) return;

    if (!currentAL) return;
    const titleText = (currentAL.al_number || '') + ' — ' + (currentAL.customer_name || '');

    setSignTitle(titleText);
    setSignQty(selectedQty);

    // Reset sign modal state
    setAgreed(false);
    setHasSig(false);
    setPhotoBase64(null);
    setAiStickerCount(null);
    setAiScanning(false);
    setAiResultShown(false);
    setAiCountLabel('0');
    setAiNotice('');
    setSubmitting(false);
    setSealRows([newSealRow()]);
    setSealPhotoBase64(null);
    setSealPopup(null);
    sealPopped.current = new Set();
    resetSealChecks();

    setSignOpen(true);
  }

  function closeSignModal() {
    setSignOpen(false);
  }

  // ════════════════ PHOTO + AI STICKER COUNT ════════════════
  // Takes a captured data URL (always from the live camera below, never a
  // picked file) through compression and the AI sticker count, same
  // pipeline regardless of device.
  async function processCapturedPhoto(rawBase64) {
    const base64 = await compressImage(rawBase64);
    setPhotoBase64(base64);

    /* No line: the AI count cannot run (the Gemini edge function is a
       server call), and that is by design — the photo is kept, the count
       is entered by hand, and the whole record queues like any other. */
    if (!isOnline()) {
      setAiScanning(false);
      setAiResultShown(true);
      setAiCountLabel('—');
      setAiNotice('No line — AI sticker count needs signal. Enter the count by hand.');
      return;
    }

    setAiResultShown(false);
    setAiScanning(true);
    setAiNotice('');
    try {
      const result = await callGeminiScan(base64, 'image/jpeg', STICKER_PROMPT);
      const count = result.sticker_count || 0;
      setAiStickerCount(count);
      setAiCountLabel(count.toLocaleString());
      setAiScanning(false);
      setAiResultShown(true);
      if (result.confidence !== 'high') {
        setAiNotice('AI count may not be exact — please verify manually.');
      } else {
        setAiNotice('');
      }
    } catch (err) {
      setAiScanning(false);
      setAiResultShown(true);
      setAiCountLabel('Error');
      setAiNotice('AI scan failed: ' + err.message);
    }
  }

  function openPhotoPicker() {
    if (photoInputRef.current) photoInputRef.current.click();
  }

  function onPhotoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { processCapturedPhoto(ev.target.result); };
    reader.readAsDataURL(file);
  }

  function retakePhoto() {
    setPhotoBase64(null);
    setAiStickerCount(null);
    setAiScanning(false);
    setAiResultShown(false);
    setAiNotice('');
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
      photoInputRef.current.click();
    }
  }

  // ════════════════ SEALS ISSUED ════════════════
  const sealRead = sealRows.map(readSealRow);
  const sealRanges = sealRangesOf(sealRows);
  const sealTotal = sealRanges.reduce((sum, r) => sum + rangeQty(r.start, r.end), 0);
  const sealOverlaps = overlappingRows(sealRows);
  const sealHits = (rd, kind) => {
    const c = sealChecks[rd.key];
    return c && c.state === 'done' ? (c.rows || []).filter((x) => x.problem === kind) : [];
  };
  // Seals that already belong to another consent block the save for as long
  // as the range is on the form. A range the server says never arrived at
  // UNN 1 only warns — receipts can be keyed late, and the trigger raises a
  // case if it is still wrong when the row lands.
  const sealAllocated = sealRead.filter((rd) => rd.key).flatMap((rd) => sealHits(rd, 'allocated'));
  const sealIncomplete = sealRead.some((rd) => rd.bad);
  const sealOk = !sealIncomplete && !sealOverlaps.size && !sealAllocated.length
    && (!sealRanges.length || !!sealPhotoBase64);

  // The popup, once per range, the moment the server names another owner.
  useEffect(() => {
    if (!signOpen) return;
    const fresh = [];
    sealRead.forEach((rd) => {
      if (!rd.key || sealPopped.current.has(rd.key)) return;
      const hits = sealHits(rd, 'allocated');
      if (!hits.length) return;
      sealPopped.current.add(rd.key);
      fresh.push(...hits);
    });
    if (fresh.length) setSealPopup(fresh);
  }, [sealChecks, signOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function onSealPhotoFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => setSealPhotoBase64(await compressImage(ev.target.result));
    reader.readAsDataURL(file);
  }

  // ════════════════ SUBMIT CONSENT ════════════════
  const consentReady = agreed && hasSig && !!photoBase64 && selectedQty > 0 && sealOk;

  async function submitConsent() {
    if (selectedQty <= 0) return;
    if (!currentAL) return;
    if (!photoBase64) {
      showToast('📷 Please take a photo of the seals/stickers first');
      return;
    }
    if (!sealOk) {
      showToast('🔖 Fix the seal ranges first');
      return;
    }

    setSubmitting(true);

    const sigDataUrl = sigRef.current?.toDataURL() || '';

    const alNumber = currentAL.al_number;
    const orderNumber = currentAL.order_number || '';
    const customerName = currentAL.customer_name || '';

    /* The whole save as one JOB — row plus photo — through sendConsent
       (mobileQueue.js), which uploads the photo and inserts. With no line,
       or a save that never reached the server, the job queues on the phone
       and flushes when the line returns; the photo is uploaded to storage
       at flush time, so an offline consent still ends up with a real URL. */
    const job = {
      payload: {
        al_number: alNumber,
        order_number: orderNumber,
        customer_name: customerName,
        consent_qty: selectedQty,
        signature_data: sigDataUrl,
        photo_url: null,
        ai_sticker_count: aiStickerCount,
      },
      photoBase64: photoBase64 || null,
      sealPhotoBase64: null,
    };
    // Only written when seals were issued. Left off entirely otherwise, so
    // the no-seal consent is the exact row it always was.
    if (sealRanges.length) {
      job.payload.seal_ranges = sealRanges;
      job.sealPhotoBase64 = sealPhotoBase64;
    }

    let queuedOffline = false;
    try {
      await sendConsent(job);
    } catch (e) {
      if (!looksOffline(e)) {
        showToast('❌ Error: ' + e.message);
        setSubmitting(false);
        return;
      }
      await queueJob(CONSENT_JOB, job);
      queuedOffline = true;
    }

    showToast(queuedOffline
      ? '📴 Saved to phone — sends by itself when the line returns'
      : '✅ Consent saved! ' + selectedQty.toLocaleString() + ' seedlings for ' + customerName);
    setSubmitting(false);

    closeSignModal();

    const al = currentAL;
    // Update local count map
    setConsentCountMap((prev) => ({ ...prev, [al.al_number]: (prev[al.al_number] || 0) + 1 }));
    const newPrevTotal = totalPreviouslyConsented + selectedQty;
    setTotalPreviouslyConsented(newPrevTotal);

    await loadConsentHistory(al.al_number);

    setSelectedQty(0);
    setCustomQty('');
    setFullActive(false);
  }

  const s = CONSENT_STRINGS[consentLang];

  // ════════════════ RENDER ════════════════
  return (
    <>
      <style>{SCOPED_CSS}</style>
      <TopNav title="Customer Consent" userName={userName} />

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-5" style={{ background: '#f1f5f9', minHeight: 'calc(100vh - 65px)' }}>
        <div className="dash-card p-5 sm:p-6">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Icon name="search" className="w-3.5 h-3.5" /> Search Order Number / Customer Name</div>
          <div className="flex gap-3 mb-5">
            <input
              type="text"
              className="search-input flex-1"
              placeholder="AL No., Order No. or Customer Name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="scan-barcode-btn" onClick={startBarcodeScan} title="Scan barcode to find AL">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              Scan
            </button>
            <button className="shrink-0 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
              Search
            </button>
          </div>

          {/* Which of the three ordinary groups to browse -- a search box
              above is not scoped to this, see the comment on `groups`. */}
          <div className="tab-row mb-5">
            <button className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All</button>
            <button className={`tab-btn ${activeTab === 'consent' ? 'active' : ''}`} onClick={() => setActiveTab('consent')}>Consented</button>
            <button className={`tab-btn ${activeTab === 'pending' ? 'active' : ''}`} onClick={() => setActiveTab('pending')}>Pending</button>
            <button className={`tab-btn ${activeTab === 'completed' ? 'active' : ''}`} onClick={() => setActiveTab('completed')}>Completed</button>
          </div>

          {/* Shown whenever loadCompletedALs() could not finish — an empty
              Completed group and a FAILED one otherwise look identical. */}
          {completedLoadError && (
            <div className="mb-4 p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-700 text-xs font-bold flex items-start gap-1.5">
              <Icon name="warning" className="w-4 h-4 shrink-0 mt-px" /> <span>Completed list: {completedLoadError}</span>
            </div>
          )}

          <div>
            {loading ? (
              <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-widest">Loading…</div>
            ) : loadErr ? (
              <div className="text-center py-8 text-red-400 text-xs font-bold">{loadErr}</div>
            ) : !groups.length ? (
              <div className="text-center py-12">
                <Icon name="inboxEmpty" className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <div className="text-[11px] font-black text-slate-300 uppercase tracking-widest">No active approval letters found</div>
              </div>
            ) : isMobile ? (
              groups.map((g) => {
                const t = themeMap[g.theme];
                const collapsed = !!collapsedGroups[g.theme];
                return (
                  <div className="mb-5" key={g.theme}>
                    <div
                      className={`text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border mb-3 cursor-pointer select-none ${t.header}`}
                      onClick={() => toggleGroup(g.theme)}
                    >
                      <Icon name={g.icon} className="w-3 h-3 inline-block align-[-2px]" /> {g.label} ({g.rows.length} Records) {collapsed ? '▸' : '▾'}
                    </div>
                    {!collapsed && (
                      <div>
                        {g.rows.map((r) => {
                          const count = consentCountMap[r.al_number] || 0;
                          const isCompleted = (Number(r.balance_quantity) || 0) <= 0;
                          return (
                            <div key={r.id} className={`bg-white rounded-2xl p-4 mb-2 shadow-sm border border-slate-200 ${t.border}`}>
                              <div className="flex justify-between items-start mb-2">
                                <div>
                                  <div className="font-black text-slate-800">{r.al_number || '—'}</div>
                                  <div className="text-xs font-bold text-slate-500 mt-0.5">{r.customer_name || '—'}</div>
                                </div>
                                {count > 0 ? (
                                  <span className="badge-signed">{count} Signed</span>
                                ) : (
                                  <span className="badge-pending">No Consent</span>
                                )}
                              </div>
                              <div className="text-xs font-bold text-slate-400 mb-3">
                                <Icon name="clipboard" className="w-3 h-3 inline-block align-[-1px]" /> {r.order_number || '—'} · Qty: {r.quantity_ordered != null ? r.quantity_ordered.toLocaleString() : '—'} · Bal: <span className={`${t.bal} font-black`}>{r.balance_quantity != null ? r.balance_quantity.toLocaleString() : '—'}</span>
                                {isCompleted && <span className="text-emerald-600"> (Completed)</span>}
                              </div>
                              <button className="btn-consent w-full text-center" onClick={() => openConsentModal(r.al_number)}>
                                {isCompleted ? (<><Icon name="document" className="w-3.5 h-3.5 inline-block align-[-3px]" /> View Consent Log</>) : (<><Icon name="pen" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Sign Consent</>)}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>AL No.</th><th>Order #</th><th>Customer</th><th>Qty Ordered</th><th>Balance</th><th>Consents</th><th>Action</th>
                    </tr>
                  </thead>
                  {groups.map((g) => {
                    const t = themeMap[g.theme];
                    const collapsed = !!collapsedGroups[g.theme];
                    return (
                      <Fragment key={g.theme}>
                        <tbody>
                          <tr>
                            <td colSpan={7} className={`py-2 px-4 text-[9px] font-black uppercase tracking-widest cursor-pointer select-none ${t.header} border-b`} onClick={() => toggleGroup(g.theme)}>
                              <Icon name={g.icon} className="w-3 h-3 inline-block align-[-2px]" /> {g.label} ({g.rows.length} Records) {collapsed ? '▸' : '▾'}
                            </td>
                          </tr>
                        </tbody>
                        {!collapsed && (
                          <tbody>
                            {g.rows.map((r) => {
                              const count = consentCountMap[r.al_number] || 0;
                              const isCompleted = (Number(r.balance_quantity) || 0) <= 0;
                              return (
                                <tr key={r.id} className={t.row}>
                                  <td><span className="font-black text-slate-800">{r.al_number || '—'}</span></td>
                                  <td>{r.order_number || '—'}</td>
                                  <td>{r.customer_name || '—'}</td>
                                  <td>{r.quantity_ordered != null ? r.quantity_ordered.toLocaleString() : '—'}</td>
                                  <td>
                                    <span className={`font-black ${t.bal}`}>{r.balance_quantity != null ? r.balance_quantity.toLocaleString() : '—'}</span>
                                    {isCompleted && <span className="text-[9px] font-black text-emerald-600 uppercase tracking-wider"> Completed</span>}
                                  </td>
                                  <td>{count > 0 ? <span className="badge-signed">{count} signed</span> : <span className="badge-pending">None</span>}</td>
                                  <td>
                                    <button className="btn-consent" onClick={() => openConsentModal(r.al_number)}>
                                      {isCompleted ? (<><Icon name="document" className="w-3.5 h-3.5 inline-block align-[-3px]" /> View Consent Log</>) : (<><Icon name="pen" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Sign Consent</>)}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        )}
                      </Fragment>
                    );
                  })}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ CONSENT DETAIL MODAL ══ */}
      <div className={`modal-overlay ${detailOpen ? 'open' : ''}`} onClick={closeConsentModal}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#064e3b,#065f46)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="pen" className="w-3.5 h-3.5" /> Customer Consent</div>
              <div className="text-base font-black text-white uppercase tracking-wide">
                {currentAL?.al_number || '—'}
              </div>
              <div className="text-base font-bold text-emerald-300 mt-1">
                {currentAL?.customer_name || '—'}
              </div>
            </div>
            <button onClick={closeConsentModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* Order details */}
            <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Order Details</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(() => {
                    // Comma-joined ("Oil Palm Seedling - Feb 2026, ...March 2026")
                    // read as one run-on line; one product per row instead,
                    // shrinking the text only once there are enough of them
                    // that the box would otherwise keep growing.
                    const products = (currentAL?.product_name || '')
                      .split(',').map((p) => p.trim()).filter(Boolean);
                    const productTextClass =
                      products.length > 7 ? 'text-[10px]' : products.length > 4 ? 'text-xs' : 'text-sm';
                    return (
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Purchased Product</div>
                        <div className={`font-black text-slate-800 ${productTextClass} leading-snug`}>
                          {products.length ? products.map((p, i) => <div key={i}>{p}</div>) : '—'}
                        </div>
                      </div>
                    );
                  })()}
                  {[
                    ['Qty Ordered', currentAL?.quantity_ordered != null ? currentAL.quantity_ordered.toLocaleString() : '—'],
                    ['Balance to Collect', currentAL?.balance_quantity != null ? currentAL.balance_quantity.toLocaleString() : '—', true],
                  ].map(([label, value, big]) => (
                    <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                      <div className={`font-black ${big ? 'text-blue-700 text-base' : 'text-slate-800 text-sm'} leading-snug`}>{value}</div>
                    </div>
                  ))}
                </div>
            </div>

            {/* Sign consent for qty */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Icon name="pen" className="w-3.5 h-3.5" /> Sign Consent For</div>
              <p className="text-xs font-bold text-slate-400 mb-4">
                Select the quantity of seedlings for this collection trip. <span className="text-red-500 font-black">{maxQtyHint}</span>
              </p>
              <div className="flex flex-wrap gap-3 mb-4">
                {QTY_PRESETS.map((p) => (
                  <button key={p.qty} className={`qty-btn ${!customQty && !fullActive && selectedQty === p.qty ? 'active' : ''}`} onClick={() => selectQty(p.qty)}>{p.label}</button>
                ))}
                <button className={`qty-btn ${fullActive ? 'active' : ''}`} onClick={selectFull} title="Set to full remaining balance">Full</button>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="Key in qty"
                    className="search-input text-sm"
                    style={{ padding: '10px 14px', width: '140px' }}
                    value={customQty}
                    max={remaining}
                    onChange={(e) => selectCustomQty(e.target.value)}
                  />
                </div>
              </div>
              {selectedQty > 0 && (
                <div className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  Consent Qty: <span>{selectedQty.toLocaleString()}</span> seedlings
                  <button onClick={proceedToSign} className="ml-4 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
                    Proceed to Sign <Icon name="chevronRight" className="w-3.5 h-3.5 inline-block align-[-3px]" />
                  </button>
                </div>
              )}
            </div>

            {/* Consent history */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Icon name="clipboard" className="w-3.5 h-3.5" /> Consent History</div>
              <ConsentHistory
                history={history}
                err={historyErr}
                sealLogs={sealLogs}
                isAdmin={isAdmin}
                onEditSeals={openEditSeals}
                onViewPhoto={setPhotoViewer}
              />
            </div>
          </div>

          <div className="px-5 sm:px-6 pb-6 flex justify-end border-t border-slate-100 pt-5">
            <button onClick={closeConsentModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Close</button>
          </div>
        </div>
      </div>

      {/* ══ SIGN CONSENT MODAL ══ */}
      <div className={`modal-overlay ${signOpen ? 'open' : ''}`} style={{ zIndex: 250 }} onClick={closeSignModal}>
        <div className="modal-box" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="pen" className="w-3.5 h-3.5" /> Sign Collection Consent</div>
              <div className="text-lg font-black text-white">{signTitle}</div>
              <div className="text-[11px] font-bold text-slate-400 mt-1">Qty: <span className="text-emerald-400">{signQty.toLocaleString()}</span> seedlings</div>
            </div>
            <button onClick={closeSignModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* T&C */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Icon name="clipboard" className="w-3.5 h-3.5" /> <span>{s.tcHeader}</span></div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setConsentLang('en')} className={`cs-lang-btn ${consentLang === 'en' ? 'active' : ''}`}>EN</button>
                  <button type="button" onClick={() => setConsentLang('ms')} className={`cs-lang-btn ${consentLang === 'ms' ? 'active' : ''}`}>BM</button>
                </div>
              </div>
              <div className="consent-body">
                <h4>{s.heading}</h4>
                {s.terms.map((term, i) => (
                  <p key={i} dangerouslySetInnerHTML={{ __html: term }} />
                ))}
              </div>
            </div>

            {/* Checkbox agree */}
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="w-5 h-5 shrink-0 mt-0.5 accent-emerald-600 cursor-pointer" />
              <span className="text-sm font-bold text-slate-600 leading-snug">{s.agree}</span>
            </label>

            {/* Photo section — stacked above Signature, not side by side */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Icon name="camera" className="w-3.5 h-3.5" /> <span>{s.photoTitle}</span> <span className="text-red-500">*</span></div>

              <div className={`photo-area ${photoBase64 ? 'has-photo' : ''}`} onClick={openPhotoPicker}>
                {!photoBase64 ? (
                  <div>
                    <Icon name="camera" className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                    <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{s.tapTitle}</div>
                    <div className="text-[10px] font-bold text-slate-300 mt-0.5">{s.tapSub}</div>
                  </div>
                ) : (
                  <div>
                    <img src={photoBase64} className="w-full rounded-xl" style={{ maxHeight: '260px', objectFit: 'contain' }} alt="Sticker preview" />
                  </div>
                )}
              </div>

              {photoBase64 && (
                <div className="flex gap-2 mt-3">
                  <button className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors" onClick={(e) => { e.stopPropagation(); retakePhoto(); }}>
                    <Icon name="camera" className="w-3 h-3 inline-block align-[-2px]" /> Retake
                  </button>
                </div>
              )}

              {/* AI Scan result */}
              {(aiScanning || aiResultShown) && (
                <div className="mt-4">
                  {aiScanning && (
                    <div className="text-center py-5">
                      <Icon name="sparkles" className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">AI is counting stickers…</div>
                      <div className="text-[10px] font-bold text-slate-300 mt-1">Analyzing photo with Google AI</div>
                    </div>
                  )}
                  {aiResultShown && (
                    <div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1 flex items-center gap-1"><Icon name="sparkles" className="w-3 h-3" /> AI Sticker Count</div>
                          <div className="text-2xl font-black text-emerald-700">{aiCountLabel}</div>
                        </div>
                        <Icon name="sparkles" className="w-10 h-10 text-emerald-300" />
                      </div>
                      {aiNotice && (
                        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mt-2 flex items-start gap-1.5"><Icon name="warning" className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{aiNotice}</span></div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Seals issued — keyed with the Bluetooth gun */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="tag" className="w-3.5 h-3.5" /> Seals Issued</div>
              <p className="text-[10px] font-bold text-slate-300 mb-3">Optional. Scan the first seal, then the last, for each roll handed to the customer.</p>
              {signOpen && (
                <SealRangeInput
                  rows={sealRows}
                  onChange={setSealRows}
                  disabled={submitting}
                  notes={(rd) => {
                    const c = sealChecks[rd.key];
                    if (!c) return null;
                    if (c.state === 'checking') return <div className="text-[10px] font-bold text-slate-400 mt-1 pl-7">Checking…</div>;
                    const owned = sealHits(rd, 'allocated');
                    const missing = sealHits(rd, 'not_received');
                    if (!owned.length && !missing.length) return null;
                    return (
                      <div className="mt-1.5 pl-7 space-y-1">
                        {owned.map((h, i) => (
                          <div key={'a' + i} className="text-[10px] font-black text-red-600">
                            {h.from_code === h.to_code ? h.from_code : h.from_code + '–' + h.to_code} already belongs to {h.customer_name || '—'} ({h.al_number || '—'})
                          </div>
                        ))}
                        {missing.map((h, i) => (
                          <div key={'n' + i} className="text-[10px] font-bold text-amber-700 flex items-start gap-1"><Icon name="warning" className="w-3 h-3 shrink-0 mt-px" /> <span>{h.detail}</span></div>
                        ))}
                      </div>
                    );
                  }}
                />
              )}
              {sealTotal > 0 && sealTotal !== selectedQty && (
                <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mt-3">
                  <Icon name="warning" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Seal qty {sealTotal.toLocaleString()} ≠ consent qty {selectedQty.toLocaleString()}
                </div>
              )}

              {sealRanges.length > 0 && (
                <div className="mt-4">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5"><Icon name="camera" className="w-3.5 h-3.5" /> Customer Received Seals <span className="text-red-500">*</span></div>
                  <div className={`photo-area ${sealPhotoBase64 ? 'has-photo' : ''}`} onClick={() => sealPhotoInputRef.current && sealPhotoInputRef.current.click()}>
                    {!sealPhotoBase64 ? (
                      <div>
                        <Icon name="camera" className="w-6 h-6 mx-auto mb-1 text-slate-400" />
                        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Photo of the customer with the seals</div>
                      </div>
                    ) : (
                      <img src={sealPhotoBase64} className="w-full rounded-xl" style={{ maxHeight: '220px', objectFit: 'contain' }} alt="Customer received seals" />
                    )}
                  </div>
                  {sealPhotoBase64 && (
                    <div className="flex gap-2 mt-3">
                      <button className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors" onClick={() => sealPhotoInputRef.current && sealPhotoInputRef.current.click()}>
                        <Icon name="camera" className="w-3 h-3 inline-block align-[-2px]" /> Retake
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Signature */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="pen" className="w-3.5 h-3.5" /> <span>{s.signTitle}</span></div>
              <p className="text-[10px] font-bold text-slate-300 mb-3">{s.signHelp}</p>
              {signOpen && (
                <SignaturePad ref={sigRef} height={150} hint="Sign here" onSignedAt={() => setHasSig(true)} />
              )}
              <div className="flex justify-end mt-2">
                <button onClick={() => { sigRef.current?.clear(); setHasSig(false); }} className="text-[11px] font-bold text-slate-500 hover:text-red-500 cursor-pointer border-none bg-transparent">× Clear</button>
              </div>
            </div>
          </div>

          <div className="px-5 sm:px-6 pb-6 flex flex-col sm:flex-row gap-3 justify-end border-t border-slate-100 pt-5">
            <button onClick={closeSignModal} className="w-full sm:w-auto h-11 px-8 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 rounded-full border border-slate-200 cursor-pointer transition-colors">{s.cancel}</button>
            <button onClick={submitConsent} disabled={!consentReady || submitting} className="group w-full sm:w-auto h-11 flex items-stretch overflow-hidden disabled:opacity-40 disabled:cursor-not-allowed rounded-full border-none cursor-pointer">
              <span className="flex items-center justify-center w-11 bg-emerald-800 text-white shrink-0 transition-colors group-hover:bg-emerald-900"><Icon name="download" className="w-4 h-4" /></span>
              <span className="flex items-center justify-center px-8 grow sm:grow-0 bg-emerald-600 text-white font-black text-[11px] uppercase tracking-widest transition-colors group-hover:bg-emerald-700">{submitting ? 'Saving…' : s.save}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ══ SEAL ALREADY ISSUED ══ — above the sign modal, and it stays
          until somebody presses OK: the range stays on the form and the
          save stays blocked until it is fixed or removed. */}
      <div className={`modal-overlay ${sealPopup ? 'open' : ''}`} style={{ zIndex: 270 }} onClick={() => setSealPopup(null)}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <Icon name="blocked" className="w-9 h-9 mx-auto mb-2 text-red-500" />
          <div className="font-black text-red-700 text-base uppercase tracking-wide mb-3 text-center">Seal already issued</div>
          <div className="space-y-2 mb-4">
            {(sealPopup || []).map((h, i) => (
              <div key={i} className="text-sm font-bold text-slate-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 leading-snug">
                Seal {h.from_code === h.to_code ? h.from_code : h.from_code + '–' + h.to_code} already belongs to{' '}
                <span className="font-black">{h.customer_name || '—'}</span> ({h.al_number || '—'}). You are issuing to{' '}
                <span className="font-black">{currentAL?.customer_name || '—'}</span> ({currentAL?.al_number || '—'}).
              </div>
            ))}
          </div>
          <div className="text-[11px] font-bold text-slate-500 mb-4 text-center">Fix or remove that range to save.</div>
          <div className="text-center">
            <button onClick={() => setSealPopup(null)} className="text-[11px] font-black text-white uppercase tracking-widest bg-red-600 hover:bg-red-700 px-8 py-3 rounded-full border-none cursor-pointer">OK</button>
          </div>
        </div>
      </div>

      {/* ══ BARCODE SCANNER MODAL ══ */}
      <div className={`modal-overlay ${barcodeOpen ? 'open' : ''}`} style={{ zIndex: 260 }} onClick={stopBarcodeScan}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
          <Icon name="search" className="w-9 h-9 mx-auto mb-2 text-slate-400" />
          <div className="font-black text-slate-800 text-lg uppercase tracking-wide mb-1">Scan Barcode</div>
          <div className="text-xs font-bold text-slate-400 mb-4">Point your camera at the AL barcode</div>
          <div className="rounded-2xl overflow-hidden bg-black mb-4" style={{ height: '260px', position: 'relative' }}>
            <video ref={barcodeVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, border: '3px solid rgba(16,185,129,.5)', borderRadius: '16px', pointerEvents: 'none', animation: 'consent-pulse-glow 2s infinite' }} />
          </div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{barcodeStatus}</div>
          <button onClick={stopBarcodeScan} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Cancel</button>
        </div>
      </div>

      {/* ══ SEAL RECEIPT PHOTO VIEWER ══ */}
      <div className={`modal-overlay ${photoViewer ? 'open' : ''}`} style={{ zIndex: 280 }} onClick={() => setPhotoViewer(null)}>
        <div className="bg-white rounded-3xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center flex items-center justify-center gap-1.5"><Icon name="camera" className="w-3.5 h-3.5" /> Seal Receipt Photo</div>
          {photoViewer && <img src={photoViewer} style={{ width: '100%', borderRadius: '14px', border: '1px solid #e2e8f0' }} alt="Customer received seals" />}
          <div className="flex gap-2 mt-4">
            <a
              href={photoViewer || '#'}
              download
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-emerald-700 uppercase tracking-widest bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl py-3 px-6"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </a>
            <button
              onClick={() => setPhotoViewer(null)}
              className="flex-1 flex items-center justify-center gap-1.5 text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-xl border border-slate-200 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              Close
            </button>
          </div>
        </div>
      </div>

      {/* ══ EDIT SEAL NUMBERS (ADMIN) ══ — corrects which seals this
          consent's seal_ranges names, never how many: the qty rule below
          holds the total to what the customer actually consented for.
          Saving writes straight to mobile_consent_records.seal_ranges,
          which the seal_sync_consent trigger already re-derives
          seal_allocations from on every UPDATE -- the FC Portal's scan
          screen and the Seal Management page both read off that, so an
          amendment here reaches both without a separate push. */}
      <div className={`modal-overlay ${editingConsent ? 'open' : ''}`} style={{ zIndex: 255 }} onClick={closeEditSeals}>
        <div className="modal-box" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Icon name="pen" className="w-3.5 h-3.5" /> Edit Seal Numbers</div>
              <div className="text-lg font-black text-white">{editingConsent ? (editingConsent.al_number + ' — ' + (editingConsent.customer_name || '')) : '—'}</div>
              <div className="text-[11px] font-bold text-slate-400 mt-1">
                Consent qty: <span className="text-blue-400">{(editingConsent?.consent_qty || 0).toLocaleString()}</span> seedlings
              </div>
            </div>
            <button onClick={closeEditSeals} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            <p className="text-[10px] font-bold text-slate-400">
              Correcting a seal number that was scanned or keyed wrong. Clearing every row removes seal
              tracking from this consent; any ranges left on the form must sum to the consent qty above.
            </p>

            {editingConsent && (
              <SealRangeInput
                rows={editRows}
                onChange={setEditRows}
                disabled={editSaving}
                notes={(rd) => {
                  const c = editChecks[rd.key];
                  if (!c) return null;
                  if (c.state === 'checking') return <div className="text-[10px] font-bold text-slate-400 mt-1 pl-7">Checking…</div>;
                  const hits = (c.rows || []).filter((x) => x.problem === 'allocated' && !coveredByOriginal(x.from_code, x.to_code));
                  if (!hits.length) return null;
                  return (
                    <div className="mt-1.5 pl-7 space-y-1">
                      {hits.map((h, i) => (
                        <div key={i} className="text-[10px] font-black text-red-600">
                          {h.from_code === h.to_code ? h.from_code : h.from_code + '–' + h.to_code} already belongs to {h.customer_name || '—'} ({h.al_number || '—'})
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
            )}

            {editQtyMismatch && (
              <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                <Icon name="warning" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Seal qty {editTotal.toLocaleString()} must equal the consent qty {(editingConsent?.consent_qty || 0).toLocaleString()}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={closeEditSeals}
                disabled={editSaving}
                className="flex-1 text-[11px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3.5 rounded-xl border border-slate-200 cursor-pointer transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEditSeals}
                disabled={!editReady || editSaving}
                className="flex-1 text-[11px] font-black text-white uppercase tracking-widest bg-blue-600 hover:bg-blue-700 px-6 py-3.5 rounded-xl border-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Opens the device's own camera app — zoom, flash, lens switch all
          come from there rather than being rebuilt in-page. */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoFile} />
      <input ref={sealPhotoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onSealPhotoFile} />

      <ToastHost />
    </>
  );
}

// ── Consent history table ──
function ConsentHistory({ history, err, sealLogs = {}, isAdmin = false, onEditSeals, onViewPhoto }) {
  const [expanded, setExpanded] = useState(() => new Set());
  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (history === null) {
    return <div className="text-center py-4 text-slate-300 text-xs font-bold uppercase tracking-widest">Loading…</div>;
  }
  if (err) {
    return <div className="text-xs text-red-400 font-bold">{err}</div>;
  }
  if (!history.length) {
    return (
      <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
        <Icon name="clipboard" className="w-7 h-7 mx-auto mb-2 text-slate-300" />
        <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">No consent records yet</div>
        <div className="text-[10px] font-bold text-slate-300 mt-1">Select a quantity above to sign the first consent.</div>
      </div>
    );
  }

  const totalConsented = history.reduce((sum, c) => sum + (c.consent_qty || 0), 0);

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-slate-400">Total: {history.length} consent(s)</span>
        <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">Total Consented: {totalConsented.toLocaleString()}</span>
      </div>
      <div className="rounded-2xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="history-table">
          <thead>
            <tr>
              <th>#</th><th>Date &amp; Time</th><th>Qty</th><th>AI Count</th><th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {history.map((c, i) => {
              const dt = c.created_at
                ? new Date(c.created_at).toLocaleString('en-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '—';
              // Ascending by the seal's own code value — same convention
              // the FC scan app's own Scan Log uses (see ScanModule.jsx).
              const seals = (sealLogs[c.id] || [])
                .slice()
                .sort((a, b) => String(a.barcode).localeCompare(String(b.barcode), undefined, { numeric: true, sensitivity: 'base' }));
              const isOpen = expanded.has(c.id);
              return (
                <Fragment key={c.id || i}>
                  <tr>
                    <td className="text-slate-400">{i + 1}</td>
                    <td>{dt}</td>
                    <td><span className="font-black text-emerald-700">{(c.consent_qty || 0).toLocaleString()}</span></td>
                    <td>{c.ai_sticker_count != null ? <span className="text-blue-700 font-black">{c.ai_sticker_count.toLocaleString()}</span> : '—'}</td>
                    <td>{c.signature_data ? <img src={c.signature_data} style={{ height: '32px', borderRadius: '6px', border: '1px solid #e2e8f0' }} alt="sig" /> : '—'}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} style={{ padding: 0, background: '#f8fafc' }}>
                      {Array.isArray(c.seal_ranges) && c.seal_ranges.length > 0 ? (
                        <div className="px-4 pt-2 flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                              <Icon name="tag" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Seals Issued — {c.seal_ranges.reduce((sum, r) => sum + rangeQty(r.start, r.end), 0).toLocaleString()}
                            </div>
                            <div className="text-[11px] font-mono font-bold text-slate-600 break-words">{formatSealRanges(c.seal_ranges)}</div>
                          </div>
                          {/* Edit sits beside View -- both are icon-only,
                              same size, so the two actions on this row read
                              as one group. */}
                          <div className="shrink-0 flex items-center gap-2">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => onEditSeals(c)}
                                title="Edit seal numbers"
                                className="w-9 h-9 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 flex items-center justify-center text-blue-600"
                                style={{ cursor: 'pointer' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                            )}
                            {c.seal_photo_url && (
                              <button
                                type="button"
                                onClick={() => onViewPhoto(c.seal_photo_url)}
                                title="View seal receipt photo"
                                className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500"
                                style={{ cursor: 'pointer' }}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        isAdmin && (c.consent_qty || 0) > 0 && (
                          <div className="px-4 pt-2">
                            <button
                              type="button"
                              onClick={() => onEditSeals(c)}
                              className="text-[10px] font-black text-slate-500 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-full border border-slate-200 uppercase tracking-widest"
                              style={{ cursor: 'pointer' }}
                            >
                              + Seal Number
                            </button>
                          </div>
                        )
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(c.id)}
                        className="w-full text-left px-4 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        <Icon name="tag" className="w-3.5 h-3.5 inline-block align-[-3px]" /> Seal Log — {seals.length} entr{seals.length === 1 ? 'y' : 'ies'} {isOpen ? '▲' : '▼'}
                      </button>
                      {isOpen && (
                        seals.length ? (
                          <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                            {seals.map((s, si) => (
                              <span key={si} className="text-[10px] font-mono font-bold text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1">
                                {s.barcode}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="px-4 pb-3 text-[10px] font-bold text-slate-300">No seals scanned for this entry.</div>
                        )
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

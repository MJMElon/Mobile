import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callGeminiScan, compressImage } from '../lib/gemini';
import AuthGate from '../components/AuthGate';
import TopNav from '../components/TopNav';
import SignaturePad from '../components/SignaturePad';
import { useToast } from '../components/Toast';

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
    photoTitle: 'Attach Photo — Sticker Verification',
    photoHelp: 'Take a photo of the seedling stickers. AI will count the sticker quantity automatically.',
    tapTitle: 'Tap to Take Photo',
    tapSub: 'Camera will open to capture sticker image',
    signTitle: 'Customer Signature',
    signHelp: 'Customer signs below to consent to the collection terms for this trip.',
    cancel: 'Cancel',
    save: 'Save Consent',
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
    photoTitle: 'Lampirkan Foto — Pengesahan Pelekat',
    photoHelp: 'Ambil foto pelekat anak benih. AI akan mengira jumlah pelekat secara automatik.',
    tapTitle: 'Ketik untuk Ambil Foto',
    tapSub: 'Kamera akan dibuka untuk menangkap imej pelekat',
    signTitle: 'Tandatangan Pelanggan',
    signHelp: 'Pelanggan menandatangani di bawah untuk bersetuju dengan terma pengambilan bagi perjalanan ini.',
    cancel: 'Batal',
    save: 'Simpan Persetujuan',
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
.consent-body { background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:12px; padding:1.1rem; font-size:13px; color:#374151; line-height:1.75; max-height:200px; overflow-y:auto; }
.cs-lang-btn { font-size:10px; font-weight:900; letter-spacing:.06em; padding:3px 10px; border-radius:9999px; border:1.5px solid #e2e8f0; background:#fff; color:#94a3b8; cursor:pointer; transition:all .15s; }
.cs-lang-btn.active { background:#059669; border-color:#059669; color:#fff; }
.consent-body h4 { font-size:11px; font-weight:900; color:#111827; margin:0 0 .5rem; text-transform:uppercase; letter-spacing:.04em; }
.consent-body p { margin-bottom:.6rem; }
.consent-body p:last-child { margin-bottom:0; }
.history-table { width:100%; border-collapse:collapse; font-size:12px; }
.history-table th { background:#f8fafc; padding:8px 12px; text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.08em; font-weight:900; color:#64748b; border-bottom:2px solid #e2e8f0; }
.history-table td { padding:8px 12px; border-bottom:1px solid #f1f5f9; font-weight:600; vertical-align:middle; }
.photo-area { border:2px dashed #cbd5e1; border-radius:16px; background:#f8fafc; text-align:center; padding:2rem; cursor:pointer; transition:all .2s; }
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
  const [consentCountMap, setConsentCountMap] = useState({});
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
  const [collapsedGroups, setCollapsedGroups] = useState(() => ({ emerald: true }));

  // ── Consent detail modal ──
  const [detailOpen, setDetailOpen] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);
  const [currentAL, setCurrentAL] = useState(null);
  const [totalPreviouslyConsented, setTotalPreviouslyConsented] = useState(0);
  const [selectedQty, setSelectedQty] = useState(0);
  const [customQty, setCustomQty] = useState('');
  const [fullActive, setFullActive] = useState(false);
  const [history, setHistory] = useState(null); // null=loading, []=empty, [...]=rows
  const [historyErr, setHistoryErr] = useState('');

  // ── Manual fields ──
  const [manualName, setManualName] = useState('');
  const [manualAL, setManualAL] = useState('');
  const [manualOrder, setManualOrder] = useState('');
  const [manualNotes, setManualNotes] = useState('');

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
  const photoInputRef = useRef(null);

  // ── Barcode modal ──
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState('Scanning…');
  const barcodeStreamRef = useRef(null);
  const barcodeVideoRef = useRef(null);

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

  useEffect(() => {
    loadActiveALs();
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [loadActiveALs]);

  // ════════════════ GROUPED LIST ════════════════
  const groups = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const matched = [];
    const hasConsent = [];
    const noneYet = [];

    alData.forEach((r) => {
      const isMatch =
        lower.length >= 1 &&
        ((r.al_number || '').toLowerCase().includes(lower) ||
          (r.order_number || '').toLowerCase().includes(lower) ||
          (r.customer_name || '').toLowerCase().includes(lower));
      const count = consentCountMap[r.al_number] || 0;
      if (isMatch) matched.push(r);
      else if (count > 0) hasConsent.push(r);
      else noneYet.push(r);
    });

    const g = [];
    if (lower.length >= 1) {
      if (matched.length) g.push({ label: '🔍 Search Match', rows: matched, theme: 'amber' });
      if (hasConsent.length) g.push({ label: '✅ Has Consent Records', rows: hasConsent, theme: 'emerald' });
      if (noneYet.length) g.push({ label: '📋 Active AL — No Consent Yet', rows: noneYet, theme: 'blue' });
    } else {
      if (hasConsent.length) g.push({ label: '✅ Has Consent Records', rows: hasConsent, theme: 'emerald' });
      if (noneYet.length) g.push({ label: '📋 Active AL — No Consent Yet', rows: noneYet, theme: 'blue' });
    }
    return g;
  }, [alData, consentCountMap, query]);

  const themeMap = {
    amber: { header: 'bg-amber-50 text-amber-700 border-amber-200', row: 'bg-amber-50/60', bal: 'text-amber-700', border: 'border-l-4 border-amber-400' },
    emerald: { header: 'bg-emerald-50 text-emerald-700 border-emerald-200', row: 'bg-emerald-50/50', bal: 'text-emerald-700', border: 'border-l-4 border-emerald-500' },
    blue: { header: 'bg-blue-50 text-blue-700 border-blue-200', row: 'bg-blue-50/50', bal: 'text-blue-700', border: 'border-l-4 border-blue-400' },
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
    const al = alData.find((r) => r.al_number === alNumber);
    if (!al) return;

    setIsManualMode(false);
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

  function openManualConsent() {
    setIsManualMode(true);
    setCurrentAL(null);
    setManualName('');
    setManualAL('');
    setManualOrder('');
    setManualNotes('');
    setTotalPreviouslyConsented(0);
    setSelectedQty(0);
    setCustomQty('');
    setFullActive(false);
    setHistory([]); // manual: no prior history
    setHistoryErr('');
    setDetailOpen(true);
  }

  function closeConsentModal() {
    setDetailOpen(false);
    setCurrentAL(null);
    setIsManualMode(false);
  }

  // ── Derived qty math ──
  // Consent allowance is gated by the AL's TOTAL ORDERED qty, not its
  // remaining balance. Each consent records customer agreement for part
  // of what they ordered; cumulative consents across collection events
  // can total the full ordered qty, regardless of how much has already
  // been delivered (DO'd).
  const ordered = currentAL?.quantity_ordered || 0;
  const remaining = isManualMode ? Infinity : Math.max(0, ordered - totalPreviouslyConsented);

  function getMaxConsentQty() {
    if (isManualMode) return Infinity;
    if (!currentAL) return 0;
    return Math.max(0, (currentAL.quantity_ordered || 0) - totalPreviouslyConsented);
  }

  function selectQty(qty) {
    const max = getMaxConsentQty();
    if (!isManualMode && max <= 0) {
      showToast('⚠️ All ordered qty already consented');
      return;
    }
    if (!isManualMode && qty > max) {
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
    if (!isManualMode && val > max) {
      showToast('⚠️ Cannot exceed remaining qty (' + max.toLocaleString() + ')');
      setSelectedQty(0);
      return;
    }
    if (val > 0) setSelectedQty(val);
    else setSelectedQty(0);
  }

  function selectFull() {
    if (isManualMode) {
      showToast('⚠️ Manual mode — please key in qty');
      return;
    }
    const max = getMaxConsentQty();
    if (max <= 0) {
      showToast('⚠️ All ordered qty already consented');
      return;
    }
    setSelectedQty(max);
    setCustomQty('');
    setFullActive(true);
  }

  const maxQtyHint = isManualMode
    ? '(Manual entry — enter any quantity)'
    : '(Max: ' + remaining.toLocaleString() + ' remaining of ' + ordered.toLocaleString() + ' ordered)';

  // ════════════════ CONSENT HISTORY ════════════════
  async function loadConsentHistory(alNumber) {
    setHistory(null);
    setHistoryErr('');
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
  }

  // ════════════════ PROCEED TO SIGN ════════════════
  function proceedToSign() {
    if (selectedQty <= 0) return;

    let titleText;
    if (isManualMode) {
      const name = manualName.trim();
      if (!name) {
        showToast('⚠️ Please enter customer name');
        return;
      }
      titleText = (manualAL.trim() ? manualAL.trim() + ' — ' : '') + name + ' (Manual)';
    } else {
      if (!currentAL) return;
      titleText = (currentAL.al_number || '') + ' — ' + (currentAL.customer_name || '');
    }

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

    setSignOpen(true);
  }

  function closeSignModal() {
    setSignOpen(false);
  }

  // ════════════════ PHOTO + AI STICKER COUNT ════════════════
  function openPhotoPicker() {
    if (photoInputRef.current) photoInputRef.current.click();
  }

  async function onPhotoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      let base64 = ev.target.result;
      base64 = await compressImage(base64);
      setPhotoBase64(base64);

      // Run AI scan
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
          setAiNotice('⚠️ AI count may not be exact — please verify manually.');
        } else {
          setAiNotice('');
        }
      } catch (err) {
        setAiScanning(false);
        setAiResultShown(true);
        setAiCountLabel('Error');
        setAiNotice('⚠️ AI scan failed: ' + err.message);
      }
    };
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

  // ════════════════ SUBMIT CONSENT ════════════════
  const consentReady = agreed && hasSig && selectedQty > 0;

  async function submitConsent() {
    if (selectedQty <= 0) return;
    if (!isManualMode && !currentAL) return;

    setSubmitting(true);

    const sigDataUrl = sigRef.current?.toDataURL() || '';

    // Build identifying fields based on mode
    let alNumber, orderNumber, customerName;
    if (isManualMode) {
      customerName = manualName.trim();
      if (!customerName) {
        showToast('⚠️ Customer name is required');
        setSubmitting(false);
        return;
      }
      const al = manualAL.trim();
      alNumber = al || 'MANUAL-' + Date.now();
      orderNumber = manualOrder.trim();
    } else {
      alNumber = currentAL.al_number;
      orderNumber = currentAL.order_number || '';
      customerName = currentAL.customer_name || '';
    }

    // Upload photo to Supabase storage if available
    let photoUrl = null;
    if (photoBase64) {
      try {
        const blob = await fetch(photoBase64).then((r) => r.blob());
        const filePath = `consent_photos/${alNumber}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
          photoUrl = urlData?.publicUrl || null;
        }
      } catch (e) {
        photoUrl = photoBase64;
      }
    }

    const payload = {
      al_number: alNumber,
      order_number: orderNumber,
      customer_name: customerName,
      consent_qty: selectedQty,
      signature_data: sigDataUrl,
      photo_url: photoUrl,
      ai_sticker_count: aiStickerCount,
    };

    const { error } = await supabase.from('mobile_consent_records').insert([payload]);

    if (error) {
      showToast('❌ Error: ' + error.message);
      setSubmitting(false);
      return;
    }

    showToast('✅ Consent saved! ' + selectedQty.toLocaleString() + ' seedlings for ' + customerName);
    setSubmitting(false);

    closeSignModal();

    if (isManualMode) {
      closeConsentModal();
      // Refresh main list count map
      loadActiveALs();
    } else {
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
  }

  const s = CONSENT_STRINGS[consentLang];

  // ════════════════ RENDER ════════════════
  return (
    <>
      <style>{SCOPED_CSS}</style>
      <TopNav title="Customer Consent" userName={userName} />

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-5" style={{ background: '#f1f5f9', minHeight: 'calc(100vh - 65px)' }}>
        <div className="dash-card p-5 sm:p-6">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">🔍 Search Order Number / Customer Name</div>
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

          {/* Manual Consent */}
          <div className="flex justify-end mb-4">
            <button
              onClick={openManualConsent}
              className="text-[11px] font-black text-amber-700 uppercase tracking-widest bg-amber-50 hover:bg-amber-100 px-5 py-2.5 rounded-xl border border-amber-200 cursor-pointer transition-colors"
            >
              + Manual Consent (No AL in System)
            </button>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-5">
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700"><span className="w-3 h-3 rounded bg-amber-400 inline-block"></span>Search Match</span>
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span>Has Consent Records</span>
            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-blue-700"><span className="w-3 h-3 rounded bg-blue-400 inline-block"></span>Active AL — No Consent Yet</span>
          </div>

          <div>
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
                const collapsed = !!collapsedGroups[g.theme];
                return (
                  <div className="mb-5" key={g.theme}>
                    <div
                      className={`text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border mb-3 cursor-pointer select-none ${t.header}`}
                      onClick={() => toggleGroup(g.theme)}
                    >
                      {g.label} ({g.rows.length}) {collapsed ? '▸' : '▾'}
                    </div>
                    {!collapsed && (
                      <div>
                        {g.rows.map((r) => {
                          const count = consentCountMap[r.al_number] || 0;
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
                                📋 {r.order_number || '—'} · Qty: {r.quantity_ordered ?? '—'} · Bal: <span className={`${t.bal} font-black`}>{r.balance_quantity ?? '—'}</span>
                              </div>
                              <button className="btn-consent w-full text-center" onClick={() => openConsentModal(r.al_number)}>✍️ Sign Consent</button>
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
                              {g.label} ({g.rows.length}) {collapsed ? '▸' : '▾'}
                            </td>
                          </tr>
                        </tbody>
                        {!collapsed && (
                          <tbody>
                            {g.rows.map((r) => {
                              const count = consentCountMap[r.al_number] || 0;
                              return (
                                <tr key={r.id} className={t.row}>
                                  <td><span className="font-black text-slate-800">{r.al_number || '—'}</span></td>
                                  <td>{r.order_number || '—'}</td>
                                  <td>{r.customer_name || '—'}</td>
                                  <td>{r.quantity_ordered ?? '—'}</td>
                                  <td><span className={`font-black ${t.bal}`}>{r.balance_quantity ?? '—'}</span></td>
                                  <td>{count > 0 ? <span className="badge-signed">{count} signed</span> : <span className="badge-pending">None</span>}</td>
                                  <td><button className="btn-consent" onClick={() => openConsentModal(r.al_number)}>✍️ Sign Consent</button></td>
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

      {/* Hidden camera input for sticker photo */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhotoFile} />

      {/* ══ CONSENT DETAIL MODAL ══ */}
      <div className={`modal-overlay ${detailOpen ? 'open' : ''}`} onClick={closeConsentModal}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#064e3b,#065f46)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mb-1">✍️ Customer Consent</div>
              <div className="text-xl font-black text-white uppercase tracking-wide">
                {isManualMode ? 'Manual Consent' : currentAL?.al_number || '—'}
              </div>
              <div className="text-[11px] font-bold text-emerald-300 mt-1">
                {isManualMode ? (manualName.trim() || 'Enter customer details below') : currentAL?.customer_name || '—'}
              </div>
            </div>
            <button onClick={closeConsentModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* Manual entry fields */}
            {isManualMode && (
              <div>
                <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-3">⚠️ Manual Entry — AL Not Found in System</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Customer Name <span className="text-red-500">*</span></label>
                    <input type="text" className="search-input text-sm w-full" style={{ padding: '10px 14px' }} placeholder="Enter customer name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">AL Number (optional)</label>
                    <input type="text" className="search-input text-sm w-full" style={{ padding: '10px 14px' }} placeholder="e.g. AL-2026-XXXX" value={manualAL} onChange={(e) => setManualAL(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Order Number (optional)</label>
                    <input type="text" className="search-input text-sm w-full" style={{ padding: '10px 14px' }} placeholder="e.g. ORD-XXXX" value={manualOrder} onChange={(e) => setManualOrder(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Notes (optional)</label>
                    <input type="text" className="search-input text-sm w-full" style={{ padding: '10px 14px' }} placeholder="Any additional info" value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {/* Order details (hidden in manual mode) */}
            {!isManualMode && (
              <div>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Order Details</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    ['AL Number', currentAL?.al_number || '—'],
                    ['Order Number', currentAL?.order_number || '—'],
                    ['Customer Name', currentAL?.customer_name || '—'],
                    ['Purchased Product', currentAL?.product_name || '—'],
                    ['Qty Ordered', currentAL?.quantity_ordered ?? '—'],
                    ['Balance to Collect', currentAL?.balance_quantity ?? '—', true],
                  ].map(([label, value, big]) => (
                    <div key={label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</div>
                      <div className={`font-black ${big ? 'text-blue-700 text-base' : 'text-slate-800 text-sm'} leading-snug`}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sign consent for qty */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">✍️ Sign Consent For</div>
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
                    max={isManualMode ? undefined : remaining}
                    onChange={(e) => selectCustomQty(e.target.value)}
                  />
                </div>
              </div>
              {selectedQty > 0 && (
                <div className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  Consent Qty: <span>{selectedQty.toLocaleString()}</span> seedlings
                  <button onClick={proceedToSign} className="ml-4 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
                    Proceed to Sign →
                  </button>
                </div>
              )}
            </div>

            {/* Consent history */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">📋 Consent History</div>
              <ConsentHistory history={history} err={historyErr} isManualMode={isManualMode} />
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
              <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">✍️ Sign Collection Consent</div>
              <div className="text-lg font-black text-white">{signTitle}</div>
              <div className="text-[11px] font-bold text-slate-400 mt-1">Qty: <span className="text-emerald-400">{signQty.toLocaleString()}</span> seedlings</div>
            </div>
            <button onClick={closeSignModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* T&C */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">📋 <span>{s.tcHeader}</span></div>
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

            {/* Photo section */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">📷 <span>{s.photoTitle}</span></div>
              <p className="text-[10px] font-bold text-slate-300 mb-3">{s.photoHelp}</p>

              <div className={`photo-area ${photoBase64 ? 'has-photo' : ''}`} onClick={openPhotoPicker}>
                {!photoBase64 ? (
                  <div>
                    <div className="text-4xl mb-2">📷</div>
                    <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{s.tapTitle}</div>
                    <div className="text-[10px] font-bold text-slate-300 mt-1">{s.tapSub}</div>
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
                    📷 Retake
                  </button>
                </div>
              )}

              {/* AI Scan result */}
              {(aiScanning || aiResultShown) && (
                <div className="mt-4">
                  {aiScanning && (
                    <div className="text-center py-5">
                      <div className="text-3xl mb-2">🤖</div>
                      <div className="text-[11px] font-black text-slate-500 uppercase tracking-widest">AI is counting stickers…</div>
                      <div className="text-[10px] font-bold text-slate-300 mt-1">Analyzing photo with Google AI</div>
                    </div>
                  )}
                  {aiResultShown && (
                    <div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">✨ AI Sticker Count</div>
                          <div className="text-2xl font-black text-emerald-700">{aiCountLabel}</div>
                        </div>
                        <div className="text-4xl">🤖</div>
                      </div>
                      {aiNotice && (
                        <div className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 mt-2">{aiNotice}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Signature */}
            <div className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">✍️ <span>{s.signTitle}</span></div>
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
            <button onClick={closeSignModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">{s.cancel}</button>
            <button onClick={submitConsent} disabled={!consentReady || submitting} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
              💾 <span>{submitting ? 'Saving…' : s.save}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ══ BARCODE SCANNER MODAL ══ */}
      <div className={`modal-overlay ${barcodeOpen ? 'open' : ''}`} style={{ zIndex: 260 }} onClick={stopBarcodeScan}>
        <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
          <div className="text-3xl mb-2">🔍</div>
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

      <ToastHost />
    </>
  );
}

// ── Consent history table ──
function ConsentHistory({ history, err, isManualMode }) {
  if (history === null) {
    return <div className="text-center py-4 text-slate-300 text-xs font-bold uppercase tracking-widest">Loading…</div>;
  }
  if (err) {
    return <div className="text-xs text-red-400 font-bold">{err}</div>;
  }
  if (!history.length) {
    if (isManualMode) {
      return (
        <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
          <div className="text-2xl mb-2">✍️</div>
          <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Manual consent — no prior history</div>
        </div>
      );
    }
    return (
      <div className="text-center py-6 bg-slate-50 rounded-xl border border-slate-100">
        <div className="text-2xl mb-2">📋</div>
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
              return (
                <tr key={c.id || i}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td>{dt}</td>
                  <td><span className="font-black text-emerald-700">{(c.consent_qty || 0).toLocaleString()}</span></td>
                  <td>{c.ai_sticker_count != null ? <span className="text-blue-700 font-black">{c.ai_sticker_count.toLocaleString()}</span> : '—'}</td>
                  <td>{c.signature_data ? <img src={c.signature_data} style={{ height: '32px', borderRadius: '6px', border: '1px solid #e2e8f0' }} alt="sig" /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

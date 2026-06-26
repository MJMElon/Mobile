import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import AuthGate from '../components/AuthGate';
import TopNav from '../components/TopNav';
import { useToast } from '../components/Toast';

export default function BookingPage() {
  return <AuthGate>{({ session, userName }) => <Booking session={session} userName={userName} />}</AuthGate>;
}

// ════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════
const MY_HOLIDAYS = {
  '2026-01-01': "New Year's Day",
  '2026-01-14': 'Nuzul Al-Quran',
  '2026-01-29': 'Thaipusam',
  '2026-02-01': 'Federal Territory Day',
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year (2nd Day)',
  '2026-03-28': 'Hari Raya Aidilfitri',
  '2026-03-29': 'Hari Raya Aidilfitri (2nd Day)',
  '2026-05-01': 'Labour Day',
  '2026-05-11': 'Vesak Day',
  '2026-06-01': 'Agong Birthday',
  '2026-06-04': 'Hari Raya Haji',
  '2026-06-05': 'Hari Raya Haji (2nd Day)',
  '2026-06-25': 'Awal Muharram',
  '2026-08-31': 'Merdeka Day',
  '2026-09-03': 'Maulidur Rasul',
  '2026-09-16': 'Malaysia Day',
  '2026-10-20': 'Deepavali',
  '2026-12-25': 'Christmas Day',
  '2025-01-01': "New Year's Day",
  '2025-01-27': 'Thaipusam',
  '2025-01-29': 'Chinese New Year',
  '2025-01-30': 'Chinese New Year (2nd Day)',
  '2025-02-01': 'Federal Territory Day',
  '2025-03-13': 'Nuzul Al-Quran',
  '2025-03-30': 'Hari Raya Aidilfitri',
  '2025-03-31': 'Hari Raya Aidilfitri (2nd Day)',
  '2025-05-01': 'Labour Day',
  '2025-05-12': 'Vesak Day',
  '2025-06-02': 'Agong Birthday',
  '2025-06-06': 'Hari Raya Haji',
  '2025-06-07': 'Hari Raya Haji (2nd Day)',
  '2025-06-27': 'Awal Muharram',
  '2025-08-31': 'Merdeka Day',
  '2025-09-05': 'Maulidur Rasul',
  '2025-09-16': 'Malaysia Day',
  '2025-10-20': 'Deepavali',
  '2025-12-25': 'Christmas Day',
};
function getHoliday(dateStr) {
  return MY_HOLIDAYS[dateStr] || null;
}

const HOURS_WEEKDAY = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const HOURS_SAT = [8, 9, 10, 11];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const RATE = 350; // seedlings processed per hour per booking

// ── Date helpers ──
function getMonday(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function formatHour(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return h + ' AM';
  if (h === 12) return '12 PM';
  return h - 12 + ' PM';
}
function timeSlotLabel(h) {
  return formatHour(h) + ' - ' + formatHour(h + 1);
}
function isToday(d) {
  const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
function isPast(d) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const check = new Date(d);
  check.setHours(0, 0, 0, 0);
  return check < today;
}
function hoursNeeded(qty) {
  return Math.ceil(qty / RATE);
}

const W_CODES = { 0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Fog', 51: 'Lt Drizzle', 53: 'Drizzle', 55: 'Hvy Drizzle', 61: 'Lt Rain', 63: 'Rain', 65: 'Hvy Rain', 80: 'Lt Showers', 81: 'Showers', 82: 'Hvy Showers', 95: 'T-Storm', 96: 'T-Storm+Hail', 99: 'Hvy T-Storm' };
const W_ICONS = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌧️', 55: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 95: '⚡', 96: '⚡', 99: '⚡' };

// ════════════════════════════════════════════════════════
//  PAGE-SPECIFIC STYLES (carried over from legacy booking.html)
// ════════════════════════════════════════════════════════
const PAGE_CSS = `
.qty-btn { padding:10px 18px; border-radius:14px; border:2px solid #e2e8f0; background:white; font-weight:900; font-size:14px; cursor:pointer; transition:all .2s; font-family:'Outfit',sans-serif; color:#334155; }
.qty-btn:hover { border-color:#10b981; background:#ecfdf5; color:#065f46; }
.qty-btn.active { border-color:#10b981; background:#10b981; color:white; box-shadow:0 4px 12px rgba(16,185,129,.3); }
.alloc-board { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
@media(max-width:640px){ .alloc-board { grid-template-columns:1fr 1fr; } }
.alloc-col { background:#f8fafc; border:2px solid #e2e8f0; border-radius:16px; min-height:200px; padding:8px; transition:border-color .2s,background .2s; }
.alloc-col.drag-over { border-color:#10b981; background:#ecfdf5; }
.alloc-col-header { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; padding:8px 10px; border-radius:10px; margin-bottom:8px; text-align:center; }
.alloc-col.pending .alloc-col-header { background:#fef3c7; color:#92400e; }
.alloc-col.nursery .alloc-col-header { background:#dbeafe; color:#1e40af; }
.alloc-card { background:white; border:1.5px solid #e2e8f0; border-radius:12px; padding:10px; margin-bottom:6px; cursor:grab; transition:all .15s; box-shadow:0 2px 6px rgba(0,0,0,.04); }
.alloc-card:hover { border-color:#10b981; box-shadow:0 4px 12px rgba(0,0,0,.08); }
.alloc-card.dragging { opacity:.4; transform:scale(.95); }
.alloc-card.status-pending { border-left:4px solid #f59e0b; }
.alloc-card.status-booked { border-left:4px solid #10b981; }
.alloc-card .card-name { font-size:12px; font-weight:900; color:#1e293b; }
.alloc-card .card-detail { font-size:10px; font-weight:600; color:#64748b; margin-top:2px; }
.alloc-card .card-qty { font-size:11px; font-weight:900; color:#065f46; }
.alloc-count { font-size:9px; font-weight:700; color:#94a3b8; margin-left:4px; }
.month-grid { display:grid; grid-template-columns:repeat(7,1fr); border:1px solid #e2e8f0; border-radius:16px; overflow:hidden; background:white; }
.month-header { background:#f8fafc; padding:8px; text-align:center; font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; color:#64748b; border-bottom:2px solid #e2e8f0; border-right:1px solid #e2e8f0; min-width:0; }
.month-header:last-child { border-right:none; }
.month-cell { min-height:80px; border-bottom:1px solid #f1f5f9; border-right:1px solid #f1f5f9; padding:4px 6px; cursor:pointer; transition:background .15s; position:relative; min-width:0; overflow:hidden; }
.month-cell:nth-child(7n) { border-right:none; }
.month-cell:hover { background:#f0fdf4; }
.month-cell.other-month { background:#fafafa; opacity:.4; }
.month-cell.today { background:#ecfdf5; }
.month-cell.past { opacity:.5; }
.month-cell.closed { background:#f8f8f8; cursor:default; }
.month-cell.closed:hover { background:#f8f8f8; }
.month-day-num { font-size:11px; font-weight:900; color:#334155; margin-bottom:2px; }
.month-cell.today .month-day-num { color:white; background:#10b981; display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:11px; }
.month-cell.holiday { background:#fef2f2; }
.month-holiday-tag { display:block; font-size:8px; font-weight:700; color:#dc2626; line-height:1.2; margin-top:1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.booking-pill { display:block; padding:4px 7px; border-radius:8px; font-size:10px; font-weight:700; margin-bottom:2px; cursor:pointer; transition:all .15s; line-height:1.3; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.booking-pill.booked { background:#d1fae5; color:#065f46; border:1px solid #a7f3d0; }
.booking-pill.booked:hover { background:#10b981; color:white; }
.booking-pill.completed { background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe; }
.booking-pill.cancelled { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; text-decoration:line-through; opacity:.6; }
.booking-pill.pending { background:#fef3c7; color:#92400e; border:1px solid #fde68a; animation:pulse-pending 2s infinite; }
@keyframes pulse-pending { 0%,100%{ box-shadow:none; } 50%{ box-shadow:0 0 8px rgba(251,191,36,.4); } }
.day-count { display:inline-flex; align-items:center; justify-content:center; background:#10b981; color:white; font-size:9px; font-weight:900; min-width:18px; height:18px; border-radius:9px; padding:0 5px; margin-left:4px; }
.al-dropdown { position:absolute; left:0; right:0; top:100%; background:white; border:2px solid #e2e8f0; border-top:none; border-radius:0 0 14px 14px; max-height:200px; overflow-y:auto; z-index:10; box-shadow:0 8px 24px rgba(0,0,0,.1); }
.al-dropdown-item { padding:10px 14px; cursor:pointer; font-size:13px; font-weight:600; transition:background .1s; }
.al-dropdown-item:hover { background:#ecfdf5; }
.al-dropdown-item .al-num { font-weight:900; color:#065f46; }
.al-dropdown-item .al-cust { color:#64748b; font-size:12px; }
.weather-strip { display:flex; gap:6px; overflow-x:auto; padding:2px 0; scrollbar-width:none; }
.weather-strip::-webkit-scrollbar { display:none; }
.weather-day { flex:1 1 0; min-width:74px; background:white; border:1.5px solid #e2e8f0; border-radius:12px; padding:8px 6px; text-align:center; transition:all .2s; }
.weather-day.today { border-color:#10b981; background:#ecfdf5; }
.weather-day-name { font-size:9px; font-weight:900; text-transform:uppercase; letter-spacing:.05em; color:#94a3b8; }
.weather-day.today .weather-day-name { color:#065f46; }
.weather-day-icon { font-size:1.4rem; margin:3px 0 1px; line-height:1; }
.weather-day-temp { font-size:11px; font-weight:900; color:#1e293b; }
.weather-day-rain { font-size:9px; font-weight:700; color:#3b82f6; margin-top:1px; }
.weather-day-rain.high { color:#ef4444; }
.weather-day-desc { font-size:8px; font-weight:700; color:#94a3b8; margin-top:1px; line-height:1.2; }
@media(max-width:480px){
  .month-header{font-size:8px;padding:6px 2px;letter-spacing:0;}
  .month-cell{min-height:56px;padding:3px 3px;}
  .month-day-num{font-size:10px;}
  .month-cell.today .month-day-num{width:20px;height:20px;border-radius:10px;font-size:10px;}
  .month-holiday-tag{font-size:7px;}
  .booking-pill{font-size:8px !important;padding:1px 4px !important;}
}
`;

// in-memory weather cache (mirrors legacy _wCache)
const _wCache = {};

function Booking({ session, userName }) {
  const { ToastHost, showToast } = useToast();

  // ── Calendar period state ──
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());

  // ── Data ──
  const [alData, setAlData] = useState([]);
  const [plotsData, setPlotsData] = useState([]);
  const [monthBookings, setMonthBookings] = useState([]);
  const [loadError, setLoadError] = useState('');

  // ── Weather ──
  const [weather, setWeather] = useState(null); // null until loaded; false if hidden

  // ── New booking modal ──
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bkDate, setBkDate] = useState('');
  const [bkTime, setBkTime] = useState('');
  const [bkTimeOptions, setBkTimeOptions] = useState([]); // [{value,label}]
  const [bkAlQuery, setBkAlQuery] = useState('');
  const [bkAlDropdownOpen, setBkAlDropdownOpen] = useState(false);
  const [selectedAL, setSelectedAL] = useState(null);
  const [bookingQty, setBookingQty] = useState(0);
  const [bkQtyInput, setBkQtyInput] = useState('');
  const [bkNursery, setBkNursery] = useState('');
  const [bkPlot, setBkPlot] = useState('');
  const [bkNotes, setBkNotes] = useState('');
  const [bkSaving, setBkSaving] = useState(false);
  const bkSearchWrapRef = useRef(null);

  // ── Detail / edit modal ──
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [detDate, setDetDate] = useState('');
  const [detTime, setDetTime] = useState('');
  const [detTimeOptions, setDetTimeOptions] = useState([]);
  const [detQty, setDetQty] = useState('');
  const [detNursery, setDetNursery] = useState('');
  const [detPlot, setDetPlot] = useState('');
  const [detNotes, setDetNotes] = useState('');
  const [detSaving, setDetSaving] = useState(false);
  const [detConfirming, setDetConfirming] = useState(false);
  // pending confirm
  const [detAlQuery, setDetAlQuery] = useState('');
  const [detAlDropdownOpen, setDetAlDropdownOpen] = useState(false);
  const [matchedALForConfirm, setMatchedALForConfirm] = useState(null);
  const detSearchWrapRef = useRef(null);

  // ── Day allocation modal ──
  const [dayOpen, setDayOpen] = useState(false);
  const [dayModalDate, setDayModalDate] = useState(null);
  const [dayBookings, setDayBookings] = useState(null); // null = loading
  const dragBookingId = useRef(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  // ════════════════════════════════════════════════════════
  //  DATA LOADING
  // ════════════════════════════════════════════════════════
  const loadALData = useCallback(async () => {
    try {
      const results = await Promise.all([
        supabase
          .from('shared_al_orders')
          .select('*')
          .not('status', 'in', '("Cancelled","Collected")')
          .gt('balance_quantity', 0)
          .order('customer_name', { ascending: true }),
        supabase.from('shared_plots').select('plot_name, nursery_name'),
      ]);
      setAlData((results[0] && results[0].data) || []);
      setPlotsData((results[1] && results[1].data) || []);
    } catch (e) {
      console.error('loadALData error:', e);
      setAlData([]);
      setPlotsData([]);
    }
  }, []);

  const loadMonthBookings = useCallback(
    async (year = currentYear, month = currentMonth) => {
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      const { data, error } = await supabase
        .from('shared_collection_bookings')
        .select('*')
        .gte('booking_date', formatDate(first))
        .lte('booking_date', formatDate(last))
        .order('start_time', { ascending: true });
      if (error) {
        showToast('❌ ' + error.message);
        return;
      }
      setMonthBookings(data || []);
    },
    [currentYear, currentMonth, showToast],
  );

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadALData(), loadMonthBookings(currentYear, currentMonth)]);
      } catch (err) {
        console.error('loadAll error:', err);
        setLoadError('Error loading - check console');
      }
    })();
    loadWeather();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload month bookings whenever the period changes
  useEffect(() => {
    loadMonthBookings(currentYear, currentMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth]);

  // ── Weather ──
  async function loadWeather() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 6);
    const fs = formatDate(today);
    const fe = formatDate(end);
    const ck = fs + '_' + fe;
    let wd;
    if (_wCache[ck]) {
      wd = _wCache[ck];
    } else {
      try {
        const r = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=4.3995&longitude=114.0148&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia/Kuching&start_date=' +
            fs +
            '&end_date=' +
            fe,
        );
        if (!r.ok) throw new Error('weather');
        const j = await r.json();
        if (!j.daily || !j.daily.time) throw new Error('weather');
        wd = j.daily;
        _wCache[ck] = wd;
      } catch (e) {
        setWeather(false);
        return;
      }
    }
    const dn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [];
    for (let i = 0; i < wd.time.length; i++) {
      const ds = wd.time[i];
      const dt = new Date(ds + 'T00:00:00');
      const dl = ds === fs ? 'Today' : dn[dt.getDay()];
      const dd = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
      const code = wd.weather_code[i];
      const hi = Math.round(wd.temperature_2m_max[i]);
      const lo = Math.round(wd.temperature_2m_min[i]);
      const rain = wd.precipitation_probability_max[i] || 0;
      days.push({
        ds,
        isToday: ds === fs,
        name: dl,
        date: dd,
        icon: W_ICONS[code] || '☁️',
        desc: W_CODES[code] || 'Cloudy',
        hi,
        lo,
        rain,
        rainHigh: rain >= 60,
      });
    }
    setWeather(days);
  }

  // ════════════════════════════════════════════════════════
  //  NURSERY / PLOT OPTIONS
  // ════════════════════════════════════════════════════════
  const nurseryOptions = useMemo(() => {
    const seen = {};
    const out = [];
    plotsData.forEach((p) => {
      if (p.nursery_name && !seen[p.nursery_name]) {
        seen[p.nursery_name] = true;
        out.push(p.nursery_name);
      }
    });
    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return out;
  }, [plotsData]);

  const plotOptionsFor = useCallback(
    (nursery) => {
      return plotsData
        .filter((p) => p.plot_name && (!nursery || p.nursery_name === nursery))
        .sort((a, b) => a.plot_name.localeCompare(b.plot_name, undefined, { numeric: true, sensitivity: 'base' }))
        .map((p) => p.plot_name);
    },
    [plotsData],
  );

  // ════════════════════════════════════════════════════════
  //  PERIOD NAV
  // ════════════════════════════════════════════════════════
  function changePeriod(dir) {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m > 11) {
      m = 0;
      y++;
    }
    if (m < 0) {
      m = 11;
      y--;
    }
    setCurrentMonth(m);
    setCurrentYear(y);
  }
  function goToday() {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
  }
  const periodLabel = loadError || MONTH_NAMES[currentMonth] + ' ' + currentYear;

  // ════════════════════════════════════════════════════════
  //  MONTH GRID
  // ════════════════════════════════════════════════════════
  function getMonthBookingsFor(dateStr) {
    return monthBookings.filter((b) => (b.booking_date || '').substring(0, 10) === dateStr && b.status !== 'cancelled');
  }

  const monthCells = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    let startDow = firstDay.getDay();
    if (startDow === 0) startDow = 7;
    const cellDate = new Date(firstDay);
    cellDate.setDate(cellDate.getDate() - (startDow - 1));

    const rows = [];
    for (let row = 0; row < 6; row++) {
      let hasContent = false;
      const cols = [];
      for (let col = 0; col < 7; col++) {
        const d = new Date(cellDate);
        const isThisMonth = d.getMonth() === currentMonth;
        if (isThisMonth) hasContent = true;
        const dow = d.getDay();
        const isSunday = dow === 0;
        const ds = formatDate(d);
        cols.push({
          ds,
          dayNum: d.getDate(),
          isThisMonth,
          isToday: isToday(d),
          isPast: isPast(d),
          isSunday,
          holiday: getHoliday(ds),
          bookings: isThisMonth ? getMonthBookingsFor(ds) : [],
        });
        cellDate.setDate(cellDate.getDate() + 1);
      }
      rows.push(cols);
      if (!hasContent && row > 4) break;
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear, currentMonth, monthBookings]);

  function monthCellClickable(cell) {
    return cell.isThisMonth && !cell.isSunday && !cell.isPast;
  }

  // ════════════════════════════════════════════════════════
  //  NEW BOOKING MODAL
  // ════════════════════════════════════════════════════════
  function buildTimeOptions(dateStr, sourceBookings, preselectHour) {
    const d = new Date(dateStr + 'T00:00:00');
    const isSat = d.getDay() === 6;
    const hours = isSat ? HOURS_SAT : HOURS_WEEKDAY;
    const dayBks = (sourceBookings || []).filter(
      (b) => (b.booking_date || '').substring(0, 10) === dateStr && b.status !== 'cancelled',
    );
    const opts = hours.map((h) => {
      const timeStr = String(h).padStart(2, '0') + ':00';
      const slotBookings = dayBks.filter((b) => (b.start_time || '').substring(0, 5) === timeStr);
      let label = timeSlotLabel(h);
      if (slotBookings.length > 0) {
        const names = slotBookings.map((b) => (b.customer_name || '').substring(0, 15)).join(', ');
        label += ' — ' + slotBookings.length + ' booked (' + names + ')';
      }
      return { value: timeStr, label };
    });
    let selected = opts.length ? opts[0].value : '';
    if (preselectHour != null) {
      const ts = String(preselectHour).padStart(2, '0') + ':00';
      if (opts.some((o) => o.value === ts)) selected = ts;
    }
    return { opts, selected };
  }

  function resetBookingForm() {
    setSelectedAL(null);
    setBookingQty(0);
    setBkQtyInput('');
    setBkAlQuery('');
    setBkAlDropdownOpen(false);
    setBkNursery('');
    setBkPlot('');
    setBkNotes('');
  }

  function openNewBooking(dateStr, hour) {
    const checkDate = new Date(dateStr + 'T00:00:00');
    if (isPast(checkDate)) {
      showToast('⚠️ Cannot book on past dates');
      return;
    }
    resetBookingForm();
    setBkDate(dateStr);
    const { opts, selected } = buildTimeOptions(dateStr, monthBookings, hour);
    setBkTimeOptions(opts);
    setBkTime(selected);
    setBookingOpen(true);
  }

  async function onBookingDateChange(dateStr) {
    if (!dateStr) return;
    const d = new Date(dateStr + 'T00:00:00');
    if (isPast(d)) {
      showToast('⚠️ Cannot book on past dates');
      setBkDate(formatDate(new Date()));
      return;
    }
    const dow = d.getDay();
    if (dow === 0) {
      showToast('⚠️ Sunday is closed');
      setBkDate(formatDate(new Date()));
      return;
    }
    setBkDate(dateStr);
    // Reload bookings for that date's week to populate dropdown
    const weekStart = getMonday(d);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const { data } = await supabase
      .from('shared_collection_bookings')
      .select('*')
      .gte('booking_date', formatDate(weekStart))
      .lte('booking_date', formatDate(weekEnd))
      .order('start_time', { ascending: true });
    const { opts, selected } = buildTimeOptions(dateStr, data || [], null);
    setBkTimeOptions(opts);
    setBkTime(selected);
  }

  function closeBookingModal() {
    setBookingOpen(false);
    setBkAlDropdownOpen(false);
  }

  // ── AL search (new booking) ──
  const bkAlResults = useMemo(() => {
    const lower = bkAlQuery.trim().toLowerCase();
    if (lower.length < 1) return [];
    return alData
      .filter(
        (r) =>
          (r.al_number || '').toLowerCase().includes(lower) ||
          (r.customer_name || '').toLowerCase().includes(lower) ||
          (r.order_number || '').toLowerCase().includes(lower),
      )
      .slice(0, 8);
  }, [bkAlQuery, alData]);

  function selectAL(alNumber) {
    const al = alData.find((r) => r.al_number === alNumber);
    if (!al) return;
    setSelectedAL(al);
    setBkAlDropdownOpen(false);
    setBkAlQuery(al.al_number + ' — ' + (al.customer_name || ''));
    setBookingQty(0);
    setBkQtyInput('');
    setBkNursery('');
    setBkPlot('');
  }

  function selectBkQty(qty) {
    const max = selectedAL?.balance_quantity || 0;
    if (qty > max) {
      showToast('⚠️ Cannot exceed balance (' + max.toLocaleString() + ')');
      return;
    }
    setBookingQty(qty);
    setBkQtyInput('');
  }

  function selectBkCustomQty(raw) {
    setBkQtyInput(raw);
    const val = parseInt(raw) || 0;
    const max = selectedAL?.balance_quantity || 0;
    if (val > max) {
      showToast('⚠️ Cannot exceed balance (' + max.toLocaleString() + ')');
      setBookingQty(0);
      return;
    }
    setBookingQty(val > 0 ? val : 0);
  }

  const bookingReady = !!selectedAL && bookingQty > 0 && bookingQty <= (selectedAL?.balance_quantity || 0);

  async function submitBooking() {
    if (!selectedAL || bookingQty <= 0) return;
    if (bookingQty > (selectedAL.balance_quantity || 0)) {
      showToast('⚠️ Qty exceeds balance');
      return;
    }
    setBkSaving(true);
    const timeVal = bkTime; // e.g. "09:00"
    const startH = parseInt(timeVal.split(':')[0]);
    const endH = startH + hoursNeeded(bookingQty);
    const payload = {
      al_number: selectedAL.al_number,
      order_number: selectedAL.order_number || '',
      customer_name: selectedAL.customer_name || '',
      collection_qty: bookingQty,
      booking_date: bkDate,
      start_time: timeVal,
      end_time: String(endH).padStart(2, '0') + ':00',
      status: 'booked',
      nursery_name: bkNursery.trim() || null,
      plot_name: bkPlot.trim() || null,
      notes: bkNotes.trim() || null,
    };
    const { error } = await supabase.from('shared_collection_bookings').insert([payload]);
    setBkSaving(false);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    showToast('✅ Booking confirmed for ' + selectedAL.customer_name);
    closeBookingModal();
    await reloadCurrentView();
  }

  // ════════════════════════════════════════════════════════
  //  RELOAD HELPER
  // ════════════════════════════════════════════════════════
  async function reloadCurrentView() {
    await loadMonthBookings(currentYear, currentMonth);
    if (dayModalDate && dayOpen) {
      const { data } = await supabase
        .from('shared_collection_bookings')
        .select('*')
        .eq('booking_date', dayModalDate)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true });
      setDayBookings(data || []);
    }
  }

  // ════════════════════════════════════════════════════════
  //  VIEW / EDIT BOOKING
  // ════════════════════════════════════════════════════════
  function viewBooking(id) {
    let b = monthBookings.find((x) => x.id === id);
    if (!b && dayBookings) b = dayBookings.find((x) => x.id === id);
    if (!b) return;
    setSelectedBooking(b);
    setDetDate(b.booking_date || '');
    setDetQty(b.collection_qty || '');
    setDetNotes(b.notes || '');
    setDetNursery(b.nursery_name || '');
    setDetPlot(b.plot_name || '');

    const d = new Date((b.booking_date || '') + 'T00:00:00');
    const isSat = d.getDay() === 6;
    const hours = isSat ? HOURS_SAT : HOURS_WEEKDAY;
    const startH = b.start_time ? parseInt(b.start_time.split(':')[0]) : 8;
    setDetTimeOptions(hours.map((h) => ({ value: String(h).padStart(2, '0') + ':00', label: timeSlotLabel(h) })));
    setDetTime(String(startH).padStart(2, '0') + ':00');

    // pending reset
    setDetAlQuery('');
    setDetAlDropdownOpen(false);
    setMatchedALForConfirm(null);

    setDetailOpen(true);
  }

  function closeDetailModal() {
    setDetailOpen(false);
    setSelectedBooking(null);
  }

  const detStatusMap = { booked: '🟢 Booked', completed: '🟦 Collected', cancelled: '🟥 Cancelled', pending: '⏳ Pending' };
  const detIsDone = selectedBooking && (selectedBooking.status === 'completed' || selectedBooking.status === 'cancelled');
  const detIsPending = selectedBooking && selectedBooking.status === 'pending';

  async function saveBookingEdit() {
    if (!selectedBooking) return;
    setDetSaving(true);
    const timeVal = detTime;
    const startH = parseInt(timeVal.split(':')[0]);
    const editQty = parseInt(detQty) || selectedBooking.collection_qty;
    const editEndH = startH + hoursNeeded(editQty);
    const updates = {
      booking_date: detDate,
      start_time: timeVal,
      end_time: String(editEndH).padStart(2, '0') + ':00',
      collection_qty: editQty,
      nursery_name: detNursery.trim() || null,
      plot_name: detPlot.trim() || null,
      notes: detNotes.trim() || null,
    };
    const { error } = await supabase.from('shared_collection_bookings').update(updates).eq('id', selectedBooking.id);
    setDetSaving(false);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    showToast('✅ Booking updated');
    closeDetailModal();
    await reloadCurrentView();
  }

  async function cancelBooking() {
    if (!selectedBooking) return;
    const { error } = await supabase.from('shared_collection_bookings').update({ status: 'cancelled' }).eq('id', selectedBooking.id);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    showToast('❌ Booking cancelled');
    closeDetailModal();
    await reloadCurrentView();
  }

  // ── Pending AL match & confirm ──
  const detAlResults = useMemo(() => {
    const lower = detAlQuery.trim().toLowerCase();
    if (lower.length < 1) return [];
    return alData
      .filter(
        (r) =>
          (r.al_number || '').toLowerCase().includes(lower) ||
          (r.customer_name || '').toLowerCase().includes(lower) ||
          (r.order_number || '').toLowerCase().includes(lower),
      )
      .slice(0, 8);
  }, [detAlQuery, alData]);

  function selectALForConfirm(alNumber) {
    const al = alData.find((r) => r.al_number === alNumber);
    if (!al) return;
    setMatchedALForConfirm(al);
    setDetAlDropdownOpen(false);
    setDetAlQuery(al.al_number + ' — ' + (al.customer_name || ''));
  }

  async function confirmPendingBooking() {
    if (!selectedBooking || !matchedALForConfirm) return;
    setDetConfirming(true);
    const updates = {
      status: 'booked',
      al_number: matchedALForConfirm.al_number,
      order_number: matchedALForConfirm.order_number || '',
      customer_name: matchedALForConfirm.customer_name || selectedBooking.customer_name,
    };
    const { error } = await supabase.from('shared_collection_bookings').update(updates).eq('id', selectedBooking.id);
    setDetConfirming(false);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    showToast('✅ Booking confirmed — ' + matchedALForConfirm.customer_name);
    closeDetailModal();
    await reloadCurrentView();
  }

  // ════════════════════════════════════════════════════════
  //  DAY ALLOCATION MODAL
  // ════════════════════════════════════════════════════════
  async function openDayModal(ds) {
    setDayModalDate(ds);
    setDayBookings(null);
    setDayOpen(true);
    const { data } = await supabase
      .from('shared_collection_bookings')
      .select('*')
      .eq('booking_date', ds)
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true });
    setDayBookings(data || []);
  }
  function closeDayModal() {
    setDayOpen(false);
    setDayModalDate(null);
  }
  function openNewBookingFromDay() {
    const ds = dayModalDate;
    closeDayModal();
    openNewBooking(ds, 8);
  }

  const dayModalTitle = useMemo(() => {
    if (!dayModalDate) return '—';
    const d = new Date(dayModalDate + 'T00:00:00');
    return DAY_NAMES[d.getDay()] + ', ' + d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
  }, [dayModalDate]);

  const boardColumns = useMemo(() => {
    const nurseries = nurseryOptions.slice(0, 3);
    const cols = [{ id: 'pending', label: '⏳ Pending', type: 'pending', nurseryName: null }];
    nurseries.forEach((n) => {
      cols.push({ id: 'nursery-' + n.replace(/[^a-zA-Z0-9]/g, '_'), label: '🌱 ' + n, type: 'nursery', nurseryName: n });
    });
    return cols;
  }, [nurseryOptions]);

  function bookingsForColumn(col) {
    const list = (dayBookings || []).filter((b) => {
      if (col.type === 'pending') return !b.nursery_name || b.nursery_name === '' || b.nursery_name === 'PENDING';
      return b.nursery_name === col.nurseryName;
    });
    list.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    return list;
  }

  async function updatePlotFromBoard(id, plotName) {
    const { error } = await supabase.from('shared_collection_bookings').update({ plot_name: plotName || null }).eq('id', id);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    setDayBookings((prev) => (prev || []).map((b) => (b.id === id ? { ...b, plot_name: plotName || null } : b)));
    showToast('✅ Plot updated' + (plotName ? ': ' + plotName : ''));
  }

  async function cancelFromBoard(id) {
    if (!window.confirm('Cancel this booking?')) return;
    const { error } = await supabase.from('shared_collection_bookings').update({ status: 'cancelled' }).eq('id', id);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    setDayBookings((prev) => (prev || []).filter((b) => b.id !== id));
    showToast('❌ Booking cancelled');
    await reloadCurrentView();
  }

  // ── Drag & drop ──
  function boardDragStart(e, id) {
    dragBookingId.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    setDraggingId(id);
  }
  function boardDragOver(e, colId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colId);
  }
  function boardDragLeave(e, colId) {
    setDragOverCol((cur) => (cur === colId ? null : cur));
  }
  async function boardDrop(e, nurseryName) {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData('text/plain') || dragBookingId.current;
    setDraggingId(null);
    if (!id) return;
    const bk = (dayBookings || []).find((b) => String(b.id) === String(id));
    const oldNursery = bk ? bk.nursery_name : null;
    const switchedNursery = (nurseryName || null) !== (oldNursery || null);
    const updates = { nursery_name: nurseryName || null };
    if (switchedNursery) updates.plot_name = null;
    if (nurseryName && bk && bk.status === 'pending') updates.status = 'booked';

    const { error } = await supabase.from('shared_collection_bookings').update(updates).eq('id', bk ? bk.id : id);
    if (error) {
      showToast('❌ ' + error.message);
      return;
    }
    setDayBookings((prev) =>
      (prev || []).map((b) => {
        if (String(b.id) !== String(id)) return b;
        const next = { ...b, nursery_name: nurseryName || null };
        if (switchedNursery) next.plot_name = null;
        if (updates.status) next.status = updates.status;
        return next;
      }),
    );
    showToast('✅ Moved to ' + (nurseryName || 'Pending'));
    await reloadCurrentView();
  }

  // ════════════════════════════════════════════════════════
  //  CLICK-OUTSIDE FOR AL DROPDOWNS
  // ════════════════════════════════════════════════════════
  useEffect(() => {
    function onDocClick(e) {
      if (bkSearchWrapRef.current && !bkSearchWrapRef.current.contains(e.target)) setBkAlDropdownOpen(false);
      if (detSearchWrapRef.current && !detSearchWrapRef.current.contains(e.target)) setDetAlDropdownOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  // ════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════
  function pillClass(status) {
    if (status === 'completed') return 'completed';
    if (status === 'pending') return 'pending';
    return 'booked';
  }

  return (
    <>
      <style>{PAGE_CSS}</style>
      <TopNav title="Collection Time Slot Booking" userName={userName} />

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-4" style={{ background: '#f1f5f9', minHeight: 'calc(100vh - 65px)' }}>
        {/* Weather Forecast (7-Day, Miri) */}
        {Array.isArray(weather) && weather.length > 0 && (
          <div className="dash-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 0 0 4 4h9a5 5 0 1 0-.1-9.999 5.002 5.002 0 1 0-9.78 2.096A4.001 4.001 0 0 0 3 15z" />
              </svg>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Miri 7-Day Weather Forecast</span>
            </div>
            <div className="weather-strip">
              {weather.map((w) => (
                <div key={w.ds} className={`weather-day ${w.isToday ? 'today' : ''}`}>
                  <div className="weather-day-name">{w.name}</div>
                  <div style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 700 }}>{w.date}</div>
                  <div className="weather-day-icon">{w.icon}</div>
                  <div className="weather-day-temp">{w.hi}°/{w.lo}°</div>
                  <div className={`weather-day-rain ${w.rainHigh ? 'high' : ''}`}>💧 {w.rain}%</div>
                  <div className="weather-day-desc">{w.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nav bar */}
        <div className="dash-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => changePeriod(-1)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-emerald-100 flex items-center justify-center text-slate-500 hover:text-emerald-700 font-black text-lg cursor-pointer transition-colors border-none">‹</button>
            <div className="text-sm font-black text-slate-800 uppercase tracking-wide">{periodLabel}</div>
            <button onClick={() => changePeriod(1)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-emerald-100 flex items-center justify-center text-slate-500 hover:text-emerald-700 font-black text-lg cursor-pointer transition-colors border-none">›</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={goToday} className="text-[10px] font-black text-emerald-700 uppercase tracking-widest bg-emerald-50 hover:bg-emerald-100 px-4 py-2 rounded-xl border border-emerald-200 cursor-pointer transition-colors">Today</button>
          </div>
        </div>

        {/* Month View */}
        <div className="dash-card p-0 overflow-x-auto">
          <div className="month-grid">
            {DAY_HEADERS.map((d) => (
              <div className="month-header" key={d}>{d}</div>
            ))}
            {monthCells.map((rowCells, ri) =>
              rowCells.map((cell, ci) => {
                const classes = ['month-cell'];
                if (cell.isToday) classes.push('today');
                if (cell.isPast) classes.push('past');
                if (!cell.isThisMonth) classes.push('other-month');
                if (cell.isSunday) classes.push('closed');
                if (cell.holiday) classes.push('holiday');
                const clickable = monthCellClickable(cell);
                const shown = cell.bookings.slice(0, 2);
                return (
                  <div
                    key={cell.ds + '-' + ri + '-' + ci}
                    className={classes.join(' ')}
                    onClick={clickable ? () => openDayModal(cell.ds) : undefined}
                  >
                    <div className="month-day-num">{cell.dayNum}</div>
                    {cell.holiday && <div className="month-holiday-tag">{cell.holiday}</div>}
                    {shown.map((b) => (
                      <div
                        key={b.id}
                        className={`booking-pill ${pillClass(b.status)}`}
                        style={{ fontSize: '9px', padding: '2px 5px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openDayModal(cell.ds);
                        }}
                      >
                        {(b.customer_name || '').substring(0, 10)} ({b.collection_qty || 0})
                      </div>
                    ))}
                    {cell.bookings.length > 2 && (
                      <div
                        className="text-[9px] font-bold text-slate-400 cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDayModal(cell.ds);
                        }}
                      >
                        +{cell.bookings.length - 2} more
                      </div>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>

      {/* ═══════ NEW BOOKING MODAL ═══════ */}
      <div className={`modal-overlay ${bookingOpen ? 'open' : ''}`} onClick={closeBookingModal}>
        <div className="modal-box" onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#064e3b,#065f46)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-base font-black text-emerald-300 uppercase tracking-widest mb-1">📅 Collection Time Slot Booking</div>
            </div>
            <button onClick={closeBookingModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Date</label>
                <input type="date" className="search-input text-sm" style={{ padding: '10px 14px' }} value={bkDate} min={formatDate(new Date())} onChange={(e) => onBookingDateChange(e.target.value)} />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Time Slot</label>
                <select className="search-input text-sm" style={{ padding: '10px 14px' }} value={bkTime} onChange={(e) => setBkTime(e.target.value)}>
                  {bkTimeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* AL Search */}
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Search Order</label>
              <div className="relative" ref={bkSearchWrapRef}>
                <input
                  type="text"
                  className="search-input text-sm"
                  style={{ padding: '10px 14px' }}
                  placeholder="Search order number, AL number or customer name..."
                  autoComplete="off"
                  value={bkAlQuery}
                  onChange={(e) => {
                    setBkAlQuery(e.target.value);
                    setBkAlDropdownOpen(e.target.value.trim().length >= 1);
                  }}
                  onFocus={(e) => setBkAlDropdownOpen(e.target.value.trim().length >= 1)}
                />
                {bkAlDropdownOpen && (
                  <div className="al-dropdown">
                    {bkAlResults.length === 0 ? (
                      <div className="al-dropdown-item text-slate-400 text-xs">No matching order found</div>
                    ) : (
                      bkAlResults.map((r) => (
                        <div key={r.id || r.al_number} className="al-dropdown-item" onClick={() => selectAL(r.al_number)}>
                          <span className="al-num">{r.al_number || ''}</span> — <span className="al-cust">{r.customer_name || ''}</span>
                          <div className="text-[10px] text-slate-400">{r.order_number || ''} · Bal: {r.balance_quantity ?? 0}</div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Selected AL info */}
            {selectedAL && (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Order Number', value: selectedAL.order_number || '—' },
                    { label: 'Product', value: selectedAL.product_name || '—' },
                    { label: 'Qty Ordered', value: selectedAL.quantity_ordered ?? '—' },
                    { label: 'Balance', value: selectedAL.balance_quantity ?? '—', blue: true },
                  ].map((f) => (
                    <div key={f.label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{f.label}</div>
                      <div className={`font-black text-sm leading-snug ${f.blue ? 'text-blue-700' : 'text-slate-800'}`}>{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Collection Qty */}
            {selectedAL && (
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Collection Quantity</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {[50, 100, 500, 1000].map((q) => (
                    <button key={q} className={`qty-btn ${bookingQty === q && !bkQtyInput ? 'active' : ''}`} onClick={() => selectBkQty(q)}>
                      +{q.toLocaleString()}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    max={selectedAL.balance_quantity || 0}
                    className="search-input text-sm"
                    style={{ padding: '10px 14px', width: '130px' }}
                    placeholder="Custom qty"
                    value={bkQtyInput}
                    onChange={(e) => selectBkCustomQty(e.target.value)}
                  />
                </div>
                {bookingQty > 0 && (
                  <div className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    Booking Qty: <span>{bookingQty.toLocaleString()}</span> seedlings
                  </div>
                )}
                <div className="text-[10px] font-bold text-slate-400 mt-1">Max: {(selectedAL.balance_quantity || 0).toLocaleString()} (balance to collect)</div>
              </div>
            )}

            {/* Nursery & Plot */}
            {selectedAL && (
              <div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Collect From Nursery</label>
                    <select
                      className="search-input text-sm"
                      style={{ padding: '10px 14px' }}
                      value={bkNursery}
                      onChange={(e) => {
                        setBkNursery(e.target.value);
                        setBkPlot('');
                      }}
                    >
                      <option value="">— Select Nursery —</option>
                      {nurseryOptions.map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Plot</label>
                    <select className="search-input text-sm" style={{ padding: '10px 14px' }} value={bkPlot} onChange={(e) => setBkPlot(e.target.value)}>
                      <option value="">— Select Plot —</option>
                      {plotOptionsFor(bkNursery).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedAL && (
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Notes (Optional)</label>
                <input type="text" className="search-input text-sm" style={{ padding: '10px 14px' }} placeholder="e.g. Customer will send lorry" value={bkNotes} onChange={(e) => setBkNotes(e.target.value)} />
              </div>
            )}
          </div>

          <div className="px-5 sm:px-6 pb-6 flex flex-col sm:flex-row gap-3 justify-end border-t border-slate-100 pt-5">
            <button onClick={closeBookingModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Cancel</button>
            <button onClick={submitBooking} disabled={!bookingReady || bkSaving} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black text-[11px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
              {bkSaving ? 'Saving…' : '📅 Confirm Booking'}
            </button>
          </div>
        </div>
      </div>

      {/* ═══════ BOOKING EDIT MODAL ═══════ */}
      <div className={`modal-overlay ${detailOpen ? 'open' : ''}`} style={{ zIndex: 250 }} onClick={closeDetailModal}>
        <div className="modal-box" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#1e3a8a,#1d4ed8)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">📅 Edit Booking</div>
              <div className="text-lg font-black text-white">{selectedBooking?.customer_name || '—'}</div>
            </div>
            <button onClick={closeDetailModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0 ml-4">×</button>
          </div>

          <div className="p-5 sm:p-6 space-y-4">
            {/* Info row */}
            {selectedBooking && (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'AL Number', value: selectedBooking.al_number || '—' },
                  { label: 'Order #', value: selectedBooking.order_number || '—' },
                  { label: 'Customer', value: selectedBooking.customer_name || '—' },
                  { label: 'Status', value: detStatusMap[selectedBooking.status] || selectedBooking.status },
                ].map((f) => (
                  <div key={f.label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{f.label}</div>
                    <div className="font-black text-slate-800 text-sm leading-snug">{f.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Editable fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Date</label>
                <input type="date" className="search-input text-sm" style={{ padding: '10px 14px' }} value={detDate} onChange={(e) => setDetDate(e.target.value)} />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Time Slot</label>
                <select className="search-input text-sm" style={{ padding: '10px 14px' }} value={detTime} onChange={(e) => setDetTime(e.target.value)}>
                  {detTimeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Collection Qty</label>
              <input type="number" min="1" className="search-input text-sm" style={{ padding: '10px 14px' }} value={detQty} onChange={(e) => setDetQty(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Nursery</label>
                <select
                  className="search-input text-sm"
                  style={{ padding: '10px 14px' }}
                  value={detNursery}
                  onChange={(e) => {
                    setDetNursery(e.target.value);
                    setDetPlot('');
                  }}
                >
                  <option value="">— Select Nursery —</option>
                  {nurseryOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Plot</label>
                <select className="search-input text-sm" style={{ padding: '10px 14px' }} value={detPlot} onChange={(e) => setDetPlot(e.target.value)}>
                  <option value="">— Select Plot —</option>
                  {plotOptionsFor(detNursery).map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Notes</label>
              <input type="text" className="search-input text-sm" style={{ padding: '10px 14px' }} placeholder="Optional notes" value={detNotes} onChange={(e) => setDetNotes(e.target.value)} />
            </div>

            {/* Pending confirmation section */}
            {detIsPending && (
              <div className="border-t border-amber-200 pt-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-3">
                  <div className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">⚠️ Pending Customer Booking — Match with AL</div>
                  <p className="text-xs font-bold text-amber-600 mb-3">
                    Customer entered: <span className="text-slate-800 font-black">{selectedBooking?.customer_name || '—'}</span>. Match to an existing AL before confirming.
                  </p>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Link to AL Number</label>
                  <div className="relative" ref={detSearchWrapRef}>
                    <input
                      type="text"
                      className="search-input text-sm"
                      style={{ padding: '10px 14px' }}
                      placeholder="Search AL number..."
                      autoComplete="off"
                      value={detAlQuery}
                      onChange={(e) => {
                        setDetAlQuery(e.target.value);
                        setDetAlDropdownOpen(e.target.value.trim().length >= 1);
                      }}
                      onFocus={(e) => setDetAlDropdownOpen(e.target.value.trim().length >= 1)}
                    />
                    {detAlDropdownOpen && (
                      <div className="al-dropdown">
                        {detAlResults.length === 0 ? (
                          <div className="al-dropdown-item text-slate-400 text-xs">No matching order found</div>
                        ) : (
                          detAlResults.map((r) => (
                            <div key={r.id || r.al_number} className="al-dropdown-item" onClick={() => selectALForConfirm(r.al_number)}>
                              <span className="al-num">{r.al_number || ''}</span> — <span className="al-cust">{r.customer_name || ''}</span>
                              <div className="text-[10px] text-slate-400">{r.order_number || ''} · Bal: {r.balance_quantity ?? 0}</div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                  {matchedALForConfirm && (
                    <div className="mt-2 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">
                      ✅ Matched: <strong>{matchedALForConfirm.al_number}</strong> — {matchedALForConfirm.customer_name || ''} (Order: {matchedALForConfirm.order_number || '—'}, Balance: {matchedALForConfirm.balance_quantity || 0})
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 sm:px-6 pb-6 flex flex-col sm:flex-row gap-3 justify-end border-t border-slate-100 pt-5">
            {!detIsDone && (
              <button onClick={cancelBooking} className="text-[10px] font-black text-red-600 hover:text-white hover:bg-red-600 uppercase tracking-widest bg-red-50 px-5 py-3 rounded-xl border border-red-200 cursor-pointer transition-colors">❌ Cancel Booking</button>
            )}
            <button onClick={closeDetailModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-5 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Close</button>
            {!detIsDone && (
              <button onClick={saveBookingEdit} disabled={detSaving} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black text-[10px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors">
                {detSaving ? 'Saving…' : '💾 Save Changes'}
              </button>
            )}
            {detIsPending && (
              <button onClick={confirmPendingBooking} disabled={!matchedALForConfirm || detConfirming} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-widest rounded-xl border-none cursor-pointer transition-colors" style={{ opacity: matchedALForConfirm ? 1 : 0.4 }}>
                {detConfirming ? 'Confirming…' : '✅ Confirm Booking'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ═══════ DAY ALLOCATION MODAL ═══════ */}
      <div className={`modal-overlay ${dayOpen ? 'open' : ''}`} style={{ zIndex: 240 }} onClick={closeDayModal}>
        <div className="modal-box" style={{ maxWidth: '900px' }} onClick={(e) => e.stopPropagation()}>
          <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e293b)' }} className="p-6 rounded-t-[24px] flex justify-between items-start">
            <div>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">📅 Day View — Nursery Allocation</div>
              <div className="text-lg font-black text-white">{dayModalTitle}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openNewBookingFromDay} className="text-[9px] font-black text-white uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-xl border-none cursor-pointer transition-colors">+ New Booking</button>
              <button onClick={closeDayModal} className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white font-black text-lg flex items-center justify-center transition-colors shrink-0">×</button>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {dayBookings === null ? (
              <div className="text-center py-8 text-slate-300 text-xs font-bold uppercase tracking-widest">Loading…</div>
            ) : (
              <div className="alloc-board">
                {boardColumns.map((col) => {
                  const colBookings = bookingsForColumn(col);
                  const totalQty = colBookings.reduce((s, b) => s + (b.collection_qty || 0), 0);
                  let lastTimeLabel = '';
                  return (
                    <div
                      key={col.id}
                      className={`alloc-col ${col.type === 'pending' ? 'pending' : 'nursery'} ${dragOverCol === col.id ? 'drag-over' : ''}`}
                      onDragOver={(e) => boardDragOver(e, col.id)}
                      onDragLeave={(e) => boardDragLeave(e, col.id)}
                      onDrop={(e) => boardDrop(e, col.nurseryName || '')}
                    >
                      <div className="alloc-col-header">
                        {col.label}
                        <span className="alloc-count">({colBookings.length})</span>
                      </div>
                      {totalQty > 0 && (
                        <div className={`text-center font-black mb-2 px-3 py-2 rounded-lg ${col.type === 'pending' ? 'text-amber-700 bg-amber-50' : 'text-blue-700 bg-blue-50'}`}>
                          <div className="text-lg">{totalQty.toLocaleString()}</div>
                          <div className="text-[9px] uppercase tracking-widest">seedlings</div>
                        </div>
                      )}
                      {colBookings.map((b) => {
                        const startH = parseInt((b.start_time || '08').split(':')[0]);
                        const endH = parseInt((b.end_time || '09').split(':')[0]);
                        const timeLabel = formatHour(startH) + ' – ' + formatHour(endH);
                        const showSep = timeLabel !== lastTimeLabel;
                        if (showSep) lastTimeLabel = timeLabel;
                        const filterNursery = col.type === 'nursery' ? col.nurseryName : null;
                        const plotOpts = plotOptionsFor(filterNursery);
                        return (
                          <div key={b.id}>
                            {showSep && (
                              <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest px-2 py-1 mt-1 bg-slate-100 rounded-md">⏰ {timeLabel}</div>
                            )}
                            <div
                              className={`alloc-card ${b.status === 'pending' ? 'status-pending' : 'status-booked'} ${draggingId === b.id ? 'dragging' : ''}`}
                              draggable
                              onDragStart={(e) => boardDragStart(e, b.id)}
                              onDragEnd={() => setDraggingId(null)}
                              style={{ position: 'relative' }}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelFromBoard(b.id);
                                }}
                                style={{ position: 'absolute', top: '6px', right: '6px', width: '18px', height: '18px', borderRadius: '9px', border: 'none', background: '#fee2e2', color: '#dc2626', fontSize: '11px', fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                              >
                                ×
                              </button>
                              <div className="card-name" style={{ paddingRight: '22px', cursor: 'pointer' }} onClick={() => viewBooking(b.id)}>
                                {b.customer_name || '—'}
                              </div>
                              <div className="flex justify-between items-center mt-1">
                                <span className="card-qty">{(b.collection_qty || 0).toLocaleString()} seedlings</span>
                                <span className="card-detail">{b.al_number && b.al_number !== 'PENDING' ? b.al_number : ''}</span>
                              </div>
                              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                <select
                                  value={b.plot_name || ''}
                                  onChange={(e) => updatePlotFromBoard(b.id, e.target.value)}
                                  style={{ width: '100%', padding: '5px 8px', fontSize: '10px', fontWeight: 700, fontFamily: 'Outfit,sans-serif', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: '#334155', cursor: 'pointer', outline: 'none' }}
                                >
                                  <option value="">— Assign Plot —</option>
                                  {plotOpts.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                  ))}
                                </select>
                              </div>
                              {b.plot_name && <div className="text-[9px] font-bold text-emerald-600 mt-1">📍 {b.plot_name}</div>}
                              {b.status === 'pending' && <div className="text-[9px] font-black text-amber-600 mt-1">⚠️ Awaiting confirmation</div>}
                            </div>
                          </div>
                        );
                      })}
                      {colBookings.length === 0 && (
                        <div className="text-center py-6 text-slate-300 text-[10px] font-bold uppercase tracking-widest">Drop here</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-5 sm:px-6 pb-5 flex justify-end border-t border-slate-100 pt-4">
            <button onClick={closeDayModal} className="text-[10px] font-black text-slate-500 hover:text-slate-800 uppercase tracking-widest bg-slate-50 px-6 py-3 rounded-full border border-slate-200 cursor-pointer transition-colors">Close</button>
          </div>
        </div>
      </div>

      <ToastHost />
    </>
  );
}

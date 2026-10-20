/* The admin portal's icons, in one vector set.

   Every page used to carry emoji for its icons (📋 ✍️ 📅 🔖 📷 ⚠️ …). An
   emoji is a different glyph on every platform and font, cannot be
   recoloured or reliably sized, and a handful render as a blank box on an
   older Android keyboard/font combination. One small outline set, same
   stroke style everywhere, fixes all three at once.

   Usage: <Icon name="camera" className="w-5 h-5" />
   Add a new glyph by adding its path(s) below — PATHS[name] is either one
   "d" string or an array of them, for icons needing more than one <path>. */
const PATHS = {
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  pen: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10.172V5a2 2 0 012-2z',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  camera: ['M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z', 'M15 13a3 3 0 11-6 0 3 3 0 016 0z'],
  warning: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  errorCircle: ['M12 9v2m0 4h.01', 'M12 21a9 9 0 100-18 9 9 0 000 18z'],
  checkCircle: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  check: 'M5 13l4 4L19 7',
  close: 'M6 18L18 6M6 6l12 12',
  offline: 'M18.364 5.636a9 9 0 010 12.728m0 0l-3.536-3.536m3.536 3.536L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 7.824a4.978 4.978 0 01-2.831-1.414M3 3l18 18',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  lock: ['M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z', 'M8 11V7a4 4 0 118 0v4'],
  unlock: ['M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z', 'M8 11V7a4 4 0 017.446-2'],
  bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
  save: ['M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-6 4h6m-6 4h6M9 7V3h6v4'],
  inboxEmpty: 'M20 13V7a2 2 0 00-2-2H6a2 2 0 00-2 2v6m16 0l-2.447 4.894A2 2 0 0115.764 19H8.236a2 2 0 01-1.789-1.106L4 13m16 0h-3.5a1 1 0 00-.894.553l-.712 1.424a1 1 0 01-.894.553h-3.5a1 1 0 01-.894-.553l-.712-1.424A1 1 0 006.5 13H3',
  sparkles: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  worker: ['M9 20H5a2 2 0 01-2-2v-1a5 5 0 015-5h2m4-7a4 4 0 110 8 4 4 0 010-8z', 'M14 14.5V12a3 3 0 013-3h0a3 3 0 013 3v8h-6v-3.5', 'M13 9h8'],
  chevronRight: 'M9 5l7 7-7 7',
  cloud: 'M3 15a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 9.5 4 4 0 003 15z',
  fog: ['M3 15a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 9.5 4 4 0 003 15z', 'M5 20h14'],
  document: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  printer: ['M6 9V4a1 1 0 011-1h10a1 1 0 011 1v5M6 18H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-1', 'M6 14h12v7H6v-7z'],
  box: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  undo: 'M9 14l-4-4 4-4m-4 4h11a4 4 0 010 8h-1',
  sun: ['M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707', 'M12 16a4 4 0 100-8 4 4 0 000 8z'],
  sunCloud: ['M9 5a4 4 0 014 4', 'M3 15a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 9.5 4 4 0 003 15z'],
  cloudy: 'M3 15a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 9.5 4 4 0 003 15z',
  storm: ['M3 13a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 7.5 4 4 0 003 13z', 'M11 15l-2 4h3l-2 4'],
  rain: ['M3 13a4 4 0 004 4h9a5 5 0 001-9.9A6 6 0 005.1 7.5 4 4 0 003 13z', 'M8 19l-1 2M12 19l-1 2M16 19l-1 2'],
  seedling: 'M12 21v-7m0 0c-4 0-7-3-7-7 4 0 7 1.5 7 7zm0 0c4 0 7-3 7-7-4 0-7 1.5-7 7z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z',
  pin: ['M12 11a2 2 0 100-4 2 2 0 000 4z', 'M12 21s7-7.5 7-12a7 7 0 10-14 0c0 4.5 7 12 7 12z'],
  blocked: 'M18.364 5.636a9 9 0 11-12.728 0 9 9 0 0112.728 0zM5.636 5.636l12.728 12.728',
  receipt: 'M9 14l2 2 4-4m6-6v14l-3-2-3 2-3-2-3 2-3-2-3 2V4a1 1 0 011-1h14a1 1 0 011 1z',
  pencilNote: ['M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'],
  clock: ['M12 8v4l3 3', 'M12 21a9 9 0 100-18 9 9 0 000 18z'],
  power: ['M12 3v7', 'M7.5 6.5a7 7 0 109 0'],
};

export default function Icon({ name, className = 'w-5 h-5' }) {
  const d = PATHS[name];
  if (!d) return null;
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {paths.map((p, i) => (
        <path key={i} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={p} />
      ))}
    </svg>
  );
}

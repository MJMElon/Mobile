/* ══════════════════════════════════════════════════════════════════════
   THE 555 PORTAL BAR

   The same bar the Auditor Portal and the FC Scan Portal wear: a white
   sticky ribbon in three columns — the way back on the left, the stacked
   555 wordmark on the true centre line, and the staff name with Sign Out
   on the right.

   Every value here is the FC portal's (Barcode_Counter's TopNav in its
   `book` layout): px-6 py-2.5, gap-2, a slate-200 rule and shadow-sm; a
   36px slate-100 back circle with a 16px stroke-3 arrow; 555 at 34px
   black italic #065f46 tracking-tight, the house name at 13px/900
   slate-800 tracking-[0.14em], the caption at 10px/900 emerald-600
   tracking-[0.25em], each 4px apart; slate-50 pills with slate-200
   borders and slate-500 text. Three portals, one bar — anything changed
   here belongs on the other two in the same pass.
   ══════════════════════════════════════════════════════════════════════ */

// A plain left arrow, the same one the FC bar uses.
function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export default function PortalBar({
  sub = 'Admin Portal',
  back,          // href for the way back; omitted on the portal's own top level
  backLabel = 'Back',
  user,
  onSignOut,
}) {
  return (
    <div className="bg-white border-slate-200 border-b px-3 sm:px-6 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sticky top-0 z-30 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 justify-self-start">
        {back && (
          <a
            href={back}
            title={backLabel}
            aria-label={backLabel}
            className="bg-slate-100 hover:bg-emerald-100 text-slate-500 hover:text-emerald-700 grid place-items-center rounded-full w-9 h-9 border border-slate-200 transition-colors no-underline shrink-0 cursor-pointer"
          >
            <BackArrow />
          </a>
        )}
      </div>

      {/* The 555 mark, stacked: the book on top and biggest, the house name
          under it, then the surface it opens. Every line is leading-none
          with its own margin — three stacked sizes are where default leading
          quietly adds 10px of air and pushes a sticky bar down the page. */}
      <div className="min-w-0 text-center">
        <div className="font-black italic text-[#065f46] text-[27px] sm:text-[34px] leading-none tracking-tight">
          555
        </div>
        <div className="font-black text-slate-800 text-[11px] sm:text-[13px] tracking-[0.14em] uppercase leading-none mt-1 whitespace-nowrap">
          MJM Nursery
        </div>
        <div className="font-black text-emerald-600 text-[9px] sm:text-[10px] uppercase tracking-[0.18em] sm:tracking-[0.25em] leading-none mt-1 whitespace-nowrap">
          {sub}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 justify-self-end">
        {/* The staff name goes on phones: it was competing with the wordmark
            for a 360px bar and pushing it off centre. */}
        {user && (
          <span className="hidden sm:inline text-[11px] font-bold text-slate-500 truncate">
            Welcome, {user}
          </span>
        )}
        <button
          onClick={onSignOut}
          title="Sign Out"
          aria-label="Sign Out"
          className="text-[10px] font-bold text-slate-500 hover:text-red-500 bg-slate-50 border-slate-200 uppercase tracking-wider sm:tracking-widest px-2.5 sm:px-3 py-2 rounded-full border cursor-pointer transition-colors shrink-0"
        >
          <span className="hidden sm:inline">Sign Out</span>
          <span className="sm:hidden text-[13px] leading-none">⏻</span>
        </button>
      </div>
    </div>
  );
}

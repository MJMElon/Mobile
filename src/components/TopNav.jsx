import { signOutLocal } from '../lib/auth';

// Shared sticky top nav for interior pages (DO, booking, consent).
export default function TopNav({ title, userName, backHref = 'index.html' }) {
  async function handleSignOut() {
    await signOutLocal();
    window.location.href = 'index.html';
  }
  return (
    <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
      <div className="flex items-center gap-3">
        {backHref && (
          <a
            href={backHref}
            className="flex items-center gap-2 bg-slate-100 hover:bg-emerald-100 rounded-lg px-3 py-2 text-slate-500 hover:text-emerald-700 transition-colors font-black text-xs uppercase tracking-wider whitespace-nowrap"
          >
            ← Back to Main Page
          </a>
        )}
        <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-black text-xs shrink-0">
          AI
        </div>
        <span className="font-black text-slate-800 uppercase tracking-widest text-sm">{title}</span>
      </div>
      <div className="flex items-center gap-3">
        {userName && <span className="text-xs font-bold text-slate-400 hidden md:block">{userName}</span>}
        <button
          onClick={handleSignOut}
          className="text-[10px] font-bold text-slate-500 hover:text-red-500 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

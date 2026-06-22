import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser, displayName } from '../lib/auth';

// Wraps an interior page. Ensures there's a session AND ops access before
// rendering children. No session → bounce to login. Session but no access →
// bounce to auth.html (which shows the Pending Access notice). Fails open on
// profile-read errors so a Supabase hiccup doesn't lock admins out.
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!s) {
        window.location.href = 'index.html';
        return;
      }
      rememberUser(s);
      const ok = await checkOpsAccess(s, { failClosed: false });
      if (cancelled) return;
      if (!ok) {
        window.location.replace('auth.html');
        return;
      }
      setSession(s);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_OUT' || !s) window.location.href = 'index.html';
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Loading…</div>
      </div>
    );
  }

  return children({ session, userName: displayName(session) });
}

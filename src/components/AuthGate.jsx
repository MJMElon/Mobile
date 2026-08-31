import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser, displayName, cachedSession } from '../lib/auth';

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
      /* getSession() answers null both for "never signed in" and for "signed
         in, but the token expired and the refresh did not land". Any null
         falls back to whatever is still in storage — signed in is a state
         you stay in; only a pressed Sign Out (or the server refusing the
         refresh token, which raises SIGNED_OUT below) ends it. */
      const useSess = s || cachedSession();
      if (!useSess) {
        window.location.href = 'index.html';
        return;
      }
      rememberUser(useSess);
      const ok = await checkOpsAccess(useSess, { failClosed: false });
      if (cancelled) return;
      if (!ok) {
        window.location.replace('auth.html');
        return;
      }
      setSession(useSess);
      setReady(true);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Same reasoning as above: only an explicit SIGNED_OUT means somebody
      // actually signed out. Anything else answering null offline falls back
      // to the cached session instead of undoing what just got recovered.
      const useSess = s || (event !== 'SIGNED_OUT' ? cachedSession() : null);
      if (event === 'SIGNED_OUT' || !useSess) window.location.href = 'index.html';
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

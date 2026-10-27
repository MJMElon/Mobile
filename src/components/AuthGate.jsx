import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { resolveAccess, refuseCustomer, rememberUser, displayName, cachedSession } from '../lib/auth';
import AccessNotice from './AccessNotice.jsx';
import { startAutoSync } from '../lib/adminSync.js';

// Interior pages tick too — an MPA loads each page fresh, so the dashboard's
// call does not cover a person parked on the DO screen all morning.
startAutoSync();

// Wraps an interior page. Ensures there's a session AND ops access before
// rendering children. No session → bounce to login. Session but no access →
// bounce to auth.html (which shows the Pending Access notice). A Sales Web
// customer is refused and signed out on the spot. A profile read that FAILS
// does not let anybody in: the last profile this phone read for the same user
// id is used if there is one, and otherwise the page says it could not check
// and offers Try again, keeping the session.
export default function AuthGate({ page = null, children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState(null); // null | 'customer' | 'unknown'
  const refused = useRef(false);
  const recheck = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
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
      /* Two different refusals, and they must not land in the same place.
         No ops access at all is somebody who does not belong in the portal,
         and auth.html is where the Pending Access notice lives. Ops access
         but not THIS screen is somebody who belongs here and was sent to a
         door the office closed — their other tiles are on the dashboard, so
         that is where they go. Bouncing them to auth.html would read as
         being thrown out of the portal entirely. */
      const access = await resolveAccess(useSess, { page });
      if (cancelled) return;
      if (access.state === 'customer') {
        refused.current = true;
        setNotice('customer');
        await refuseCustomer(useSess);
        return;
      }
      if (access.state === 'unknown') {
        setNotice('unknown');
        return;
      }
      setNotice(null);
      const inPortal = access.state !== 'pending';
      if (!inPortal) {
        window.location.replace('auth.html');
        return;
      }
      const ok = access.state === 'ok';
      if (!ok) {
        window.location.replace('index.html');
        return;
      }
      setSession(useSess);
      setReady(true);
    }
    recheck.current = check;
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Same reasoning as above: only an explicit SIGNED_OUT means somebody
      // actually signed out. Anything else answering null offline falls back
      // to the cached session instead of undoing what just got recovered.
      // A refused customer is signed out by this page itself, and the
      // refusal is what stays on screen — not a bounce to the login.
      if (refused.current) return;
      const useSess = s || (event !== 'SIGNED_OUT' ? cachedSession() : null);
      if (event === 'SIGNED_OUT' || !useSess) window.location.href = 'index.html';
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  if (notice) {
    return <AccessNotice kind={notice} onRetry={() => recheck.current && recheck.current()} />;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Loading…</div>
      </div>
    );
  }

  return children({ session, userName: displayName(session) });
}

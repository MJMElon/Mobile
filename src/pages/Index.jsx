import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser, displayName, signOutLocal, cachedSession, isOnline } from '../lib/auth';
import { hasOffline, openOffline, sealOffline } from '../lib/offlineVault.js';
import BookCover from '../components/BookCover.jsx';
import PortalBar from '../components/PortalBar.jsx';
import NelosBlock from '../components/NelosBlock.jsx';

/* A login that never reached the server, as opposed to one the server
   refused. Only the first kind is worth retrying against the phone's sealed
   copy — a server that ANSWERED "wrong password" never is. Same test as the
   FC Portal's AuthScreen. */
function neverReachedServer(error) {
  return !!error && (error.status === 0 || error.status === undefined ||
    /fetch|network|load failed/i.test(String(error.message || '')));
}

// Combined sign-in + dashboard. This is what mobile.mjmnursery.com opens on,
// so this is the login almost everyone sees — auth.html is the other door,
// used by password-recovery links and the awaiting-approval notice. They
// share one cover (BookCover) so a change to one cannot miss the other.
export default function IndexPage() {
  const [screen, setScreen] = useState('loading'); // loading | auth | dash
  const [session, setSession] = useState(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isRecovering, setIsRecovering] = useState(
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery'),
  );
  const [btnLabel, setBtnLabel] = useState('Login');
  const [busy, setBusy] = useState(false);

  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const pwRef = useRef(null);
  const newPwRef = useRef(null);
  const loggingOut = useRef(false);

  useEffect(() => {
    // Ops-access gate runs deferred (setTimeout 0) so it executes OUTSIDE the
    // onAuthStateChange callback — calling .from() inside the callback holds
    // the auth lock and deadlocks ("stuck on Processing"). Same fix as legacy.
    async function runGate(s) {
      if (loggingOut.current) return;
      rememberUser(s);
      const ok = await checkOpsAccess(s, { failClosed: false });
      if (!ok) {
        window.location.replace('auth.html');
        return;
      }
      setSession(s);
      setScreen('dash');
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (loggingOut.current) return;
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovering(true);
        setScreen('auth');
        return;
      }
      /* INITIAL_SESSION (and getSession() below) can answer null for two very
         different reasons: nobody has ever signed in on this device, or
         somebody has but the token expired and the refresh it tried needed a
         network that is not there. Only an explicit SIGNED_OUT means an
         actual sign-out; anything else null, offline, falls back to whatever
         is still in storage rather than showing the login form to someone
         who was already using the portal this morning. */
      const useSess = s || (event !== 'SIGNED_OUT' && !isOnline() ? cachedSession() : null);
      if (event === 'SIGNED_OUT' || !useSess) {
        setScreen('auth');
        return;
      }
      setTimeout(() => runGate(useSess), 0);
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      const useSess = s || (!isOnline() ? cachedSession() : null);
      if (!useSess) setScreen('auth');
      else if (!isRecovering) setTimeout(() => runGate(useSess), 0);
      else setScreen('auth');
    });

    return () => sub?.subscription?.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMainAuth() {
    const email = emailRef.current?.value.trim();
    const pw = pwRef.current?.value;
    if (!email || !pw) return alert('Please enter email and password.');
    setBusy(true);
    setBtnLabel('Processing…');

    if (isSignUp) {
      const name = nameRef.current?.value.trim();
      const { error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: { data: { full_name: name } },
      });
      if (error) {
        alert('Signup Error: ' + error.message);
        setBtnLabel('Sign Up');
      } else {
        alert('Account created! You can now log in.');
        setIsSignUp(false);
        setBtnLabel('Login');
      }
    } else if (!isOnline()) {
      await offlineUnlock(email, pw);
      setBtnLabel('Login');
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) {
        /* navigator.onLine says true on plenty of dead connections, so a
           login that never reached the server also falls back to the phone's
           sealed copy. */
        if (neverReachedServer(error) && hasOffline(email)) await offlineUnlock(email, pw);
        else alert('Login Error: ' + error.message);
        setBtnLabel('Login');
      } else {
        await sealAfterLogin(email, pw, data);
      }
    }
    setBusy(false);
  }

  /* Sign in against the phone's sealed copy — the no-line path. The typed
     password either decrypts the session saved at the last ONLINE login, or
     nothing happens; see offlineVault.js. On success the saved session goes
     back where supabase-js keeps it and the page reboots onto it. */
  async function offlineUnlock(email, pw) {
    if (!hasOffline(email)) {
      alert('No line — and this phone has not signed in to this account before. The first sign-in needs signal; after that it works offline.');
      return;
    }
    const saved = await openOffline(email, pw);
    if (!saved || !saved.storageKey || !saved.session) {
      alert('Password does not match. (No line — checked against the copy saved on this phone.)');
      return;
    }
    try { localStorage.setItem(saved.storageKey, JSON.stringify(saved.session)); } catch (e) { /* */ }
    window.location.reload();
  }

  /* After a successful ONLINE login, seal what supabase-js just wrote so the
     NEXT login can happen with no line. Best effort. */
  async function sealAfterLogin(email, pw, data) {
    try {
      const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
      const raw = key ? JSON.parse(localStorage.getItem(key)) : null;
      const session = raw || (data && data.session) || null;
      if (key && session) await sealOffline(email, pw, { storageKey: key, session });
    } catch (e) { /* nothing to do */ }
  }

  async function handleForgot() {
    const email = emailRef.current?.value.trim();
    if (!email) return alert('Enter your email first.');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) alert('Error: ' + error.message);
    else alert('Reset link sent! Check your inbox.');
  }

  async function handleUpdatePassword() {
    const pw = newPwRef.current?.value;
    if (!pw || pw.length < 6) return alert('Password must be at least 6 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return alert('Error: ' + error.message);
    alert('Password updated! Please log in.');
    setIsRecovering(false);
    window.location.hash = '';
    setScreen('auth');
  }

  async function handleLogout() {
    loggingOut.current = true;
    await signOutLocal();
    setIsSignUp(false);
    setBtnLabel('Login');
    setScreen('auth');
    loggingOut.current = false;
  }

  function toggleSignUp() {
    setIsSignUp((v) => {
      const next = !v;
      setBtnLabel(next ? 'Sign Up' : 'Login');
      return next;
    });
  }

  if (screen === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#050a0e' }}>
        <div className="text-[11px] font-black text-emerald-500 uppercase tracking-widest">Loading…</div>
      </div>
    );
  }

  if (screen === 'dash') {
    const modules = [
      { href: 'do_signing.html', icon: '📋', bg: 'bg-emerald-100', title: 'Issue Collection DO' },
      { href: 'consent.html', icon: '✍️', bg: 'bg-amber-100', title: 'Customer Consent' },
      { href: 'booking.html', icon: '📅', bg: 'bg-blue-100', title: 'Customer Collection Time Slot Booking' },
    ];
    return (
      <div className="fade-enter" style={{ background: '#f1f5f9', minHeight: '100vh' }}>
        <PortalBar user={displayName(session)} onSignOut={handleLogout} />
        <div className="max-w-[900px] mx-auto px-6 py-8">
          {/* What is waiting, above what you came here to open. The module
              cards are a chooser and are always the same three; the cases
              are the only thing on this page that changes day to day, so
              they go first. Renders nothing at all if the case log is
              unreachable — see NelosBlock. */}
          <NelosBlock />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {modules.map((m) => (
              <a key={m.href} href={m.href} className="module-card p-5 flex items-center gap-4">
                <div className={`w-14 h-14 ${m.bg} rounded-2xl flex items-center justify-center text-3xl shrink-0`}>{m.icon}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-black text-slate-800 uppercase tracking-wide leading-tight">{m.title}</h3>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></div>
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Active</span>
                  </div>
                </div>
                <div className="text-slate-300 font-black text-lg shrink-0">›</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── SIGN IN ──
  return (
    <BookCover house="MJM Nursery" portal="Admin Portal">
      <div className="bk-lines">
        {!isRecovering ? (
          <>
            {isSignUp && (
              <input ref={nameRef} type="text" placeholder="Full Name" className="bk-field" autoComplete="name" />
            )}
            <input ref={emailRef} type="email" placeholder="Email Address" className="bk-field"
                   autoCapitalize="none" autoComplete="email" />
            <input
              ref={pwRef}
              type="password"
              placeholder="Password"
              className="bk-field"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && handleMainAuth()}
            />
            <button className="bk-btn" disabled={busy} onClick={handleMainAuth}>{btnLabel}</button>
            <div className="bk-links">
              {!isSignUp && (
                <button onClick={handleForgot} className="bk-link">Forgot Password?</button>
              )}
              <button onClick={toggleSignUp} className="bk-link bk-link-right">
                {isSignUp ? 'Back to Login' : 'Create Account'}
              </button>
            </div>
          </>
        ) : (
          <>
            <input ref={newPwRef} type="password" placeholder="Create New Password" className="bk-field" />
            <button className="bk-btn" onClick={handleUpdatePassword}>Save Password</button>
          </>
        )}
      </div>
    </BookCover>
  );
}

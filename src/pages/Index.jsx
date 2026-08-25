import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser, displayName, signOutLocal } from '../lib/auth';
import BookCover from '../components/BookCover.jsx';
import PortalBar from '../components/PortalBar.jsx';

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
      if (event === 'SIGNED_OUT' || !s) {
        setScreen('auth');
        return;
      }
      if (s) setTimeout(() => runGate(s), 0);
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) setScreen('auth');
      else if (!isRecovering) setTimeout(() => runGate(s), 0);
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
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) {
        alert('Login Error: ' + error.message);
        setBtnLabel('Login');
      }
    }
    setBusy(false);
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
    <BookCover title="MJM Nursery" sub="Admin Portal">
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
                <button onClick={handleForgot} className="bk-link">Forgot password?</button>
              )}
              <button onClick={toggleSignUp} className="bk-link bk-link-right">
                {isSignUp ? 'Back to login' : 'Create account'}
              </button>
            </div>
          </>
        ) : (
          <>
            <input ref={newPwRef} type="password" placeholder="Enter New Password" className="bk-field" />
            <button className="bk-btn" onClick={handleUpdatePassword}>Save Password</button>
          </>
        )}
      </div>
    </BookCover>
  );
}

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser, displayName, signOutLocal } from '../lib/auth';

// Combined auth + dashboard, faithful to the original index.html.
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
        <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-black text-xs">AI</div>
            <span className="font-black text-slate-800 uppercase tracking-widest text-sm">MJM Nursery AI</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold text-slate-400 hidden md:block">Welcome, {displayName(session)}</span>
            <button
              onClick={handleLogout}
              className="text-[10px] font-bold text-slate-500 hover:text-red-500 uppercase tracking-widest bg-slate-50 px-4 py-2 rounded-full border border-slate-200 cursor-pointer transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
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

  // ── AUTH SCREEN ──
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative">
      <div className="auth-bg"></div>
      <div className="grid-lines"></div>
      <div className="scan-beam"></div>
      <div className="beam beam-h bh1"></div><div className="beam beam-h bh2"></div><div className="beam beam-h bh3"></div>
      <div className="beam beam-v bv1"></div><div className="beam beam-v bv2"></div><div className="beam beam-v bv3"></div>

      <div className="auth-card rounded-[2.5rem] w-full max-w-md p-10 relative z-10">
        <div className="corner corner-tl"></div><div className="corner corner-tr"></div>
        <div className="corner corner-bl"></div><div className="corner corner-br"></div>

        <div className="flex flex-col items-center mb-10">
          <div className="relative w-full flex items-center justify-center mb-3" style={{ height: '90px' }}>
            <div className="logo-cross-h"></div>
            <div className="logo-cross-v"></div>
            <div className="logo-title z-10 relative text-center px-4" style={{ fontSize: 'clamp(2.2rem,6vw,3.2rem)', lineHeight: 1.1 }}>
              MJM<br />
              <span style={{ fontSize: '0.55em', letterSpacing: '0.3em', color: '#34d399', fontWeight: 900, display: 'block', marginTop: '2px' }}>NURSERY</span>
            </div>
          </div>
          <div className="ai-badge mt-1">AI</div>
          <p className="text-[11px] font-black text-emerald-500 uppercase tracking-[0.35em] mt-5 text-center">The future is here</p>
        </div>

        {!isRecovering ? (
          <div className="space-y-3">
            {isSignUp && <input ref={nameRef} type="text" placeholder="Full Name" className="auth-input mb-3" />}
            <input ref={emailRef} type="email" placeholder="Email Address" className="auth-input" />
            <input
              ref={pwRef}
              type="password"
              placeholder="Password"
              className="auth-input"
              onKeyDown={(e) => e.key === 'Enter' && handleMainAuth()}
            />
            <button className="auth-btn mt-2" disabled={busy} onClick={handleMainAuth}>{btnLabel}</button>
            <div className="flex justify-between items-center pt-2">
              {!isSignUp && (
                <button onClick={handleForgot} className="text-[10px] font-bold text-emerald-600/70 hover:text-emerald-400 uppercase tracking-widest bg-transparent border-none cursor-pointer transition-colors">
                  Forgot Password?
                </button>
              )}
              <button onClick={toggleSignUp} className="text-[10px] font-bold text-slate-400 hover:text-emerald-400 uppercase tracking-widest bg-transparent border-none cursor-pointer transition-colors ml-auto">
                {isSignUp ? 'Back to Login' : 'Create Account'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-center text-[10px] font-bold text-emerald-500 uppercase tracking-widest mb-4">Create New Password</div>
            <input ref={newPwRef} type="password" placeholder="Enter New Password" className="auth-input" />
            <button className="auth-btn mt-2" onClick={handleUpdatePassword}>Save Password</button>
          </div>
        )}
      </div>
    </div>
  );
}

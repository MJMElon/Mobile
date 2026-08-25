import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser } from '../lib/auth';
import BookCover from '../components/BookCover.jsx';

// Login / Sign-up / OTP / Forgot-password / Recovery screen, on the shared
// Supabase project — the same accounts as ai.mjmnursery.com. Nothing about
// who can sign in changed here; only what it looks like while they do.
//
// Dressed as the cover of the 555 exercise book everyone in the nursery
// already writes in: the red logotype across the top, a lot of blank cover,
// and ruled "Name……………" lines near the foot, which is where you sign in.
//
// One book, a pile of colours: the Auditor Portal's cover is pink, the FC
// Portal's is blue, this one is green. Only the three --bk-cover values
// differ between them — keep it that way.
export default function AuthPage() {
  const [method, setMethod] = useState('password'); // password | otp | sms
  const [isSignUp, setIsSignUp] = useState(false);
  const [isRecovery, setIsRecovery] = useState(
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery'),
  );
  const [status, setStatus] = useState({ msg: '', type: '' });
  const [pendingEmail, setPendingEmail] = useState(null);
  const [emailSendLabel, setEmailSendLabel] = useState('Send Code');
  const [smsSendLabel, setSmsSendLabel] = useState('Send SMS');
  const [showPw, setShowPw] = useState(false);
  const postLoginRan = useRef(false);

  // Field refs
  const epEmail = useRef(null);
  const epPw = useRef(null);
  const signupName = useRef(null);
  const eoEmail = useRef(null);
  const eoOtp = useRef(null);
  const smsPhone = useRef(null);
  const smsOtp = useRef(null);
  const recPw = useRef(null);

  const showStatus = (msg, type) => setStatus({ msg, type });
  const clearStatus = () => setStatus({ msg: '', type: '' });

  useEffect(() => {
    async function handlePostLogin(session) {
      if (!session) return showStatus('Login failed.', 'error');
      if (postLoginRan.current) return;
      postLoginRan.current = true;
      showStatus('Checking access...', 'success');
      rememberUser(session);
      // Entry point → fail CLOSED so customers don't slip through.
      const ok = await checkOpsAccess(session, { failClosed: true });
      if (!ok) {
        setPendingEmail(session.user.email || '');
        return;
      }
      showStatus('Welcome! Redirecting...', 'success');
      setTimeout(() => (window.location.href = 'index.html'), 800);
    }
    // expose for handlers below
    AuthPage._handlePostLogin = handlePostLogin;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        return;
      }
      if (event === 'SIGNED_IN' && session && !isRecovery) {
        setTimeout(() => handlePostLogin(session), 0);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !isRecovery) handlePostLogin(session);
    });

    return () => sub?.subscription?.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──
  async function loginEmailPassword() {
    const email = epEmail.current?.value.trim();
    const pw = epPw.current?.value;
    if (!email || !pw) return showStatus('Please enter email and password.', 'error');
    if (isSignUp) {
      const name = signupName.current?.value.trim();
      showStatus('Creating account...', 'success');
      const { error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name } } });
      if (error) return showStatus(error.message, 'error');
      showStatus('Account created! You can now log in.', 'success');
      setIsSignUp(false);
      return;
    }
    showStatus('Signing in...', 'success');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) return showStatus(error.message, 'error');
    await AuthPage._handlePostLogin(data.session);
  }

  async function sendEmailOTP() {
    const email = eoEmail.current?.value.trim();
    if (!email) return showStatus('Please enter your email.', 'error');
    setEmailSendLabel('Sending...');
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      setEmailSendLabel('Send Code');
      return showStatus(error.message, 'error');
    }
    showStatus('Code sent to ' + email + '. Check your inbox.', 'success');
    countdown(setEmailSendLabel);
  }

  async function verifyEmailOTP() {
    const email = eoEmail.current?.value.trim();
    const otp = eoOtp.current?.value.trim();
    if (!email || !otp) return showStatus('Please enter email and code.', 'error');
    showStatus('Verifying...', 'success');
    const { data, error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    if (error) return showStatus(error.message, 'error');
    await AuthPage._handlePostLogin(data.session);
  }

  async function sendSmsOTP() {
    const phone = smsPhone.current?.value.trim();
    if (!phone) return showStatus('Please enter your phone number.', 'error');
    if (!phone.startsWith('+')) return showStatus('Include country code (e.g. +60112345678)', 'error');
    setSmsSendLabel('Sending...');
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setSmsSendLabel('Send SMS');
      return showStatus(error.message, 'error');
    }
    showStatus('SMS sent to ' + phone + '. Check your messages.', 'success');
    countdown(setSmsSendLabel);
  }

  async function verifySmsOTP() {
    const phone = smsPhone.current?.value.trim();
    const otp = smsOtp.current?.value.trim();
    if (!phone || !otp) return showStatus('Please enter phone number and code.', 'error');
    showStatus('Verifying...', 'success');
    const { data, error } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) return showStatus(error.message, 'error');
    await AuthPage._handlePostLogin(data.session);
  }

  async function forgotPassword() {
    const email = epEmail.current?.value.trim();
    if (!email) return showStatus('Enter your email first, then click Forgot Password.', 'error');
    showStatus('Sending reset link...', 'success');
    // Pin the reset link to THIS app. Without an explicit redirectTo,
    // Supabase falls back to the project-wide Site URL (a different MJM app).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/auth.html',
    });
    if (error) return showStatus(error.message, 'error');
    showStatus('Reset link sent! Check your inbox.', 'success');
  }

  async function updatePassword() {
    const pw = recPw.current?.value;
    if (!pw || pw.length < 6) return showStatus('Password must be at least 6 characters.', 'error');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return showStatus(error.message, 'error');
    showStatus('Password updated! Redirecting...', 'success');
    setIsRecovery(false);
    window.location.hash = '';
    setTimeout(() => (window.location.href = 'auth.html'), 1500);
  }

  function countdown(setLabel) {
    let n = 30;
    setLabel('Sent');
    const t = setInterval(() => {
      n -= 1;
      setLabel('Resend (' + n + ')');
      if (n <= 0) {
        clearInterval(t);
        setLabel('Resend');
      }
    }, 1000);
  }

  async function pendingSignOut() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      /* ignore */
    }
    location.reload();
  }

  const onEnter = (fn) => (e) => e.key === 'Enter' && fn();

  // ── Waiting for access: a note left inside the book ──
  if (pendingEmail !== null) {
    return (
      <BookCover title="Admin Portal" sub="MJM Nursery · Collection &amp; Delivery">
        <div className="bk-slip">
          <div className="bk-slip-head">Access pending</div>
          <p className="bk-slip-body">
            Your account exists, but no module access has been granted yet.
            Ask an admin to switch on the Admin Portal for you.
          </p>
          <div className="bk-slip-email">
            <span>signed in as</span>
            {pendingEmail}
          </div>
          <div className="bk-slip-acts">
            <button className="bk-link" onClick={() => location.reload()}>Check again</button>
            <button className="bk-link bk-link-right" onClick={pendingSignOut}>Sign out</button>
          </div>
        </div>
      </BookCover>
    );
  }

  const METHODS = [
    ['password', 'Password'],
    ['otp', 'Email code'],
    ['sms', 'SMS code'],
  ];

  return (
    <BookCover title="Admin Portal" sub="MJM Nursery · Collection &amp; Delivery">
      {/* The three ways in, printed on the cover like a subject line */}
      {!isRecovery && (
        <div className="bk-tabs">
          {METHODS.map(([m, label]) => (
            <button
              key={m}
              className={`bk-tab${method === m ? ' bk-tab-on' : ''}`}
              onClick={() => {
                setMethod(m);
                clearStatus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="bk-lines">
        {status.type && (
          <div className={`bk-note ${status.type === 'error' ? 'bk-err' : 'bk-ok'}`}>
            {status.msg}
          </div>
        )}

        {isRecovery ? (
          <>
            <input
              ref={recPw}
              type="password"
              className="bk-field"
              placeholder="New password"
              autoComplete="new-password"
              onKeyDown={onEnter(updatePassword)}
            />
            <button className="bk-btn" onClick={updatePassword}>Save Password</button>
          </>
        ) : method === 'password' ? (
          <>
            {isSignUp && (
              <input ref={signupName} type="text" className="bk-field"
                     placeholder="Full Name" autoComplete="name" />
            )}

            <input
              ref={epEmail}
              type="email"
              className="bk-field"
              placeholder="Email Address"
              autoComplete="email"
              autoCapitalize="none"
              onKeyDown={onEnter(() => epPw.current?.focus())}
            />

            <div className="bk-boxed">
              <input
                ref={epPw}
                type={showPw ? 'text' : 'password'}
                className="bk-field"
                placeholder="Password"
                autoComplete="current-password"
                onKeyDown={onEnter(loginEmailPassword)}
              />
              <button
                className="bk-eye"
                type="button"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? 'Hide password' : 'Show password'}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPw && <line x1="3" y1="21" x2="21" y2="3" />}
                </svg>
              </button>
            </div>

            <button className="bk-btn" onClick={loginEmailPassword}>
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </button>

            <div className="bk-links">
              <button className="bk-link" onClick={forgotPassword}>Forgot password?</button>
              <button className="bk-link bk-link-right" onClick={() => setIsSignUp((v) => !v)}>
                {isSignUp ? 'Back to sign in' : 'Create account'}
              </button>
            </div>
          </>
        ) : method === 'otp' ? (
          <>
            <input
              ref={eoEmail}
              type="email"
              className="bk-field"
              placeholder="Email Address"
              autoComplete="email"
              autoCapitalize="none"
            />
            <div className="bk-boxed">
              <input
                ref={eoOtp}
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="bk-field bk-code"
                placeholder="8-digit code"
                onKeyDown={onEnter(verifyEmailOTP)}
              />
              <button className="bk-send" type="button" onClick={sendEmailOTP}>{emailSendLabel}</button>
            </div>
            <button className="bk-btn" onClick={verifyEmailOTP}>Sign In</button>
            <p className="bk-hint">An 8-digit code goes to your inbox.</p>
          </>
        ) : (
          <>
            <input
              ref={smsPhone}
              type="tel"
              className="bk-field"
              autoComplete="tel"
              placeholder="Phone (+60112345678)"
            />
            <div className="bk-boxed">
              <input
                ref={smsOtp}
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="bk-field bk-code"
                placeholder="8-digit code"
                onKeyDown={onEnter(verifySmsOTP)}
              />
              <button className="bk-send" type="button" onClick={sendSmsOTP}>{smsSendLabel}</button>
            </div>
            <button className="bk-btn" onClick={verifySmsOTP}>Sign In</button>
            <p className="bk-hint">An 8-digit code goes to your phone.</p>
          </>
        )}
      </div>
    </BookCover>
  );
}

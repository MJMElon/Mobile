import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser } from '../lib/auth';

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
    const { error } = await supabase.auth.resetPasswordForEmail(email);
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

  // ── Pending access screen ──
  if (pendingEmail !== null) {
    return (
      <Frame>
        <div
          style={{
            background: '#0b1b13',
            border: '1px solid rgba(245,158,11,.4)',
            borderRadius: '18px',
            padding: '24px',
            maxWidth: '380px',
            width: '100%',
            textAlign: 'center',
            color: '#e5e7eb',
            position: 'relative',
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>⏳</div>
          <div style={{ fontSize: '10px', fontWeight: 900, color: '#fbbf24', letterSpacing: '.25em', marginBottom: '6px' }}>ACCESS PENDING</div>
          <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>Awaiting admin approval</div>
          <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '14px' }}>
            Your account exists but no module access has been granted yet.
            <br />
            Please contact an admin to grant access for this AI system.
          </div>
          <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' }}>
            <div style={{ fontSize: '9px', fontWeight: 900, color: '#64748b', letterSpacing: '.18em', marginBottom: '2px' }}>YOUR SIGN-IN EMAIL</div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#e5e7eb', wordBreak: 'break-all' }}>{pendingEmail}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button onClick={() => location.reload()} style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '.18em', background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.5)', color: '#6ee7b7', padding: '8px 14px', borderRadius: '9999px', cursor: 'pointer' }}>↻ REFRESH</button>
            <button onClick={pendingSignOut} style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '.18em', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '8px 14px', borderRadius: '9999px', cursor: 'pointer' }}>SIGN OUT</button>
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="auth-card" style={{ borderRadius: '2rem', padding: '2.5rem', width: '100%', maxWidth: '400px', position: 'relative', zIndex: 10 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: 'clamp(1.5rem,4vw,2rem)', fontWeight: 900, color: '#ecfdf5', letterSpacing: '.04em', lineHeight: 1.1, animation: 'pulseGlow 4s ease-in-out infinite' }}>
            MJM<br />
            <span style={{ fontSize: '.55em', letterSpacing: '.3em', color: '#34d399', fontWeight: 900 }}>NURSERY</span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '4px 12px', borderRadius: '8px', background: 'linear-gradient(135deg,#059669,#10b981)', color: 'white', fontSize: '16px', fontWeight: 900, letterSpacing: '.12em', border: '1px solid #34d399', marginTop: '.5rem' }}>AI</div>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(52,211,153,.5)', letterSpacing: '.3em', textTransform: 'uppercase', marginTop: '.75rem' }}>Secure Login</div>
        </div>

        {!isRecovery && (
          <div className="method-toggle" style={toggleWrap}>
            {[['password', 'Password'], ['otp', 'Email OTP'], ['sms', 'SMS OTP']].map(([m, label]) => (
              <button
                key={m}
                onClick={() => {
                  setMethod(m);
                  clearStatus();
                }}
                style={{ ...methodBtn, ...(method === m ? methodBtnActive : {}) }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {status.type && (
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              padding: '10px',
              borderRadius: '10px',
              marginBottom: '1rem',
              ...(status.type === 'error'
                ? { background: 'rgba(239,68,68,.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,.2)' }
                : { background: 'rgba(16,185,129,.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,.2)' }),
            }}
          >
            {status.msg}
          </div>
        )}

        {isRecovery ? (
          <div>
            <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: '#34d399', letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '.75rem' }}>Create New Password</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <input ref={recPw} type="password" className="auth-input" placeholder="Enter New Password" onKeyDown={onEnter(updatePassword)} />
              <button className="auth-btn" onClick={updatePassword}>Save Password</button>
            </div>
          </div>
        ) : method === 'password' ? (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {isSignUp && <input ref={signupName} type="text" className="auth-input" placeholder="Full Name" />}
              <input ref={epEmail} type="email" className="auth-input" placeholder="Email Address" onKeyDown={onEnter(loginEmailPassword)} />
              <input ref={epPw} type="password" className="auth-input" placeholder="Password" onKeyDown={onEnter(loginEmailPassword)} />
              <button className="auth-btn" onClick={loginEmailPassword}>{isSignUp ? 'Sign Up' : 'Login'}</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.75rem' }}>
              <button style={linkBtn} onClick={forgotPassword}>Forgot Password?</button>
              <button style={linkBtn} onClick={() => setIsSignUp((v) => !v)}>{isSignUp ? 'Back to Login' : 'Create Account'}</button>
            </div>
          </div>
        ) : method === 'otp' ? (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <input ref={eoEmail} type="email" className="auth-input" placeholder="Email Address" />
              <div className="otp-row" style={{ display: 'flex', gap: '.5rem' }}>
                <input ref={eoOtp} type="text" className="auth-input" placeholder="Enter 8-digit code" maxLength={8} style={{ flex: 1 }} />
                <button style={otpSend} onClick={sendEmailOTP}>{emailSendLabel}</button>
              </div>
              <button className="auth-btn" onClick={verifyEmailOTP}>Login with OTP</button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '.75rem' }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,.3)' }}>An 8-digit code will be sent to your email</span>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <input ref={smsPhone} type="tel" className="auth-input" placeholder="Phone Number (e.g. +60112345678)" />
              <div className="otp-row" style={{ display: 'flex', gap: '.5rem' }}>
                <input ref={smsOtp} type="text" className="auth-input" placeholder="Enter 8-digit code" maxLength={8} style={{ flex: 1 }} />
                <button style={otpSend} onClick={sendSmsOTP}>{smsSendLabel}</button>
              </div>
              <button className="auth-btn" onClick={verifySmsOTP}>Login with OTP</button>
            </div>
            <div style={{ textAlign: 'center', marginTop: '.75rem' }}>
              <span style={{ fontSize: '10px', color: 'rgba(255,255,255,.3)' }}>An 8-digit code will be sent via SMS to your phone</span>
            </div>
          </div>
        )}
      </div>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050a0e', padding: '1rem' }}>
      <div className="auth-bg"></div>
      <div className="scan-beam"></div>
      {children}
    </div>
  );
}

const toggleWrap = { display: 'flex', gap: '4px', background: 'rgba(255,255,255,.05)', borderRadius: '12px', padding: '4px', marginBottom: '1.5rem' };
const methodBtn = { flex: 1, padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: 900, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', border: 'none', background: 'none', borderRadius: '10px', cursor: 'pointer', transition: 'all .2s' };
const methodBtnActive = { background: 'rgba(16,185,129,.2)', color: '#34d399' };
const otpSend = { padding: '14px 18px', background: 'rgba(16,185,129,.2)', border: '1px solid rgba(16,185,129,.3)', color: '#34d399', fontSize: '11px', fontWeight: 900, letterSpacing: '.08em', textTransform: 'uppercase', borderRadius: '14px', cursor: 'pointer', whiteSpace: 'nowrap' };
const linkBtn = { background: 'none', border: 'none', color: 'rgba(167,243,208,.5)', fontSize: '11px', fontWeight: 600, cursor: 'pointer' };

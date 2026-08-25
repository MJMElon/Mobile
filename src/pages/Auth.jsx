import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { checkOpsAccess, rememberUser } from '../lib/auth';

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
      <Book title="Admin Portal" sub="MJM Nursery · Collection &amp; Delivery">
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
      </Book>
    );
  }

  const METHODS = [
    ['password', 'Password'],
    ['otp', 'Email code'],
    ['sms', 'SMS code'],
  ];

  return (
    <Book title="Admin Portal" sub="MJM Nursery · Collection &amp; Delivery">
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
            <div className="bk-row">
              <span className="bk-tag">New password</span>
              <input
                ref={recPw}
                type="password"
                className="bk-write"
                autoComplete="new-password"
                onKeyDown={onEnter(updatePassword)}
              />
            </div>
            <button className="bk-btn" onClick={updatePassword}>Save Password</button>
          </>
        ) : method === 'password' ? (
          <>
            {isSignUp && (
              <div className="bk-row">
                <span className="bk-tag">Name</span>
                <input ref={signupName} type="text" className="bk-write" autoComplete="name" />
              </div>
            )}

            <div className="bk-row">
              <span className="bk-tag">Email</span>
              <input
                ref={epEmail}
                type="email"
                className="bk-write"
                autoComplete="email"
                autoCapitalize="none"
                onKeyDown={onEnter(() => epPw.current?.focus())}
              />
            </div>

            <div className="bk-row">
              <span className="bk-tag">Password</span>
              <input
                ref={epPw}
                type={showPw ? 'text' : 'password'}
                className="bk-write"
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
            <div className="bk-row">
              <span className="bk-tag">Email</span>
              <input
                ref={eoEmail}
                type="email"
                className="bk-write"
                autoComplete="email"
                autoCapitalize="none"
              />
            </div>
            <div className="bk-row">
              <span className="bk-tag">Code</span>
              <input
                ref={eoOtp}
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="bk-write bk-code"
                onKeyDown={onEnter(verifyEmailOTP)}
              />
              <button className="bk-send" type="button" onClick={sendEmailOTP}>{emailSendLabel}</button>
            </div>
            <button className="bk-btn" onClick={verifyEmailOTP}>Sign In</button>
            <p className="bk-hint">An 8-digit code goes to your inbox.</p>
          </>
        ) : (
          <>
            <div className="bk-row">
              <span className="bk-tag">Phone</span>
              <input
                ref={smsPhone}
                type="tel"
                className="bk-write"
                autoComplete="tel"
                placeholder="+60112345678"
              />
            </div>
            <div className="bk-row">
              <span className="bk-tag">Code</span>
              <input
                ref={smsOtp}
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="bk-write bk-code"
                onKeyDown={onEnter(verifySmsOTP)}
              />
              <button className="bk-send" type="button" onClick={sendSmsOTP}>{smsSendLabel}</button>
            </div>
            <button className="bk-btn" onClick={verifySmsOTP}>Sign In</button>
            <p className="bk-hint">An 8-digit code goes to your phone.</p>
          </>
        )}
      </div>
    </Book>
  );
}

/* ══ The 555 exercise book, cover up ══
   Identical to the Auditor Portal's login and the FC Portal's but for the
   three --bk-cover values. Keep it that way: one book, a pile of colours. */
function Book({ title, sub, children }) {
  return (
    <div className="bk-page">
      <div className="bk-book">
        {/* the inside pages, showing past the cover */}
        <div className="bk-edges" aria-hidden="true"><i /><i /><i /></div>

        <div className="bk-cover">
          <div className="bk-smudge" aria-hidden="true" />

          <div className="bk-logo-wrap">
            <div className="bk-logo">555</div>
          </div>
          <div className="bk-portal">{title}</div>
          <div className="bk-portal-sub">{sub}</div>

          {children}

          <div className="bk-imprint">MJM Nursery · Mega Jutamas Sdn Bhd</div>
        </div>
      </div>

      <style>{`
        /* Caveat and DM Sans are linked from auth.html — see the head there. */
        .bk-page{
          --bk-cover:#a9cdb0; --bk-cover-2:#93bb9c; --bk-cover-3:#84ac8d;  /* Admin: green */
          --bk-ink:#23303f; --bk-print:#9c1c2c; --bk-red:#e23b4b; --bk-red-dark:#a5121f;
          --bk-hand:'Caveat','Bradley Hand','Segoe Script','Comic Sans MS',cursive;

          position:relative;min-height:100vh;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          padding:26px 16px 20px;
          font-family:'DM Sans',system-ui,sans-serif;
          color:var(--bk-ink);
          background:radial-gradient(ellipse at 50% 34%,#3a322b 0%,#221d19 62%,#14100e 100%);
          -webkit-font-smoothing:antialiased;
        }

        .bk-book{position:relative;width:100%;max-width:400px;animation:bkIn .5s ease both}
        @keyframes bkIn{from{opacity:0;transform:translateY(16px) scale(.985)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.bk-book{animation:none}}

        /* cream, yellow and green sheets stacked a little proud of the cover */
        .bk-edges{position:absolute;inset:0}
        .bk-edges i{
          position:absolute;top:7px;bottom:5px;border-radius:0 3px 3px 0;
          box-shadow:2px 2px 5px rgba(0,0,0,.35);
        }
        .bk-edges i:nth-child(1){right:-13px;width:15px;background:#d7dfb8}
        .bk-edges i:nth-child(2){right:-9px;width:13px;background:#f2ea9e;top:12px;bottom:10px}
        .bk-edges i:nth-child(3){right:-5px;width:11px;background:#fdf9e6;top:17px;bottom:15px}

        .bk-cover{
          position:relative;
          background:
            radial-gradient(ellipse at 32% 62%,rgba(255,255,255,.18),transparent 46%),
            radial-gradient(ellipse at 78% 18%,rgba(0,0,0,.05),transparent 52%),
            repeating-linear-gradient(101deg,rgba(255,255,255,.045) 0 2px,transparent 2px 6px),
            linear-gradient(160deg,var(--bk-cover) 0%,var(--bk-cover-2) 78%,var(--bk-cover-3) 100%);
          border-radius:3px 6px 6px 3px;
          padding:30px 26px 26px;
          box-shadow:0 26px 60px rgba(0,0,0,.55),
                     inset 0 0 0 1px rgba(255,255,255,.16),
                     inset 3px 0 0 rgba(0,0,0,.10);
          transform:rotate(-.4deg);
        }
        /* the fold, and the staple that holds it */
        .bk-cover::before{
          content:'';position:absolute;left:0;top:0;bottom:0;width:9px;
          background:linear-gradient(90deg,rgba(0,0,0,.16),transparent);
          border-radius:3px 0 0 3px;
        }
        /* the thumbed-over smudge every one of these books picks up */
        .bk-smudge{
          position:absolute;left:26%;top:56%;width:46%;height:15%;
          background:radial-gradient(ellipse,rgba(50,70,55,.13),transparent 68%);
          transform:rotate(-7deg);pointer-events:none;
        }

        .bk-logo-wrap{text-align:center;margin-bottom:4px}
        .bk-logo{
          display:inline-block;font-weight:900;font-size:74px;line-height:.9;
          letter-spacing:-.02em;font-style:italic;color:var(--bk-red);
          -webkit-text-stroke:1.5px #fff5f6;paint-order:stroke fill;
          text-shadow:
            1px 1px 0 var(--bk-red-dark),2px 2px 0 var(--bk-red-dark),
            3px 3px 0 var(--bk-red-dark),4px 4px 0 var(--bk-red-dark),
            5px 5px 0 #8e0f1b,6px 6px 0 #8e0f1b,
            7px 7px 0 #7a0c17,8px 8px 0 #7a0c17,
            10px 12px 16px rgba(80,6,14,.4);
          transform:rotate(-1.2deg);
        }
        .bk-portal{
          margin-top:12px;text-align:center;
          font-size:12px;font-weight:900;letter-spacing:.34em;text-transform:uppercase;
          color:var(--bk-print);
        }
        .bk-portal-sub{
          margin-top:5px;text-align:center;
          font-size:9.5px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
          color:rgba(35,48,63,.45);
        }

        /* the three ways in, printed like a subject line */
        .bk-tabs{
          display:flex;justify-content:center;gap:14px;
          margin-top:26px;padding-bottom:2px;
        }
        .bk-tab{
          background:none;border:none;padding:2px 1px 3px;cursor:pointer;
          font-family:'DM Sans',sans-serif;
          font-size:9.5px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;
          color:rgba(35,48,63,.42);
          border-bottom:2px solid transparent;
        }
        .bk-tab:hover{color:rgba(35,48,63,.7)}
        .bk-tab-on{color:var(--bk-print);border-bottom-color:var(--bk-red)}

        /* the fill-in lines, the way the cover asks for your name */
        .bk-lines{margin-top:30px}
        .bk-row{
          display:flex;align-items:flex-end;gap:7px;
          border-bottom:2px dotted rgba(35,48,63,.4);
          padding-bottom:2px;margin-bottom:17px;
        }
        .bk-row:focus-within{border-bottom-color:rgba(35,48,63,.8)}
        .bk-tag{
          flex:0 0 auto;
          font-family:Georgia,'Times New Roman',serif;
          font-size:15px;font-weight:700;color:var(--bk-print);
          padding-bottom:5px;white-space:nowrap;text-transform:lowercase;
        }
        .bk-tag::first-letter{text-transform:uppercase}
        .bk-write{
          flex:1 1 auto;min-width:0;height:34px;
          border:0;background:transparent;outline:none;
          font-family:var(--bk-hand);font-size:23px;color:var(--bk-ink);
          padding:0 2px;border-radius:0;-webkit-appearance:none;
        }
        .bk-write::placeholder{
          font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(35,48,63,.3);
        }
        .bk-code{letter-spacing:.12em}

        .bk-eye{flex:0 0 auto;background:none;border:none;padding:4px 0 6px 4px;cursor:pointer}
        .bk-eye svg{
          width:17px;height:17px;
          stroke:rgba(35,48,63,.45);fill:none;stroke-width:1.7;
          stroke-linecap:round;stroke-linejoin:round;transition:stroke .15s;
        }
        .bk-eye:hover svg{stroke:var(--bk-ink)}

        .bk-send{
          flex:0 0 auto;align-self:center;margin-bottom:4px;
          background:rgba(35,48,63,.07);border:1.5px solid rgba(35,48,63,.28);
          border-radius:7px 5px 8px 4px / 5px 8px 4px 7px;
          padding:6px 10px;cursor:pointer;white-space:nowrap;
          font-family:'DM Sans',sans-serif;
          font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;
          color:var(--bk-ink);
        }
        .bk-send:hover{background:rgba(35,48,63,.13)}

        .bk-btn{
          width:100%;height:50px;margin-top:22px;
          background:var(--bk-red-dark);color:#fff3f4;
          border:2px solid rgba(90,6,14,.9);
          border-radius:10px 7px 12px 6px / 7px 12px 6px 10px;
          box-shadow:3px 3px 0 rgba(70,5,12,.35);
          transform:rotate(-.5deg);
          font-family:'DM Sans',sans-serif;
          font-size:13px;font-weight:900;letter-spacing:.2em;text-transform:uppercase;
          cursor:pointer;transition:transform .12s,box-shadow .12s,background .15s;
        }
        .bk-btn:hover{background:#bd1524}
        .bk-btn:active{transform:rotate(-.5deg) translate(3px,3px);box-shadow:0 0 0}
        .bk-btn:disabled{opacity:.65;cursor:default;transform:rotate(-.5deg)}

        .bk-links{display:flex;align-items:baseline;margin-top:16px}
        .bk-link{
          font-family:var(--bk-hand);font-size:18px;color:var(--bk-ink);
          background:none;border:none;
          border-bottom:1.5px dashed rgba(35,48,63,.4);
          padding:0 1px;cursor:pointer;
        }
        .bk-link:hover{color:var(--bk-print);border-bottom-color:rgba(156,28,44,.6)}
        .bk-link-right{margin-left:auto}

        .bk-hint{
          margin-top:12px;text-align:center;
          font-size:10px;font-weight:600;color:rgba(35,48,63,.42);
        }

        /* whatever the system has to say, written on the line in pen */
        .bk-note{
          font-family:var(--bk-hand);font-size:19px;line-height:1.15;
          padding:2px 2px 4px;margin-bottom:14px;border-bottom:2px solid;
        }
        .bk-err{color:#8f1120;border-bottom-color:rgba(143,17,32,.45);animation:bkShake .35s ease}
        .bk-ok{color:#12603f;border-bottom-color:rgba(18,96,63,.45)}
        @keyframes bkShake{
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-6px)}40%{transform:translateX(6px)}
          60%{transform:translateX(-4px)}80%{transform:translateX(4px)}
        }
        @media (prefers-reduced-motion:reduce){.bk-err{animation:none}}

        /* a note slipped inside the cover */
        .bk-slip{
          margin-top:30px;
          background:#fffdf3;
          border-radius:2px 4px 3px 5px;
          padding:18px 18px 16px;
          box-shadow:0 6px 18px rgba(0,0,0,.22),inset 0 0 0 1px rgba(0,0,0,.05);
          transform:rotate(.6deg);
        }
        .bk-slip-head{
          font-family:var(--bk-hand);font-size:26px;color:#8f1120;
          border-bottom:2px solid rgba(143,17,32,.35);
          padding-bottom:2px;margin-bottom:10px;
        }
        .bk-slip-body{font-size:12.5px;line-height:1.6;color:#4a5560;margin:0 0 12px}
        .bk-slip-email{
          font-family:var(--bk-hand);font-size:19px;color:var(--bk-ink);
          border-bottom:2px dotted rgba(35,48,63,.35);
          padding-bottom:3px;word-break:break-all;
        }
        .bk-slip-email span{
          display:block;font-family:'DM Sans',sans-serif;
          font-size:8.5px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;
          color:rgba(35,48,63,.42);margin-bottom:1px;
        }
        .bk-slip-acts{display:flex;align-items:baseline;margin-top:14px}

        .bk-imprint{
          margin-top:20px;text-align:center;
          font-size:8px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;
          color:rgba(35,48,63,.35);
        }

        @media (max-width:360px){
          .bk-cover{padding:26px 20px 22px}
          .bk-logo{font-size:64px}
          .bk-portal{letter-spacing:.26em;font-size:11px}
          .bk-tabs{gap:10px}
        }
        @media (min-height:800px){
          .bk-lines{margin-top:44px}
          .bk-cover{padding-top:40px;padding-bottom:32px}
        }
      `}</style>
    </div>
  );
}

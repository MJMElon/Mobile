/* A CUSTOMER DOES NOT GET INTO THE ADMIN PORTAL. NOT EVEN ON A BAD LINE.

   "All staff system. Customer only can see sales web and customer portal."
   A Sales Web customer signs in on the same Supabase project as staff, so
   their login works here too. What tells them apart is
   shared_profiles.user_type = 'customer', and a read that SUCCEEDS and says
   so is refused, signed out, and shown one sentence pointing at the shop.

   The other half is what the gate did when the read FAILED: the dashboard
   and AuthGate let the person in, and a null profile drew every tile. A
   supabase-js refusal is RETURNED as {error}, not thrown, so that was most
   failures. Now:
     - a cached profile for the SAME user id carries staff through a dropped
       line (field use);
     - with none, nothing is entered, no tile is drawn, the session is kept
       and Try again is offered.

   This drives the REAL build in a real browser against a stubbed Supabase:
   every route below is the network the page actually asks.

   Run: node tests/customers_cannot_enter_the_admin_portal.cjs              */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SB = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SB_KEY = 'sb-kibqjztozokohqmhqqqf-auth-token';
const REFUSAL = 'This is the MJM Nursery staff system. Customer accounts cannot sign in here. ' +
  'Please use the MJM Nursery shop at https://www.mjmnursery.com';
const CHECK_FAILED = 'We could not check your account just now. Please check your connection and try again.';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) +
                             '\n         want ' + JSON.stringify(want)); }
}

/* ── the build, into a directory of its own (dist is not touched) ── */
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'mjm-mobile-gate-'));
execSync('npx vite build --outDir ' + JSON.stringify(OUT) + ' --emptyOutDir', { cwd: ROOT, stdio: 'ignore' });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(OUT, p);
  if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function sessionFor(uid, email) {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const token = b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url({ sub: uid, email, exp, role: 'authenticated', aud: 'authenticated' }) + '.sig';
  return {
    access_token: token, token_type: 'bearer', expires_in: 86400, expires_at: exp, refresh_token: 'r-' + uid,
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email, user_metadata: { full_name: email },
            app_metadata: { provider: 'email' }, created_at: '2026-01-01T00:00:00Z' },
  };
}

const STAFF = { role: 'user', user_type: 'staff', permissions: { modules: { mobile: 'normal' } } };
const CUSTOMER = { role: 'user', user_type: 'customer', permissions: { modules: { sales: 'normal' } } };

/* profile: an object to answer with, or 'error' for a returned {error}. */
async function open(browser, { page, profile, session, cache, before }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const seen = { logout: 0, profileReads: 0 };
  // Routes match in REVERSE registration order — catch-all FIRST.
  await p.route(SB + '/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p.route(SB + '/rest/v1/shared_profiles*', (r) => {
    seen.profileReads++;
    const cur = typeof profile === 'function' ? profile() : profile;
    if (cur === 'error') {
      return r.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST000', message: 'upstream unavailable', details: null, hint: null }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cur) });
  });
  await p.route(SB + '/auth/v1/logout*', (r) => { seen.logout++; r.fulfill({ status: 204, body: '' }); });
  if (before) await before(p, seen);
  await p.addInitScript(([key, sess, cacheVal]) => {
    if (sessionStorage.getItem('__seeded')) return; // seed once, not on every reload
    sessionStorage.setItem('__seeded', '1');
    if (sess) localStorage.setItem(key, JSON.stringify(sess));
    if (cacheVal) localStorage.setItem('mjm_mobile_profile_v1', JSON.stringify(cacheVal));
  }, [SB_KEY, session || null, cache || null]);
  await p.goto(base + '/' + page);
  return { ctx, p, seen };
}

const text = (p) => p.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
const tiles = (p) => p.evaluate(() => [...document.querySelectorAll('a.module-card')].map((a) => a.getAttribute('href')));
const tokenKept = (p) => p.evaluate((k) => !!localStorage.getItem(k), SB_KEY);
const cacheOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('mjm_mobile_profile_v1') || '{}'));
const settle = (p) => p.waitForTimeout(900);

let base;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const cust = sessionFor('u-customer', 'buyer@example.com');
    const staff = sessionFor('u-staff', 'staff@mjm.test');

    console.log('\n── 1. A customer opening the dashboard with a session ──');
    {
      const { ctx, p, seen } = await open(browser, { page: 'index.html', profile: CUSTOMER, session: cust });
      await p.waitForSelector('[data-notice="customer"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      const t = await text(p);
      check('the refusal, word for word', t.includes(REFUSAL), true);
      check('no tile is drawn', await tiles(p), []);
      check('no sign-in form either — only the refusal', await p.locator('input[type=password]').count(), 0);
      check('signed out with Supabase', seen.logout >= 1, true);
      check('and the session is gone from the phone', await tokenKept(p), false);
      check('nothing about them is cached', await cacheOf(p), {});
      await ctx.close();
    }

    console.log('\n── 2. A customer sent to a page behind AuthGate ──');
    {
      const { ctx, p, seen } = await open(browser, { page: 'consent.html', profile: CUSTOMER, session: cust });
      await p.waitForSelector('[data-notice="customer"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('the page says the refusal', (await text(p)).includes(REFUSAL), true);
      check('and stays on it rather than bouncing to the login', new URL(p.url()).pathname, '/consent.html');
      check('signed out', seen.logout >= 1, true);
      check('session gone', await tokenKept(p), false);
      await ctx.close();
    }

    console.log('\n── 3. A customer on auth.html with a session, and signing in with a code ──');
    {
      const { ctx, p, seen } = await open(browser, { page: 'auth.html', profile: CUSTOMER, session: cust });
      await p.waitForSelector('[data-notice="customer"]', { timeout: 15000 }).catch(() => {});
      check('auth.html refuses on load', (await text(p)).includes(REFUSAL), true);
      check('and signs out', seen.logout >= 1, true);
      await ctx.close();
    }
    {
      const { ctx, p, seen } = await open(browser, {
        page: 'auth.html', profile: CUSTOMER, session: null,
        before: (pg) => pg.route(SB + '/auth/v1/verify*', (r) =>
          r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cust) })),
      });
      await p.click('button.bk-tab:has-text("Email code")');
      await p.fill('input[placeholder="Email Address"]', 'buyer@example.com');
      await p.fill('input[placeholder="8-digit code"]', '12345678');
      await p.click('button.bk-btn:has-text("Sign In")');
      await p.waitForSelector('[data-notice="customer"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('an email code sign-in is refused', (await text(p)).includes(REFUSAL), true);
      check('and signed out', seen.logout >= 1, true);
      check('session gone', await tokenKept(p), false);
      await ctx.close();
    }
    {
      const { ctx, p, seen } = await open(browser, {
        page: 'index.html', profile: CUSTOMER, session: null,
        before: (pg) => pg.route(SB + '/auth/v1/token*', (r) =>
          r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cust) })),
      });
      await p.waitForSelector('input[type=password]', { timeout: 15000 });
      await p.fill('input[type=email]', 'buyer@example.com');
      await p.fill('input[type=password]', 'secret123');
      await p.click('button.bk-btn');
      await p.waitForSelector('[data-notice="customer"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('a password sign-in on the dashboard is refused', (await text(p)).includes(REFUSAL), true);
      check('with no tile', await tiles(p), []);
      check('and signed out', seen.logout >= 1, true);
      // Sealing is slow on purpose (PBKDF2); give it time to finish and be undone.
      await p.waitForTimeout(2500);
      check('and no offline sign-in copy of them is left on the phone',
            await p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mjm_offline_vault_v1') || '{}'))), []);
      await ctx.close();
    }

    console.log('\n── 4. A read that RETURNS {error}, nothing cached ──');
    {
      let answer = 'error';
      const { ctx, p, seen } = await open(browser, { page: 'index.html', profile: () => answer, session: staff });
      await p.waitForSelector('[data-notice="unknown"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('says it could not check', (await text(p)).includes(CHECK_FAILED), true);
      check('draws no tile', await tiles(p), []);
      check('does not sign out', seen.logout, 0);
      check('keeps the session', await tokenKept(p), true);
      check('offers Try again', await p.locator('[data-retry]').count(), 1);
      answer = STAFF;
      await p.click('[data-retry]');
      await p.waitForSelector('a.module-card', { timeout: 15000 }).catch(() => {});
      check('and Try again with the line back enters', (await tiles(p)).length, 4);
      await ctx.close();
    }
    {
      const { ctx, p, seen } = await open(browser, { page: 'consent.html', profile: 'error', session: staff });
      await p.waitForSelector('[data-notice="unknown"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('AuthGate does not let them in either', (await text(p)).includes(CHECK_FAILED), true);
      check('no sign out', seen.logout, 0);
      check('session kept', await tokenKept(p), true);
      await ctx.close();
    }
    {
      // Someone ELSE's cached profile is not an answer about this person.
      const { ctx, p } = await open(browser, {
        page: 'index.html', profile: 'error', session: staff,
        cache: { 'u-other': { profile: STAFF, at: Date.now() } },
      });
      await p.waitForSelector('[data-notice="unknown"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('a cached profile for a DIFFERENT user does not let them in', await tiles(p), []);
      await ctx.close();
    }
    for (const [label, cached] of [
      ['a cached CUSTOMER profile (an older cache kept everybody)', CUSTOMER],
      ['a cached profile with no staff access of its own', { role: 'user', user_type: 'staff', permissions: {} }],
    ]) {
      const { ctx, p, seen } = await open(browser, {
        page: 'index.html', profile: 'error', session: staff,
        cache: { 'u-staff': { profile: cached, at: Date.now() } },
      });
      await p.waitForSelector('[data-notice="unknown"]', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check(label + ' is no answer: could not check', (await text(p)).includes(CHECK_FAILED), true);
      check('  and no tile', await tiles(p), []);
      check('  and the session kept', [seen.logout, await tokenKept(p)], [0, true]);
      await ctx.close();
    }

    console.log('\n── 5. A read that fails, with this user\'s profile cached ──');
    {
      const { ctx, p, seen } = await open(browser, {
        page: 'index.html', profile: 'error', session: staff,
        cache: { 'u-staff': { profile: { ...STAFF, permissions: { ...STAFF.permissions,
          mobile_actions: { booking: { view: false } } } }, at: Date.now() } },
      });
      await p.waitForSelector('a.module-card', { timeout: 15000 }).catch(() => {});
      await settle(p);
      check('enters, on the cached answer, with the office\'s ticks honoured',
            await tiles(p), ['do_signing.html', 'consent.html', 'seal.html']);
      check('no sign out', seen.logout, 0);
      await ctx.close();
    }
    {
      const { ctx, p } = await open(browser, {
        page: 'consent.html', profile: 'error', session: staff,
        cache: { 'u-staff': { profile: STAFF, at: Date.now() } },
      });
      await settle(p); await settle(p);
      check('AuthGate lets them on to the page', (await text(p)).includes(CHECK_FAILED), false);
      check('and stays on it', new URL(p.url()).pathname, '/consent.html');
      await ctx.close();
    }

    console.log('\n── 6. Staff, as before ──');
    {
      const { ctx, p, seen } = await open(browser, { page: 'index.html', profile: STAFF, session: staff });
      await p.waitForSelector('a.module-card', { timeout: 15000 }).catch(() => {});
      check('every tile, as it has always been', await tiles(p),
            ['do_signing.html', 'consent.html', 'booking.html', 'seal.html']);
      check('not signed out', seen.logout, 0);
      check('and the profile is kept for a bad line later', !!(await cacheOf(p))['u-staff'], true);
      await ctx.close();
    }
    {
      const { ctx, p } = await open(browser, { page: 'index.html', profile: { role: 'user', user_type: 'staff', permissions: {} }, session: staff });
      const reached = await p.waitForFunction(
        () => location.pathname === '/auth.html' && /Access pending/i.test(document.body.textContent),
        null, { timeout: 15000, polling: 200 }).then(() => true, () => false);
      if (!reached) console.log('  DEBUG', p.url(), (await text(p)).slice(0, 200));
      check('staff with no access still goes to the Pending notice', reached, true);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  console.log('\n' + (fail ? 'FAILURES: ' + fail + ' (passed ' + pass + ')' : 'all good — ' + pass + ' checks'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

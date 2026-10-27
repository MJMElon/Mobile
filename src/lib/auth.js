import { supabase } from './supabase';
import { forgetOffline } from './offlineVault.js';

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/* The session Supabase already has in this browser, read directly out of
   storage rather than through supabase.auth.getSession(). Needed as a
   fallback for one case: getSession() (and the INITIAL_SESSION event that
   comes with it) answers null both when nobody has ever signed in AND when a
   token had expired and the refresh it tried failed — no network, or a slow
   one. An admin who signed in this morning should not be bounced to a login
   page for either.

   An EXPIRED token is trusted, deliberately, online and off — same rule as
   the FC Portal's AuthContext. Signed in is meant to be a state you stay
   in: the login page comes back for a pressed Sign Out or a server that
   actually refused the refresh token (that raises SIGNED_OUT, which is
   still honoured), never for a clock. Offline a stale token goes nowhere
   without a network to carry it; online supabase-js refreshes it in the
   background and replaces what this painted. RLS is what actually protects
   a table — this only decides what to draw. */
export function cachedSession() {
  try {
    const key = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    if (!key) return null;
    const raw = JSON.parse(localStorage.getItem(key));
    const s = (raw && (raw.currentSession || raw)) || null;
    if (!s || !s.access_token || !s.user) return null;
    return s;
  } catch (e) {
    return null;
  }
}

// ── Ops-access gate ───────────────────────────────────────────
// Same predicate as the hub and audit. A signed-in user must have at least
// one staff-grade module permission to use the ops portal. Customers who
// cross over from sales-web, and fresh signups the admin hasn't granted
// access to yet, are kept out.
const STAFF_LEVELS = ['admin', 'normal', 'view', 'edit', 'manage', 'read', 'write', 'full', 'staff'];

export function hasOpsAccess(profile) {
  if (!profile) return false;
  const p = profile.permissions || {};
  if (p.manage_users || p.can_verify_operation) return true;
  if (p.modules && typeof p.modules === 'object') {
    for (const k in p.modules) {
      if (p.modules[k] && STAFF_LEVELS.indexOf(String(p.modules[k]).toLowerCase()) !== -1) return true;
    }
  }
  return false;
}

/* ── Which of the Admin Portal's three screens this person may open ──────
 *
 * Granted from the office: 555 MJM Team → User Access → Admin Portal, which
 * writes `permissions.mobile_actions.<page>.view` — the same shape every
 * other module on that site stores per-page access in, and the same shape
 * MJMAccess.canDo('mobile', page, 'view') reads back there. This is this
 * app's copy of that read. SHARED RULE: mjm-ai-system scan/scan_user_access
 * .html is the screen that writes it. Change one, change the other.
 *
 * ABSENT MEANS NOBODY HAS BEEN ASKED, and that is a yes — the house rule
 * everywhere in this system (see "Access fails OPEN" in CLAUDE.md). Three
 * tiles that have been open to every ops account since this app was written
 * must not close themselves the day a screen to tick them appears; they
 * close when somebody actually unticks one.
 */
export function canOpenAdminPage(profile, page) {
  /* A profile nobody could read is NOT "nobody has been asked". Absent
     mobile_actions on a profile that WAS read is the yes below; no profile
     at all is no answer, and no answer must never draw every tile — that is
     how a failed read used to put the whole portal in front of anybody. */
  if (!profile || typeof profile !== 'object') return false;
  if (!page) return true;
  const acts = (profile.permissions || {}).mobile_actions;
  const entry = acts && acts[page];
  if (!entry || typeof entry !== 'object') return true;
  return !!entry.view;
}

/* ── Customers are not staff, whatever else their row says ─────────────
 *
 * "All staff system. Customer only can see sales web and customer portal."
 * A Sales Web customer signs in on the SAME Supabase project, so their login
 * works here too; what tells them apart is shared_profiles.user_type. A read
 * that SUCCEEDS and says 'customer' is refused, signed out and told where the
 * shop is — on every sign-in route and every page load with a session. */
export const CUSTOMER_REFUSAL =
  'This is the MJM Nursery staff system. Customer accounts cannot sign in here. ' +
  'Please use the MJM Nursery shop at https://www.mjmnursery.com';
export const SHOP_URL = 'https://www.mjmnursery.com';
export const CHECK_FAILED =
  'We could not check your account just now. Please check your connection and try again.';

export function isCustomer(profile) {
  return !!profile && String(profile.user_type || '').trim().toLowerCase() === 'customer';
}

/* The last profile this phone READ for each user id. It is what lets a
   member of staff who opened the portal this morning carry on when the line
   drops (field use, flaky signal) — and ONLY that same user id: a cached
   answer about one person is never an answer about another. A customer is
   never kept. */
const PROFILE_CACHE = 'mjm_mobile_profile_v1';

function readProfileCache() {
  try { return JSON.parse(localStorage.getItem(PROFILE_CACHE)) || {}; } catch (e) { return {}; }
}
export function cachedProfile(uid) {
  if (!uid) return null;
  const e = readProfileCache()[uid];
  return e && e.profile && typeof e.profile === 'object' ? e.profile : null;
}
function rememberProfile(uid, profile) {
  if (!uid || !profile || isCustomer(profile)) return;
  try {
    const all = readProfileCache();
    all[uid] = { profile, at: Date.now() };
    localStorage.setItem(PROFILE_CACHE, JSON.stringify(all));
  } catch (e) { /* full or refused storage — the online path is unaffected */ }
}
export function forgetProfile(uid) {
  try {
    const all = readProfileCache();
    if (uid) delete all[uid];
    localStorage.setItem(PROFILE_CACHE, JSON.stringify(all));
  } catch (e) { /* nothing to do */ }
}

/* One read of the profile. A returned {error} is a failure exactly like a
   thrown one — supabase-js reports a refusal or a dead line by RETURNING it,
   so a check that only catches throws treats most failures as success. */
async function readProfile(session) {
  try {
    const resp = await supabase
      .from('shared_profiles')
      .select('role, user_type, permissions')
      .eq('id', session.user.id)
      .maybeSingle();
    if (!resp || resp.error) {
      console.warn('[mjm-gate] profile read failed:', resp && resp.error);
      return { ok: false, profile: null };
    }
    return { ok: true, profile: resp.data || null };
  } catch (e) {
    console.warn('[mjm-gate] profile read failed:', e);
    return { ok: false, profile: null };
  }
}

/* Decide what this session may do. One answer, read by every door:
 *   'customer' — a Sales Web customer: refuse, sign out, point at the shop
 *   'unknown'  — the read failed and this phone has nothing for this user:
 *                do not enter, draw no tiles, keep the session, offer retry
 *   'pending'  — staff account with no staff access yet: the Pending notice
 *   'page'     — holds the portal, not this screen of it
 *   'ok'       — in
 * `profile` is whatever the answer was decided on (fresh or cached). */
export async function resolveAccess(session, { page = null } = {}) {
  const uid = session && session.user && session.user.id;
  const r = await readProfile(session);
  let profile;
  let fromCache = false;
  if (r.ok) {
    profile = r.profile;
    if (isCustomer(profile)) {
      forgetProfile(uid);
      return { state: 'customer', profile, fromCache };
    }
    if (profile) rememberProfile(uid, profile);
    else forgetProfile(uid);
  } else {
    /* A cached answer is trusted only when it could have let them in on its
       own: the same user id, not a customer, and staff access of its own.
       Anything else — including a cache written by an older version for
       everybody, customers among them — is no answer at all. */
    const cached = cachedProfile(uid);
    if (!cached || isCustomer(cached) || !hasOpsAccess(cached)) {
      return { state: 'unknown', profile: null, fromCache: true };
    }
    profile = cached;
    fromCache = true;
  }
  if (!hasOpsAccess(profile)) return { state: 'pending', profile, fromCache };
  if (page && !canOpenAdminPage(profile, page)) return { state: 'page', profile, fromCache };
  return { state: 'ok', profile, fromCache };
}

/* Kept for anything that only wants a yes or no. It no longer fails open:
   an unknown answer is a no. */
export async function checkOpsAccess(session, { page = null } = {}) {
  const a = await resolveAccess(session, { page });
  return a.state === 'ok';
}

/* A customer is signed out of THIS portal and every trace of them on this
   phone goes with it. Local scope: their Sales Web sign-in on other devices
   is theirs, and nothing here should end it. */
export async function refuseCustomer(session) {
  const uid = session && session.user && session.user.id;
  forgetProfile(uid);
  // Their sealed offline copy too, or a no-line sign-in puts it back.
  try { if (session && session.user && session.user.email) forgetOffline(session.user.email); } catch (e) { /* */ }
  // Ask Supabase FIRST, while the token is still where it can find it —
  // signOutLocal wipes the sb- keys before its own call, so on its own it
  // would end the session on the phone and never tell the server.
  try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) { /* offline: the local wipe below still happens */ }
  await signOutLocal();
}

export function rememberUser(session) {
  if (!session?.user) return;
  sessionStorage.setItem('mjm_user_email', session.user.email || '');
  sessionStorage.setItem(
    'mjm_user_name',
    session.user.user_metadata?.full_name || session.user.email || '',
  );
}

export function displayName(session) {
  return session?.user?.user_metadata?.full_name || session?.user?.email || '—';
}

// Clear local Supabase tokens + session storage, then sign out locally.
export async function signOutLocal() {
  Object.keys(localStorage).forEach((k) => {
    if (k.startsWith('sb-')) localStorage.removeItem(k);
  });
  sessionStorage.clear();
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (e) {
    /* ignore */
  }
}

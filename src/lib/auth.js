import { supabase } from './supabase';

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

// Read the profile and decide access. `failClosed` controls the default when
// the profile read errors: entry points (login) fail closed so customers
// don't slip through; interior pages fail open so a brief Supabase hiccup
// doesn't lock real admins out.
export async function checkOpsAccess(session, { failClosed = false } = {}) {
  let profile = null;
  let readOk = false;
  try {
    const resp = await supabase
      .from('shared_profiles')
      .select('role, user_type, permissions')
      .eq('id', session.user.id)
      .maybeSingle();
    if (resp && !resp.error) {
      readOk = true;
      profile = resp.data;
    }
  } catch (e) {
    console.warn('[mjm-gate] profile read failed:', e);
  }
  if (!readOk) return !failClosed; // fail open/closed per caller
  return hasOpsAccess(profile);
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

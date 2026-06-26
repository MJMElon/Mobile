-- ============================================================================
--  RLS LOCKDOWN — block the anonymous public from the shared tables
-- ============================================================================
--  PROBLEM: the Supabase "anon" key ships in every web app's code (this is
--  normal and unavoidable for browser apps). Without Row Level Security (RLS),
--  ANYONE with that key can read every row over the public REST API — no login
--  required. A scan on 2026-06-26 confirmed all 7 tables below were readable by
--  anonymous requests.
--
--  FIX: turn RLS on and allow ONLY logged-in (authenticated) users. Every MJM
--  app — mobile, sales-web (customers log in too), the hub, and audit — signs
--  users in, so they keep working. The anonymous public gets nothing.
--  Server-side Edge Functions use the service_role key, which bypasses RLS, so
--  email/payment functions are unaffected.
--
--  HOW TO RUN: Supabase Dashboard → SQL Editor → paste → Run.
--
--  ⚠️ FOLLOW-UP (phase 2, recommended): this policy lets ANY logged-in user read
--  ALL rows. For customer-facing sales-web that means one customer could query
--  another customer's rows directly. Tightening to per-owner row policies is a
--  larger, app-specific change — do it after confirming this lockdown is stable.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'shared_al_orders',
    'shared_collection_bookings',
    'shared_plots',
    'shared_breeds',
    'shared_do_records',
    'shared_profiles',
    'mobile_consent_records'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      t || '_authenticated_all', t
    );
  end loop;
end $$;

-- ============================================================================
--  ROLLBACK (only if a logged-in app unexpectedly breaks) — turns RLS back off:
-- ============================================================================
-- do $$
-- declare
--   t text;
--   tables text[] := array[
--     'shared_al_orders','shared_collection_bookings','shared_plots',
--     'shared_breeds','shared_do_records','shared_profiles','mobile_consent_records'
--   ];
-- begin
--   foreach t in array tables loop
--     execute format('alter table public.%I disable row level security;', t);
--   end loop;
-- end $$;

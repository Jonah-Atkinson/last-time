-- =====================================================================
-- Last Time — 0002: explicit table privileges
--
-- Why this exists: 0001 assumed Supabase automatically grants table
-- access to the `authenticated` role. This project doesn't (newer
-- Supabase projects can be created without auto-exposing tables), so
-- logged-in users had no access at all and rls_check.sql failed with
-- "permission denied for table profiles".
--
-- Two layers decide what a user can do, and BOTH must allow it:
--   1. GRANT  = which ACTIONS a role may attempt on a table at all
--   2. RLS    = which ROWS those actions can touch
-- 0001 built layer 2. This file builds layer 1, explicitly, with only
-- the actions the app needs (least privilege), instead of relying on a
-- platform default that can differ between projects.
--
-- Rule: never edit a migration that has already run somewhere. Fix
-- forward with a new one, like this.
-- =====================================================================

-- Start from zero on every app table, whatever the platform defaults were
revoke all on public.profiles, public.categories, public.tasks, public.completions
  from anon, authenticated;

-- profiles: read and update only (created by the sign-up trigger,
-- deleted with the auth user)
grant select, update on public.profiles to authenticated;

-- everything else: full CRUD, still limited to own rows by RLS
grant select, insert, update, delete
  on public.categories, public.tasks, public.completions
  to authenticated;

-- anon keeps nothing. No TRUNCATE, REFERENCES or TRIGGER for anyone.

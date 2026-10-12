-- =====================================================================
-- Last Time — 0004: column-level INSERT/UPDATE on categories and tasks
--
-- Slice 3 review finding (Jonah, 12 Oct 2026): 0002 granted INSERT and
-- UPDATE on every column of tasks and categories. RLS keeps a user inside
-- their OWN rows, but inside those rows the browser could write values
-- only the server should own:
--   tasks.created_at -> completions_guard (0001) refuses done_at earlier
--                       than the task's created_at. Rewrite created_at to
--                       2020 and that guard moves with it: backdated
--                       completions all the way to 2020 = a fake history
--                       and a fake streak.
--   created_at on categories, id and user_id on both tables -> nothing
--                       the app ever needs to send, so nothing to grant.
--
-- Same three layers as 0003 (profiles), and ALL must allow a write:
--   1. GRANT (columns) = which columns may be written at all
--   2. RLS             = which rows (your own)
--   3. CHECK / trigger = which values
--
-- completions is left alone here: its grants get the same treatment in
-- Slice 4, together with the "backdate only within the grace window" rule.
-- =====================================================================

-- Revoking at the table level also clears any column-level grants, so
-- this starts from zero. SELECT and DELETE are untouched.
revoke insert, update on public.categories, public.tasks from authenticated;

-- categories: the three things a person picks. Not id, user_id, created_at.
grant insert (name, color, icon) on public.categories to authenticated;
grant update (name, color, icon) on public.categories to authenticated;

-- tasks, insert: what the "new routine" form sends. A new task always
-- starts active, so archived is not insertable (the default is false).
grant insert (category_id, name, schedule_type, interval_days, weekday,
              month_day, due_time, notes)
  on public.tasks to authenticated;

-- tasks, update: the same fields plus archived (archive / unarchive).
-- Not id, user_id, created_at.
grant update (category_id, name, schedule_type, interval_days, weekday,
              month_day, due_time, notes, archived)
  on public.tasks to authenticated;

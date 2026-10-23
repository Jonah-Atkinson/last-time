-- =====================================================================
-- Last Time — 0005: completion rules (Slice 4)
--
-- Product rules (Jonah, 23 Oct 2026):
--   1. Backdate limit is counted in CALENDAR DAYS in the user's time zone
--      ("yesterday" means yesterday), from the moment the completion was
--      LOGGED. Limit = 15% of the routine's interval, rounded down,
--      capped at 5 days, never less than 1 day:
--         every 1-7 days -> 1 day   every 30 -> 4   every 34+ -> 5
--      Weekly routines count as 7 days, monthly as 30 (spec v1.6).
--   2. After logging, the note AND done_at can be edited, but done_at
--      stays inside the window measured from the original logged_at,
--      and can never move later than logged_at. (Moving an old
--      completion FORWARD would fill a gap and fake a streak.)
--   3. A completion can be deleted only within 10 minutes of logging
--      (an undo). After that it is part of the record.
--      Deleting a whole routine still deletes its history (the foreign
--      key cascade is not subject to RLS).
--
-- ACCEPTED RISK (risk owner: Jonah, 23 Oct 2026):
--   profiles.timezone is browser-writable (0003), and rule 1 trusts it.
--   A user can pick a time zone where it is just before midnight, which
--   makes "yesterday" start almost 48 hours ago instead of 24-48. Max
--   gain: under 1 extra day of backdating, on their OWN data only.
--   Accepted for user experience (travelers must be able to change
--   their time zone).
--   Compensating control: a hard ceiling that ignores time zones
--   entirely: done_at can never be more than (limit + 1) days + 1 hour
--   before logged_at (the hour covers daylight-saving days). It does not
--   shrink the 1-day gain; it guarantees the gain can never be MORE than
--   that, whatever the time zone math does.
--
-- Same three layers as 0003 and 0004, and ALL must allow a write:
--   1. GRANT (columns) = which columns may be written at all
--   2. RLS             = which rows (your own; delete only if fresh)
--   3. trigger         = which values (the date rules above)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Column grants. Revoking at the table level also clears any
--    column-level grants, so this starts from zero. SELECT and DELETE
--    are untouched (DELETE is limited by the new policy in part 2).
-- ---------------------------------------------------------------------
revoke insert, update on public.completions from authenticated;

-- What the "did it" button sends. Not id, user_id, logged_at.
grant insert (task_id, done_at, note) on public.completions to authenticated;

-- What an edit can change. NOT task_id: moving a completion to another
-- routine would rewrite that routine's history.
grant update (done_at, note) on public.completions to authenticated;


-- ---------------------------------------------------------------------
-- 2. Delete only within 10 minutes of logging (undo).
-- ---------------------------------------------------------------------
drop policy "completions: delete own" on public.completions;

create policy "completions: delete own within 10 minutes" on public.completions
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    and logged_at > now() - interval '10 minutes'
  );


-- ---------------------------------------------------------------------
-- 3. The date rules. Replaces the 0001 version of completions_guard;
--    the trigger that calls it stays the same.
-- ---------------------------------------------------------------------
create or replace function public.completions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_created  timestamptz;
  task_schedule text;
  task_interval integer;
  user_tz       text;
  window_days   integer;
  limit_days    integer;
begin
  -- logged_at is always the server's clock, and frozen after insert.
  -- (The grants already stop the browser sending it; this is the
  -- second layer.)
  if tg_op = 'INSERT' then
    new.logged_at := now();
  else
    new.logged_at := old.logged_at;
  end if;

  -- Never later than the moment it was logged. On insert that means
  -- "not in the future"; on an edit it stops an old completion being
  -- moved forward to fill a gap. 1 minute allowance for clock drift.
  if new.done_at > new.logged_at + interval '1 minute' then
    raise exception 'done_at cannot be later than when it was logged'
      using errcode = '23514';
  end if;

  select t.created_at, t.schedule_type, t.interval_days
    into task_created, task_schedule, task_interval
  from public.tasks t
  where t.id = new.task_id;

  -- Not your task (RLS hides it): the composite foreign key rejects the
  -- row right after this trigger, so there is nothing to check here.
  if not found then
    return new;
  end if;

  if new.done_at < task_created then
    raise exception 'done_at cannot be before the task was created'
      using errcode = '23514';
  end if;

  -- Rule 1: the backdate limit for this routine.
  window_days := case task_schedule
                   when 'interval' then task_interval
                   when 'weekly'   then 7
                   when 'monthly'  then 30
                 end;
  limit_days := greatest(1, least(floor(window_days * 0.15)::integer, 5));

  -- The user's time zone, falling back to UTC if it isn't a real zone
  -- name (the CHECK on profiles only checks the shape of the text).
  select p.timezone into user_tz
  from public.profiles p
  where p.user_id = new.user_id;

  if user_tz is null
     or not exists (select 1 from pg_timezone_names z where z.name = user_tz) then
    user_tz := 'UTC';
  end if;

  -- Calendar days between the day it was logged and the day it was done,
  -- both in the user's time zone.
  if (new.logged_at at time zone user_tz)::date
     - (new.done_at at time zone user_tz)::date > limit_days then
    raise exception 'done_at is further back than this routine allows (% days)', limit_days
      using errcode = '23514';
  end if;

  -- Compensating control for the accepted time zone risk: an absolute
  -- ceiling no time zone can stretch.
  if new.done_at < new.logged_at - make_interval(days => limit_days + 1, hours => 1) then
    raise exception 'done_at is further back than this routine allows (hard limit)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.completions_guard() from public, anon, authenticated;

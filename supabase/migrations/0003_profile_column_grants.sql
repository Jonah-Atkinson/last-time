-- =====================================================================
-- Last Time — 0003: column-level UPDATE on profiles + onboarding guard
--
-- Slice 2 review finding (30 Sep 2026): 0002 granted UPDATE on the
-- whole profiles table. RLS already limits a user to their OWN row, but
-- inside that row every column was writable from the browser, including
-- values only the server should set:
--   created_at    -> a user could rewrite when their account was made
--   onboarded_at  -> a user could mark setup finished without making the
--                    required choices, reset it, or backdate it
-- Same idea as completions.logged_at: the server's clock, never the browser's.
--
-- Three layers now decide a profile update, and ALL must allow it:
--   1. GRANT (columns) = which columns may be written at all
--   2. RLS             = which rows (your own)
--   3. Trigger         = which values (onboarded_at rules below)
-- =====================================================================

-- Revoking at the table level also clears any column-level UPDATE grants,
-- so this starts from zero. SELECT is untouched.
revoke update on public.profiles from authenticated;

-- Only the columns the app edits. NOT user_id, NOT created_at.
grant update (display_name, timezone, theme_mode, accent, rewards_enabled, onboarded_at)
  on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- Trigger: onboarding rules
--   - onboarded_at is set by the server clock when setup is finished;
--     any value the browser sends is only a signal, never stored
--   - once set it's frozen: can't be cleared, changed, or backdated
--   - setup can't be finished (or stay finished) without a display name
--     and an explicit rewards yes/no
-- ---------------------------------------------------------------------
create function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.onboarded_at is not null then
    new.onboarded_at := old.onboarded_at;
  elsif new.onboarded_at is not null then
    new.onboarded_at := now();
  end if;

  if new.onboarded_at is not null
     and (new.display_name is null or new.rewards_enabled is null) then
    raise exception 'setup requires a display name and a rewards choice'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.profiles_guard() from public, anon, authenticated;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- =====================================================================
-- Last Time — Slice 1: schema + Row Level Security
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run
--
-- Security rules this file enforces (see spec threat model):
--   T1/T3  Every table has RLS; users can only see/change rows where
--          user_id = their own id. WITH CHECK stops writing rows under
--          someone else's id.
--   T1b    Cross-user links are impossible: a task can only point at
--          YOUR category, a completion only at YOUR task (composite FKs).
--          Plain FKs don't apply RLS, so without this, user B could
--          attach data to user A's rows if B learned A's ids.
--   T8     Colors/theme/accent are restricted to fixed key lists.
--   T9     Streaks/growth are NOT stored anywhere. logged_at is set by
--          the server, not the browser.
--   Anon   The public anon role gets no table access at all.
-- =====================================================================


-- ---------------------------------------------------------------------
-- profiles: one row per user, created automatically at sign-up
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  display_name     text check (char_length(display_name) between 1 and 40),
  timezone         text not null default 'UTC'
                   check (timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  theme_mode       text not null default 'system'
                   check (theme_mode in ('light', 'dark', 'system')),
  accent           text not null default 'dusk'
                   check (accent in ('dusk', 'sage', 'coral', 'ocean', 'plum')),
  rewards_enabled  boolean,          -- null until answered in first-run setup
  onboarded_at     timestamptz,      -- null until first-run setup is finished
  created_at       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  color       text not null default 'slate'
              check (color in ('rose', 'peach', 'butter', 'sage', 'teal', 'sky', 'lavender', 'slate')),
  icon        text not null default 'circle'
              check (icon ~ '^[a-z0-9-]{1,32}$'),
  created_at  timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)               -- target for the composite FK on tasks
);


-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id    uuid,
  name           text not null check (char_length(name) between 1 and 80),
  schedule_type  text not null check (schedule_type in ('interval', 'weekly', 'monthly')),
  interval_days  integer  check (interval_days between 1 and 3650),
  weekday        smallint check (weekday between 0 and 6),      -- 0 = Sunday
  month_day      smallint check (month_day between 1 and 28),   -- see REVIEW Q1
  due_time       time,                                          -- optional (spec decision 3)
  notes          text check (char_length(notes) <= 1000),
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),

  -- exactly one schedule shape per task
  check (
       (schedule_type = 'interval' and interval_days is not null and weekday is null and month_day is null)
    or (schedule_type = 'weekly'   and weekday is not null and interval_days is null and month_day is null)
    or (schedule_type = 'monthly'  and month_day is not null and interval_days is null and weekday is null)
  ),

  -- category must belong to the same user; deleting a category un-sets it
  foreign key (category_id, user_id)
    references public.categories (id, user_id)
    on delete set null (category_id),

  unique (id, user_id)               -- target for the composite FK on completions
);


-- ---------------------------------------------------------------------
-- completions: one row per "did it"
-- ---------------------------------------------------------------------
create table public.completions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  done_at     timestamptz not null default now(),   -- when it was done (may be backdated)
  logged_at   timestamptz not null default now(),   -- when it was recorded (server-set)
  note        text check (char_length(note) <= 500),

  -- task must belong to the same user; deleting a task deletes its history
  foreign key (task_id, user_id)
    references public.tasks (id, user_id)
    on delete cascade
);


-- ---------------------------------------------------------------------
-- Indexes (RLS filters on user_id constantly; keep it fast)
-- ---------------------------------------------------------------------
create index categories_user_id_idx  on public.categories (user_id);
create index tasks_user_id_idx       on public.tasks (user_id);
create index tasks_category_id_idx   on public.tasks (category_id);
create index completions_user_id_idx on public.completions (user_id);
create index completions_task_done_idx on public.completions (task_id, done_at desc);


-- ---------------------------------------------------------------------
-- Row Level Security: ON for every table
-- ---------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.categories  enable row level security;
alter table public.tasks       enable row level security;
alter table public.completions enable row level security;

-- The anon key ships in the browser. Anon gets nothing, not even a
-- chance for a policy mistake to matter.
revoke all on public.profiles, public.categories, public.tasks, public.completions from anon;

-- profiles: read and update your own row only.
-- No insert policy (the sign-up trigger creates it) and no delete policy
-- (it's deleted when the auth user is deleted).
create policy "profiles: select own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- categories, tasks, completions: full CRUD on your own rows only
create policy "categories: select own" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories: insert own" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories: update own" on public.categories
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories: delete own" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "tasks: select own" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks: insert own" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks: update own" on public.tasks
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks: delete own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "completions: select own" on public.completions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "completions: insert own" on public.completions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "completions: update own" on public.completions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "completions: delete own" on public.completions
  for delete to authenticated using ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------
-- Trigger: create a profile row when someone signs up
-- SECURITY DEFINER = runs with the owner's rights (it has to write a row
-- the new user can't write yet). search_path = '' stops a malicious
-- object with the same name from being picked up instead of ours.
-- ---------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

-- Functions in the public schema can be called through the API; nobody
-- should be able to call this one directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- Trigger: completion timestamps
--   - logged_at is always the server's clock (the browser can't fake it)
--   - done_at can't be in the future (1-minute allowance for clock drift)
--   - done_at can't be before the task was created
-- The "backdate only within the grace window" rule comes in Slice 4.
-- ---------------------------------------------------------------------
create function public.completions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  task_created timestamptz;
begin
  if tg_op = 'INSERT' then
    new.logged_at := now();
  else
    new.logged_at := old.logged_at;
  end if;

  if new.done_at > now() + interval '1 minute' then
    raise exception 'done_at cannot be in the future' using errcode = '23514';
  end if;

  select t.created_at into task_created
  from public.tasks t
  where t.id = new.task_id;

  if task_created is not null and new.done_at < task_created then
    raise exception 'done_at cannot be before the task was created' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.completions_guard() from public, anon, authenticated;

create trigger completions_guard
  before insert or update on public.completions
  for each row execute function public.completions_guard();

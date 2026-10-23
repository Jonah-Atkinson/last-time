-- =====================================================================
-- Last Time — RLS attack test
-- Pretends to be two different logged-in users (A and B) plus an
-- anonymous visitor, and tries to break the rules in the migrations
-- (0001-0005).
--
-- Before running: create two users in Dashboard > Authentication >
-- Users > Add user > Create new user (tick "Auto Confirm User"):
--     lasttime-test-a@example.com
--     lasttime-test-b@example.com
--
-- Run: SQL Editor > New query > paste this whole file > Run.
--   Pass: one row saying ALL 34 CHECKS PASSED.
--   Fail: an error starting with FAIL, naming the check that broke.
-- It deletes everything it creates, so it's safe to re-run.
-- =====================================================================

-- Result starts as "failed" and only flips to "passed" as the very last
-- step of the test block. If any check fails, the block rolls back and
-- the flip never happens, so a failure can't be reported as a pass.
select set_config('lasttime.rls_result', 'NOT PASSED: read the FAIL error above', false);

do $$
declare
  a uuid;
  b uuid;
  a_cat uuid;
  a_task uuid;
  a_comp uuid;
  a_task2 uuid;
  a_old uuid;
  a_new uuid;
  n int;
  ts timestamptz;
  d timestamptz;
  tz text;
  admin_role text := current_user;  -- the owner role this file runs as
begin
  select id into a from auth.users where email = 'lasttime-test-a@example.com';
  select id into b from auth.users where email = 'lasttime-test-b@example.com';
  if a is null or b is null then
    raise exception 'SETUP: create both test users first (see top of file)';
  end if;

  -- ---------- act as user A: create some data ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- 1. sign-up trigger made A's profile, and A sees only their own
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL 1: A sees % profiles (expected exactly 1, their own)', n; end if;

  insert into public.categories (name, color) values ('RLS test', 'sage') returning id into a_cat;
  insert into public.tasks (category_id, name, schedule_type, interval_days)
    values (a_cat, 'RLS test task', 'interval', 7) returning id into a_task;
  insert into public.completions (task_id, done_at) values (a_task, now()) returning id into a_comp;

  -- 2. logged_at is server-owned: the browser can't even send it
  --    (column not granted since 0005; the trigger also overwrites it)
  begin
    insert into public.completions (task_id, done_at, logged_at)
      values (a_task, now(), '2000-01-01');
    raise exception 'FAIL 2: client was able to send logged_at';
  exception when insufficient_privilege then null;
  end;

  -- 3. no completions in the future
  begin
    insert into public.completions (task_id, done_at) values (a_task, now() + interval '1 day');
    raise exception 'FAIL 3: future done_at was accepted';
  exception when check_violation then null;
  end;

  -- 4. no completions before the task existed
  begin
    insert into public.completions (task_id, done_at) values (a_task, now() - interval '30 days');
    raise exception 'FAIL 4: done_at before task creation was accepted';
  exception when check_violation then null;
  end;

  -- 5. style injection: accent must be one of the fixed keys
  begin
    update public.profiles set accent = 'red;background:url(https://evil.example)' where user_id = a;
    raise exception 'FAIL 5: arbitrary accent value was accepted';
  exception when check_violation then null;
  end;

  -- 6. A can't hand their profile to someone else (WITH CHECK)
  begin
    update public.profiles set user_id = b where user_id = a;
    raise exception 'FAIL 6: A changed their profile user_id to B';
  exception when insufficient_privilege or unique_violation then null;
  end;

  -- ---------- Slice 3 (0004): task and category columns ----------
  -- 22. tasks.created_at can't be chosen at insert (column not granted).
  --     If it could, the "no completions before the task existed" guard
  --     (check 4) would move wherever the browser put it.
  begin
    insert into public.tasks (name, schedule_type, interval_days, created_at)
      values ('backdated task', 'interval', 1, '2020-01-01');
    raise exception 'FAIL 22: A created a task with a chosen created_at';
  exception when insufficient_privilege then null;
  end;

  -- 23. ...and can't be rewritten later
  begin
    update public.tasks set created_at = '2020-01-01' where id = a_task;
    raise exception 'FAIL 23: A rewrote a task''s created_at';
  exception when insufficient_privilege then null;
  end;

  -- 24. a task's owner can't be changed (user_id not granted for update)
  begin
    update public.tasks set user_id = b where id = a_task;
    raise exception 'FAIL 24: A changed a task''s user_id';
  exception when insufficient_privilege then null;
  end;

  -- 25. category created_at is server-owned too
  begin
    update public.categories set created_at = '2020-01-01' where id = a_cat;
    raise exception 'FAIL 25: A rewrote a category''s created_at';
  exception when insufficient_privilege then null;
  end;

  -- 26. positive control: the columns the app DOES need still work.
  --     Without this, a migration that blocked everything would "pass".
  update public.tasks
    set name = 'RLS test task (edited)', interval_days = 14, notes = 'edited', archived = true
    where id = a_task;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 26: A could not edit or archive own task'; end if;
  update public.tasks set archived = false where id = a_task;
  update public.categories set name = 'RLS test (edited)', color = 'teal', icon = 'home' where id = a_cat;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 26: A could not edit own category'; end if;

  -- ---------- Slice 4 (0005): completion rules ----------
  -- Setup, as the database owner: a 30-day routine (backdate limit 4
  -- days) created 60 days ago, plus one completion LOGGED 10 days ago.
  -- The browser can do neither, which is the point. The trigger is
  -- switched off just long enough to plant the old row, because it would
  -- (correctly) stamp logged_at = now().
  insert into public.tasks (name, schedule_type, interval_days)
    values ('RLS test 30-day', 'interval', 30) returning id into a_task2;
  perform set_config('role', admin_role, true);
  update public.tasks set created_at = now() - interval '60 days' where id = a_task2;
  alter table public.completions disable trigger completions_guard;
  insert into public.completions (task_id, user_id, done_at, logged_at)
    values (a_task2, a, now() - interval '10 days', now() - interval '10 days')
    returning id into a_old;
  alter table public.completions enable trigger completions_guard;
  perform set_config('role', 'authenticated', true);
  select timezone into tz from public.profiles where user_id = a;

  -- 27. a completion can't be moved to another routine
  --     (task_id not granted for update)
  begin
    update public.completions set task_id = a_task2 where id = a_comp;
    raise exception 'FAIL 27: A moved a completion to another routine';
  exception when insufficient_privilege then null;
  end;

  -- 28. logged_at can't be rewritten later
  begin
    update public.completions set logged_at = now() - interval '30 days' where id = a_comp;
    raise exception 'FAIL 28: A sent a new logged_at';
  exception when insufficient_privilege then null;
  end;

  -- 29. no backdating past the routine's limit (30-day routine = 4 days)
  begin
    insert into public.completions (task_id, done_at) values (a_task2, now() - interval '6 days');
    raise exception 'FAIL 29: done_at 6 days back was accepted (limit is 4)';
  exception when check_violation then null;
  end;

  -- 30. the limit is in CALENDAR days in the user's time zone:
  --     midnight at the start of the 4th day back is allowed,
  --     one minute before it is not
  d := (date_trunc('day', now() at time zone tz) - interval '4 days') at time zone tz;
  begin
    insert into public.completions (task_id, done_at) values (a_task2, d);
  exception when check_violation then
    raise exception 'FAIL 30: the start of the 4th calendar day back (%) was refused', d;
  end;
  begin
    insert into public.completions (task_id, done_at) values (a_task2, d - interval '1 minute');
    raise exception 'FAIL 30: one minute before the 4th calendar day back was accepted';
  exception when check_violation then null;
  end;

  -- 31. an edit can't move an old completion FORWARD past when it was
  --     logged (that would fill a gap and fake a streak)
  begin
    update public.completions set done_at = now() - interval '1 day' where id = a_old;
    raise exception 'FAIL 31: a completion logged 10 days ago was moved to yesterday';
  exception when check_violation then null;
  end;

  -- 32. undo window: a completion logged more than 10 minutes ago
  --     can't be deleted (RLS hides it from DELETE, so 0 rows)
  delete from public.completions where id = a_old;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 32: A deleted a completion logged 10 days ago'; end if;

  -- 33. positive control: what the app DOES need still works:
  --     log late within the limit, edit an old note and date inside its
  --     own window, undo a fresh completion
  begin
    insert into public.completions (task_id, done_at, note)
      values (a_task2, now() - interval '3 days', 'logged late') returning id into a_new;
  exception when check_violation or insufficient_privilege then
    raise exception 'FAIL 33: A could not log a completion 3 days back (limit 4)';
  end;
  begin
    update public.completions set note = 'fixed note', done_at = now() - interval '12 days'
      where id = a_old;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FAIL 33: A could not edit an old completion'; end if;
  exception when check_violation or insufficient_privilege then
    raise exception 'FAIL 33: A could not edit an old completion inside its window';
  end;
  delete from public.completions where id = a_new;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 33: A could not undo a fresh completion'; end if;

  -- ---------- Slice 2 (0003): profile columns + onboarding ----------
  -- These checks change A's profile, so they run inside a sub-block that
  -- is undone at the end (the LT001 signal below). A FAIL still escapes
  -- and fails the whole test.
  begin
    select onboarded_at into ts from public.profiles where user_id = a;
    if ts is not null then
      raise exception 'SETUP: test user A is already onboarded; delete and recreate both test users';
    end if;

    -- 17. created_at is server-owned (column not granted)
    begin
      update public.profiles set created_at = '2000-01-01' where user_id = a;
      raise exception 'FAIL 17: A rewrote their profile created_at';
    exception when insufficient_privilege then null;
    end;

    -- 18. can't finish setup without a name and a rewards choice
    begin
      update public.profiles set onboarded_at = now() where user_id = a;
      raise exception 'FAIL 18: setup marked finished without name or rewards choice';
    exception when check_violation then null;
    end;

    -- 19. finishing setup stores the SERVER time, not the browser's
    update public.profiles
      set display_name = 'Test A', rewards_enabled = true, onboarded_at = '2000-01-01'
      where user_id = a
      returning onboarded_at into ts;
    if ts is null or ts < now() - interval '1 minute' then
      raise exception 'FAIL 19: client controlled onboarded_at (got %)', ts;
    end if;

    -- 20. once finished, onboarded_at is frozen (can't clear or backdate)
    update public.profiles set onboarded_at = null where user_id = a;
    update public.profiles set onboarded_at = '2000-01-01' where user_id = a;
    select onboarded_at into ts from public.profiles where user_id = a;
    if ts is null or ts < now() - interval '1 minute' then
      raise exception 'FAIL 20: onboarded_at was cleared or backdated (now %)', ts;
    end if;

    -- 21. can't undo the required rewards choice after setup
    begin
      update public.profiles set rewards_enabled = null where user_id = a;
      raise exception 'FAIL 21: rewards choice was cleared after setup';
    exception when check_violation then null;
    end;

    raise exception using errcode = 'LT001', message = 'undo slice 2 profile checks';
  exception when sqlstate 'LT001' then null;
  end;

  -- ---------- act as user B: attack A's data ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  -- 7. B can't read A's rows (IDOR: B knows A's ids and asks directly)
  select count(*) into n from public.tasks where id = a_task;
  if n <> 0 then raise exception 'FAIL 7: B can read A''s task'; end if;
  select count(*) into n from public.completions where task_id = a_task;
  if n <> 0 then raise exception 'FAIL 7: B can read A''s completions'; end if;
  select count(*) into n from public.categories where id = a_cat;
  if n <> 0 then raise exception 'FAIL 7: B can read A''s category'; end if;
  select count(*) into n from public.profiles where user_id = a;
  if n <> 0 then raise exception 'FAIL 7: B can read A''s profile'; end if;

  -- 8. B can't edit A's rows
  update public.tasks set name = 'hacked' where id = a_task;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8: B edited A''s task'; end if;
  update public.profiles set display_name = 'hacked' where user_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 8: B edited A''s profile'; end if;

  -- 9. B can't delete A's rows
  delete from public.completions where id = a_comp;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 9: B deleted A''s completion'; end if;
  delete from public.tasks where id = a_task;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 9: B deleted A''s task'; end if;

  -- 10. B can't create rows under A's user_id
  begin
    insert into public.tasks (user_id, name, schedule_type, interval_days)
      values (a, 'planted by B', 'interval', 1);
    raise exception 'FAIL 10: B inserted a task owned by A';
  exception when insufficient_privilege then null;
  end;

  -- 11. B can't attach a completion to A's task
  begin
    insert into public.completions (task_id) values (a_task);
    raise exception 'FAIL 11: B logged a completion on A''s task';
  exception when foreign_key_violation then null;
  end;

  -- 12. B can't put their task in A's category
  begin
    insert into public.tasks (category_id, name, schedule_type, interval_days)
      values (a_cat, 'B task in A category', 'interval', 1);
    raise exception 'FAIL 12: B used A''s category';
  exception when foreign_key_violation then null;
  end;

  -- 13. a task must have exactly one valid schedule shape
  begin
    insert into public.tasks (name, schedule_type, interval_days, weekday)
      values ('bad schedule', 'interval', 7, 1);
    raise exception 'FAIL 13: task with two schedule shapes was accepted';
  exception when check_violation then null;
  end;

  -- ---------- act as an anonymous visitor (the public anon key) ----------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);

  -- 14. anon can't read anything
  begin
    select count(*) into n from public.tasks;
    raise exception 'FAIL 14: anon can query tasks (% rows visible)', n;
  exception when insufficient_privilege then null;
  end;

  -- 15. anon can't write anything
  begin
    insert into public.categories (user_id, name) values (a, 'anon plant');
    raise exception 'FAIL 15: anon inserted a category';
  exception when insufficient_privilege then null;
  end;

  -- ---------- back to A: clean up (also proves A can delete own rows) ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  delete from public.tasks where id = a_task;   -- cascades to A's completions
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 16: A could not delete own task'; end if;
  delete from public.categories where id = a_cat;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 16: A could not delete own category'; end if;

  -- 34. deleting a routine still deletes its WHOLE history, including
  --     completions past the 10-minute undo window (the foreign key
  --     cascade is not subject to RLS)
  begin
    delete from public.tasks where id = a_task2;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'FAIL 34: A could not delete own routine'; end if;
  exception when foreign_key_violation then
    raise exception 'FAIL 34: old completions blocked deleting their routine';
  end;
  select count(*) into n from public.completions where task_id = a_task2;
  if n <> 0 then raise exception 'FAIL 34: % completions survived deleting their routine', n; end if;

  perform set_config('lasttime.rls_result', 'ALL 34 CHECKS PASSED', false);
end;
$$;

select current_setting('lasttime.rls_result') as result;

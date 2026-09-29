-- =====================================================================
-- Last Time — RLS attack test
-- Pretends to be two different logged-in users (A and B) plus an
-- anonymous visitor, and tries to break the rules in 0001_init.sql.
--
-- Before running: create two users in Dashboard > Authentication >
-- Users > Add user > Create new user (tick "Auto Confirm User"):
--     lasttime-test-a@example.com
--     lasttime-test-b@example.com
--
-- Run: SQL Editor > New query > paste this whole file > Run.
--   Pass: one row saying ALL 16 CHECKS PASSED.
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
  n int;
  ts timestamptz;
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

  -- 2. logged_at is server-set even if the browser sends a fake one
  insert into public.completions (task_id, done_at, logged_at)
    values (a_task, now(), '2000-01-01') returning logged_at into ts;
  if ts < now() - interval '1 minute' then raise exception 'FAIL 2: client was able to set logged_at'; end if;

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

  perform set_config('lasttime.rls_result', 'ALL 16 CHECKS PASSED', false);
end;
$$;

select current_setting('lasttime.rls_result') as result;

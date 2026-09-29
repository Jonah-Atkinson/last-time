# Last Time

A recurring-task tracker: log the things you do on a schedule, see when you last did them, and get nudged when they're due.

Built as a learning project in AI-assisted development and as a cloud security portfolio piece. The interesting part is the security model, not the to-do list.

## Stack

- Frontend: Vite + React + TypeScript (installable PWA) *(coming in Slice 2)*
- Backend: Supabase (Postgres, Auth, Row Level Security)

## Security model

The Supabase anon key ships in the browser by design, so **the database enforces every rule**. The UI is never trusted.

| Threat | Control |
|---|---|
| User B reads or edits User A's data by changing an id in a request (IDOR) | Row Level Security on every table: rows are visible and writable only when `user_id = auth.uid()` |
| User B writes rows under User A's id | `WITH CHECK` on every insert/update policy |
| User B links their data to User A's rows (plain foreign keys skip RLS) | Composite foreign keys: a task can only reference *your* category; a completion only *your* task |
| Anonymous visitor uses the public anon key | All table privileges revoked from `anon` |
| Style injection through user-chosen colors | Colors, accent, and theme restricted to fixed key lists by `CHECK` constraints |
| Tampering with streaks or growth | Never stored; always derived from completions. `logged_at` is set by the server |
| Faked history | Completions can't be in the future or before the task existed (trigger) |
| Service-role key leaks | Never used in frontend code; `.env` ignored; GitHub push protection on |

## Database

- `supabase/migrations/0001_init.sql`: schema, RLS policies, triggers
- `supabase/tests/rls_check.sql`: attack test. Plays two users and an anonymous visitor, tries 16 ways to break the rules, and reports `ALL 16 CHECKS PASSED` only if every attack fails. Verified to catch deliberately broken policies (open SELECT, missing WITH CHECK, RLS disabled, anon re-granted, trigger removed).

**Rule:** any change to a migration → re-run `rls_check.sql` before merging.

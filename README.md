# Last Time

A recurring-task tracker: log the things you do on a schedule, see when you last did them, and get nudged when they're due.

Built as a learning project in AI-assisted development and as a cloud security portfolio piece. The interesting part is the security model, not the to-do list.

## Stack

- Frontend: Vite + React + TypeScript (installable PWA), in `web/`
- Backend: Supabase (Postgres, Auth, Row Level Security)
- Login: passwordless 6-digit email code (Supabase email OTP, 10-minute expiry), sent through custom SMTP (Resend) from a dedicated subdomain with SPF/DKIM

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
| Service-role key leaks | Never used in frontend code; `.env` ignored; GitHub push protection on; the app refuses to start if the configured key is a secret/service_role key |
| User rewrites server-owned profile values (`created_at`, `onboarded_at`) or finishes setup without the required choices | Column-level `UPDATE` grant on `profiles` (only app-editable columns) + `profiles_guard` trigger: `onboarded_at` uses the server clock and is frozen once set |
| Script injected through the display name (stored XSS) | Rendered as React text only; never raw HTML. Matters extra because sessions live in localStorage |
| Account enumeration on the sign-in screen | New and existing emails get the same response and the same code flow |

## Database

- `supabase/migrations/0001_init.sql`: schema, RLS policies, triggers
- `supabase/migrations/0002_explicit_grants.sql`: table privileges, explicitly (never rely on platform defaults)
- `supabase/migrations/0003_profile_column_grants.sql`: column-level UPDATE on profiles + onboarding guard (Slice 2 review finding)
- `supabase/tests/rls_check.sql`: attack test. Plays two users and an anonymous visitor, tries 21 ways to break the rules, and reports `ALL 21 CHECKS PASSED` only if every attack fails. Verified to catch deliberately broken policies (open SELECT, missing WITH CHECK, RLS disabled, anon re-granted, trigger removed).

**Rule:** any change to a migration → re-run `rls_check.sql` before merging.

## Supabase auth settings

These live in the Supabase dashboard, not in this repo. A fresh project needs all of them before sign-in works. Each row was found the hard way by running the test plan below (2 Oct 2026).

| Setting (Supabase > Authentication) | Value | What breaks if it's wrong |
|---|---|---|
| SMTP host | `smtp.resend.com` (port 465) | No email is sent |
| SMTP username | `resend`, literally. It is the same for every Resend account | 500 `Error sending confirmation email`; the Auth log says `invalid username` |
| SMTP password | A Resend API key with **Sending access** only, restricted to `mail.jonahatkinson.com` | A full-access key also works, but if it leaks it can send from any domain, read email logs, and create more keys |
| Sender address | `no-reply@mail.jonahatkinson.com` | Resend rejects senders outside the verified domain |
| Email template: Confirm signup | Body shows `{{ .Token }}` and no link | **New** users get a link instead of a code |
| Email template: Magic Link | Body shows `{{ .Token }}` and no link | **Returning** users get a link instead of a code |
| Email OTP length | `6` | The app only accepts six digits, so every code is rejected as wrong |
| Email OTP expiry | `600` seconds | The sign-in screen promises 10 minutes |

**Debugging sign-in:** the sign-in screen shows one generic error on purpose (no account enumeration). The real reason is in the browser's Network tab (status code and Response body of the failed request) and in Supabase > Logs > Auth. 4xx = the request was wrong; 5xx = Supabase failed while handling it.

## Running the app locally

1. Supabase dashboard > Project Settings > API Keys: copy the Project URL and the **publishable** key. The URL is just `https://<project-ref>.supabase.co`. The Data API page shows a longer form ending in `/rest/v1/`; using that one makes every sign-in request 404.
2. Copy `web/.env.example` to `web/.env.local` and fill in both values. Never the secret key.
3. In a terminal, from the `web/` folder: `npm install`, then `npm run dev`, then open http://localhost:5173

## Slice 2 test plan (auth + first-run setup)

Run in order. Record pass/fail for each before merging.

| # | Do this | Expected |
|---|---|---|
| 1 | Supabase SQL Editor: run `0003_profile_column_grants.sql`, then `supabase/tests/rls_check.sql` | `ALL 21 CHECKS PASSED` |
| 2 | Temporarily set `VITE_SUPABASE_PUBLISHABLE_KEY=sb_secret_fake` (a fake value, never the real secret) and reload | App doesn't load; browser console shows the STOP error. Put the real publishable key back |
| 3 | Sign in with your email | Email from `no-reply@mail.jonahatkinson.com` with a 6-digit code and no link |
| 4 | Enter a wrong code | "That code is wrong or expired." No hint about which |
| 5 | Enter the right code | Setup screen |
| 6 | On setup, type a name but pick no rewards option | Continue stays disabled. Neither option is pre-selected |
| 7 | Name `<script>alert(1)</script>`, pick an option, Continue | Home shows the name as plain text. No popup |
| 8 | Supabase Table Editor > profiles | Your row: `onboarded_at` ≈ now, `timezone` = your browser's zone, `rewards_enabled` = your choice |
| 9 | Reload the page | Still signed in, lands on Home (not setup) |
| 10 | Sign out, then sign in again | A 6-digit code arrives (this time from the Magic Link template), then back to Home directly, no setup |
| 11 | Sign in on a second browser, then "Sign out everywhere" on the first | Second browser gets signed out once its access token expires (up to 1 hour). Refresh tokens are revoked immediately; access tokens can't be. Record what you see |
| 12 | `git status` | `web/.env.local` is not listed |


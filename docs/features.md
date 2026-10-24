# Feature Status

Honest status of every module as shipped. “Verified live” means exercised against the real
Supabase project (not just unit tests).

## Implemented and verified

| Module | Status | Verification |
|---|---|---|
| Auth (signup, sign-in, reset, account states, guards) | ✅ verified live | admin created via real signup API; sign-in returns session |
| Profile auto-creation on signup | ✅ verified live | trigger fires on real signups |
| Roles & admin provisioning (bootstrap/promote scripts, in-app promotion) | ✅ verified live | `is_admin()` true for promoted account; guard trigger blocks self-escalation (unit + design) |
| Migrations & RLS deployment (13 migrations, ~50 tables) | ✅ verified live | applied in order; schema/RLS/cron inspected |
| Scheduled reminders generation + delivery pipeline | ✅ verified live | demo assignment generated 3 reminder rows (7d/3d/1d/deadline rules); `process_due_reminders()` executed clean |
| pg_cron jobs (4) | ✅ verified live | registered and active |
| Dashboards (student + admin RPC bundles) | ✅ verified live | `admin_dashboard_stats` returns real aggregates |
| Demo content seeding | ✅ verified live | week 1 + sheet (6 real CF problems) + assignment + milestone + session + announcement |
| Team chat, invitations, join requests, matching, leader management | ✅ built; RLS-check covers member posting | unit tests for matching; wizard + RPCs shipped |
| Codeforces integration (link/sync/verify) | ✅ verified live | full pipeline exercised against the real CF API (handle `tourist`, read-only): pg_net fetch → response processing → snapshot (rating/max/rank/contests) → 310 rating-history rows → 2,122 **uniquely deduplicated** solved problems → 2,128 problems mirrored → verified completions; pagination auto-continued |
| Problem sheets + progress tracking | ✅ built | URL parsing unit-tested |
| Training weeks + resources + storage | ✅ built | bucket policies deployed |
| Roadmap with prerequisites | ✅ built | cycle prevention trigger deployed |
| Virtual contests + scoring + standings | ✅ built | scoring engine unit-tested (ICPC + points, ties) |
| Mentorship booking | ✅ built | exclusion constraint deployed |
| Attendance, announcements, support, notifications, calendar, reports, audit, settings | ✅ built | deployed + UI complete |

## Working with documented limitations

- **Codeforces topic analytics** — CF tags map to the local taxonomy only where a natural mapping
  exists (`dp` → dynamic-programming, `sortings` → sorting, spaces → dashes, …); unmapped tags are
  skipped. Tag coverage on problems is partial by design.
- **`user.status` pagination** — accepted submissions are fetched 2,000 per page with automatic
  continuation; extremely prolific handles take several sync cycles to backfill.
- **Handle verification** — optional challenge via the CF profile “last name” field; unverified
  handles are explicitly labelled “claimed, not proven” everywhere.
- **Reminder emails** — in-app notifications are always delivered; the email channel requires SMTP
  configuration on the Supabase project (delivery logs record `in_app` rows today).
- **Auth emails on the free tier** — Supabase allows only 2 signup-confirmation emails per hour;
  bulk onboarding of students should either pace signups or configure custom SMTP, or disable
  “Confirm email” in the dashboard.

## Not implemented (deliberate)

- Automatic solution judging — no online-judge submission API exists for Codeforces; the platform
  tracks submissions by link and syncs accepted problems from the public API instead.
- External contest submission retrieval — results are entered manually or via validated CSV import.
- QR attendance — spec marks it optional and warns against static QR; attendance is recorded by
  administrators (audited).
- Browser push notifications — in-app + realtime only.

## Verification summary

- `npm test` — 32/32 unit tests (scoring, reminders, matching, CF parsing/dedupe, CSV).
- `npm run build` — strict TypeScript + production build pass.
- `npm run db:rls-check` — live cross-access assertions (anon denied, profile isolation,
  role-escalation reverted, draft content hidden, audit admin-only, chat isolation, notification
  isolation, reminder visibility, student dashboard scoping). Results recorded in the run output.

# Database Schema Guide

11 migrations in `supabase/migrations/`, applied in order by `scripts/apply-migrations.mjs`
(tracked in `public.schema_migrations`). ~45 tables. All writes to protected data flow through
`SECURITY DEFINER` RPCs; RLS is enabled on every table.

## Migration map

| # | Contents |
|---|---|
| 0001 | Extensions (`pg_cron`, `pg_net`), `community_settings`, `profiles` (+ auto-create trigger from `auth.users`), `profiles_public` view (safe columns only), `audit_logs`, `notifications` + preferences, helpers `is_admin()` / `is_active_user()` / `notify()` |
| 0002 | `teams`, `team_members` (one-active-team partial unique index), invitations, join requests, conversations, `messages`, read states + the full set of transactional membership RPCs (`create_team`, `confirm_team_membership`, `respond_to_invitation`, `request_to_join`, `respond_to_join_request`, `leave_team`, `remove_team_member`, `set_team_leader`, `admin_team_decision`, …) with capacity locks, system messages, notifications and audit entries |
| 0003 | Training weeks / resources / material completions + publish notification trigger |
| 0004 | Topic taxonomy (+ default 16 topics), `problems`, `problem_topics`, problem sheets, sheet items, `problem_completions` (source: manual / codeforces / imported) |
| 0005 | Codeforces accounts, snapshots, rating history, deduped solved problems, `cf_sync_requests`; pg_net fetch enqueue + response processor + cron; optional handle verification via CF "last name" challenge; tag→topic mapping |
| 0006 | Assignments, submissions, `scheduled_reminders`, `reminder_delivery_logs`; deadline-change regeneration trigger; `process_due_reminders()` (idempotent) |
| 0007 | Roadmap milestones, prerequisites (recursive cycle prevention trigger), computed `roadmap_progress_for()` |
| 0008 | Virtual contests, contest problems/registrations/results/problem-results; result validation + batch import RPCs; `contest_standings()` |
| 0009 | Training sessions, attendance records, batch audited `admin_set_attendance()` |
| 0010 | Mentors, availability rules, blackouts, bookings (GiST exclusion constraint prevents overlapping slots), private session notes, 24h/1h reminder processor |
| 0011 | Announcements, support requests/replies, admin RPCs (`admin_set_profile_status`, `admin_bulk_approve`, `admin_set_role`), dashboard RPCs (`student_dashboard_data`, `admin_dashboard_stats`, `admin_topic_analytics`), storage buckets + policies, cron schedules, EXECUTE revokes for internal helpers |
| 0012 | Hotfix: settings reads inside plpgsql used invalid aggregates (`max(boolean)`/`max(int[])`) |
| 0013 | Hotfix: pg_net response payload column is `content` on this project |
| 0014 | Hotfix: loop-variable alias shadowed a subquery alias in the CF processor |
| 0015 | Hotfix: RLS recursion — membership checks in chat policies moved to definer helpers; FK on-delete hygiene |
| 0016 | Hotfix: remaining policy cycles (teams ↔ team_members, announcements, registrations, submissions) via definer helpers; roadmap RPC made volatile |
| 0017 | `profiles_public` converted from a SECURITY DEFINER view to a trigger-maintained table with its own RLS |

## Key integrity rules (enforced in the database)

1. **Team capacity** — RPCs `SELECT … FOR UPDATE` the team row before every membership change; a
   constraint trigger backstops capacity; a partial unique index guarantees one active team per
   student; pending confirmations also block double engagement.
2. **Exactly one leader** — `refresh_team_state()` re-validates the leader after every membership
   change and auto-promotes the earliest active member if the leader leaves.
3. **Complete-team lifecycle** — `pending_member_confirmation → pending_admin_review → complete`
   (or straight to `complete` when approval is disabled); losing members drops the team back to
   `looking_for_members`.
4. **Problem completions are unique** per (user, problem); Codeforces-verified records cannot be
   removed by the manual toggle.
5. **Reminders are idempotent** — unique `(reminder_id, recipient_id, channel)` delivery log +
   notification dedupe keys; reprocessing never double-sends.
6. **Bookings never overlap** — `EXCLUDE USING gist (mentor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status IN ('pending','confirmed')`.
7. **Prerequisites cannot cycle** — recursive CTE validation in a BEFORE INSERT trigger.
8. **Contest results** — one row per participant (partial unique indexes); unknown problem codes
   and solved-problems-without-time are rejected; standings are computed, never stored.

## Computed rules (documented, transparent)

- **Roadmap milestone completion**: linked week materials ratio ≥ threshold AND linked sheet
  problems ratio ≥ threshold AND linked assignment has a submission (threshold configurable per
  milestone, default 0.8). Statuses: `locked` (hard unmet prerequisite) > `completed` > `in_progress` > `not_started`, plus an `overdue` flag. Admin overrides are stored separately and audited.
- **ICPC penalty**: Σ over solved problems of (accept minute + max(wrong attempts − 1, 0) ×
  penalty minutes). Wrong submissions on unsolved problems add nothing. Ranking: solved ↓,
  penalty ↑, last acceptance ↑, name ↑ (deterministic). Points mode: score ↓ then the same chain.
- **Matching score** (0–100, explainable): same preferred language +40, availability overlap
  (Jaccard) up to +40, experience proximity up to +20, same academic year +5.

## Security model summary

- Sensitive profile fields (phone, university ID, emails) are readable only by the owner and
  admins; other students browse `profiles_public` — a **real trigger-maintained table** (not a
  definer view, per Supabase security-lint guidance) containing only safe columns, synced by
  `sync_profiles_public()` on every profile change and restricted to SELECT for authenticated
  users.
- Unpublished training, drafts of sheets/assignments/contests/roadmap/announcements are invisible
  to students at the RLS level (not just hidden in the UI).
- Chat messages are visible only to *current* active members + admins; former members lose access.
- Students can never change their own `role`, `status` or review fields — a guard trigger reverts
  such updates and the RLS policy blocks the rest.
- Internal helpers (`notify`, `audit_log`, reminder/cron processors, CF internals) have `EXECUTE`
  revoked from `public`/`authenticated`/`anon` so they cannot be invoked through the REST API.
- Storage: `avatars` public-read with owner-folder writes; `training-resources` private, readable
  via signed URLs only when referenced by a published week; `assignment-files` private per-user
  folders.

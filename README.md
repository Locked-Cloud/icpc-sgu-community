# ICPC SGU Community — Level 1 Management Platform

<div align="center">

**El-Saleheya El-Gadida University** · *"Think ... Code ... Conquer!"*

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/tests-32%2F32%20passing-brightgreen)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

A production-minded platform that replaces scattered Google Forms, spreadsheets and WhatsApp groups with one system for running a competitive-programming training level end to end: student registration, 3-member team formation, private realtime team chat, weekly training, problem sheets, live Codeforces analytics, virtual contests with an ICPC scoring engine, skill tracking, a training roadmap, database-scheduled assignment reminders, and mentorship booking.

**Every access rule is enforced in the database** (Row Level Security + audited `SECURITY DEFINER` functions) — never in the browser.

---

## Highlights

| Area | What it does |
|---|---|
| **Teams** | Complete / incomplete / individual registration, invitations, join requests, explainable rules-based matching, leader management, admin review — capacity and one-team-per-student enforced with row locks and DB constraints |
| **Private team chat** | Realtime messaging with replies, pinning, moderation, read states, search and pagination — visible only to current members + admins (verified by automated cross-access tests) |
| **Training** | Weekly units with files (private storage, signed URLs), draft → schedule → publish workflow, material completion tracking |
| **Problem sheets** | Curated sets; Codeforces / AtCoder / CSES links auto-identified; manual solves clearly distinguished from Codeforces-verified ones |
| **Codeforces integration** | Real public-API sync via `pg_net` + `pg_cron` — profile, rating history, deduplicated solved problems (proven live: 2,122 accepted submissions → exactly 2,122 unique solves), optional handle-ownership verification |
| **Virtual contests** | Team/individual contests, ICPC & points scoring modes, deterministic tie-breaking, manual + CSV result entry, computed standings, CSV export |
| **Roadmap & skills** | Milestones with acyclic prerequisites; completion **computed from real records** (materials, problems, submissions), never self-reported; transparent skill map with "recommended practice" (no public weakness labels) |
| **Reminders** | Genuine DB scheduling (`pg_cron`), idempotent delivery, deadline-change aware, per-user mute preferences |
| **Mentorship** | Availability rules → generated slots → booking with a GiST exclusion constraint that makes double-booking impossible; 24 h / 1 h session reminders |
| **Operations** | Registrations approval, bulk actions, attendance (audited edits), announcements with audience targeting, support tickets, full audit log, CSV reports, live admin dashboard |

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 · TypeScript (strict) · Vite 6 · Tailwind CSS v4 · shadcn/ui (Radix) · React Router 7 · TanStack Query 5 · React Hook Form + Zod · Recharts |
| Backend | Supabase — PostgreSQL 17 · Auth · Row Level Security · Storage · Realtime |
| Scheduling | `pg_cron` + `pg_net` inside Postgres (Codeforces sync, assignment reminders, mentorship reminders) |
| Tests | Vitest (unit) · live RLS / API integration scripts |

The **entire backend ships as 19 SQL migrations** — schema, policies, RPCs, storage rules and cron jobs — applied by one script. No server to run, no Edge Functions.

## Quick start

> **Prerequisites:** Node.js ≥ 20 and a free [Supabase](https://supabase.com) project.

```bash
git clone https://github.com/Locked-Cloud/icpc-sgu-community.git
cd icpc-sgu-community
npm install

cp .env.example .env
# fill in: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_DB_URL

npm run db:apply              # applies all migrations (idempotent)
npm run db:bootstrap-admin -- you@example.com "StrongPassword"   # first admin
npm run dev                   # http://localhost:5173
```

Optional demo content (clearly-marked development data):

```bash
npm run db:seed-demo          # training week, sheet with real CF problems, assignment, milestone
npm run db:demo-journey       # creates a demo student and exercises EVERY page's flow (42 checks)
node scripts/seed-test-data.mjs   # full playground: 10 students, teams, chats, contests with
                                  # results, submissions, bookings (dev/preview only)
```

## Testing

```bash
npm test                            # 32 unit tests: scoring engine, reminder scheduling,
                                    # idempotency, matching rules, CF parsing/dedupe, CSV

npm run db:api-sweep -- <admin-pw>  # hits every table + RPC the app uses; catches RLS
                                    # recursion, spelling drift and broken policies

npm run db:rls-check -- <admin-pw>  # creates a throwaway student and verifies isolation:
                                    # anon denied, profile privacy, role-escalation reverted,
                                    # drafts hidden, chat isolation, notification isolation…
```

The admin account is discovered automatically from the database — its password is passed on the command line and **credentials are never stored in files**.

## Deployment

The app is a static SPA — deploy `dist/` anywhere:

1. Build: `npm run build` (env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` are baked at build time; both are public by design — access control lives in RLS).
2. Vercel/Netlify: build command `npm run build`, output `dist`, add a SPA rewrite to `index.html` (see `dist/vercel.json`).
3. Add the production URL to Supabase → Auth → URL Configuration → Redirect URLs.
4. Run `npm run db:apply` against the project when pulling updates.

## Project structure

```
src/
  features/<domain>/     one folder per feature (pages + local API hooks)
  components/ui/         vendored shadcn/ui components (Radix)
  components/shared/     PageHeader, EmptyState, StatCard, ConfirmDialog…
  hooks/                 auth context, theme, notifications
  lib/                   supabase client, validation, scoring, reminders,
                         matching, codeforces helpers, csv — pure & unit-tested
  types/                 database row types
supabase/migrations/     19 SQL migrations — the entire backend
scripts/                 db:apply, db:bootstrap-admin, db:rls-check,
                         db:api-sweep, db:demo-journey, db:seed-demo
docs/                    schema guide (integrity & computed rules) · feature status
```

## Security model (summary)

- Sensitive profile fields visible only to the owner and admins; others browse a trigger-maintained safe-column table (`profiles_public`) — no definer views.
- Unpublished training/sheets/assignments/contests/roadmap/announcements are invisible to students **at the RLS level**, not just hidden in the UI.
- Chat visible only to *current* active members; former members lose access automatically.
- Students can never alter their own `role`/`status` — a guard trigger reverts attempts (verified live).
- Privileged operations run as audited `SECURITY DEFINER` RPCs; internal helpers have `EXECUTE` revoked from API roles.
- Reminders are idempotent (unique delivery logs + dedupe keys); bookings cannot overlap (GiST exclusion constraint).

Details: [`docs/schema.md`](docs/schema.md) · Honest per-module status & limitations: [`docs/features.md`](docs/features.md)

## Documentation

- [docs/schema.md](docs/schema.md) — full schema map, integrity rules, computed-rule definitions (ICPC penalty, roadmap completion, matching score), security model
- [docs/features.md](docs/features.md) — verified-live status per module and documented limitations

## License

[MIT](LICENSE) © ICPC SGU Community

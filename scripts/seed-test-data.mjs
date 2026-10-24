#!/usr/bin/env node
/**
 * TEST DATA seed — populates every feature area of the platform so all
 * pages/dashboards have something to show.
 *
 * Creates (idempotent — safe to re-run):
 *   10 test students + 1 mentor (via the real /auth/v1/signup API)
 *   3 teams (+ members, join request, invitation, chat conversations & messages)
 *   Training weeks 2 (published) & 3 (draft), sessions, resources
 *   Sheet 2 + problems, topics links, problem/material/milestone completions
 *   Assignments 2–3, submissions (accepted / late / under review / feedback)
 *   Roadmap milestones 2–3 + prerequisites + completions (incl. admin override)
 *   3 contests (upcoming team, upcoming individual, past with full results)
 *   Attendance records, mentor profile + availability + bookings + notes
 *   Support tickets with replies, notifications + preferences
 *   Codeforces accounts with REAL public CF data (snapshot/rating/solves)
 *
 * Test password for every seeded account: Icpc-Test-2026!
 * Usage: node scripts/seed-test-data.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY || !process.env.SUPABASE_DB_URL) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_DB_URL in .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const q = (sql, params = []) => client.query(sql, params);

const PASSWORD = "Icpc-Test-2026!";
const ADMIN_EMAIL = "icpc.sgu.level1@gmail.com";
const D = (days, hours = 0) => new Date(Date.now() + days * 864e5 + hours * 36e5);

// ---------------------------------------------------------------------------
// 1) Test accounts — created through the real signup endpoint
// ---------------------------------------------------------------------------
const USERS = [
  { key: "alice",  email: "alice.demo@icpc-sgu.dev",  name: "Alice Fahmy",    status: "active",  role: "student", cf: "Um_nik",       uni: "20260101", exp: "beginner",     bio: "First-year CS student. Target: Codeforces Specialist by end of Level 1." },
  { key: "omar",   email: "omar.demo@icpc-sgu.dev",   name: "Omar Khaled",    status: "active",  role: "student", cf: "pajenegod",    uni: "20260102", exp: "beginner",     bio: "Loves math problems and midnight contests." },
  { key: "mona",   email: "mona.demo@icpc-sgu.dev",   name: "Mona Adel",      status: "active",  role: "student", cf: "adamant",      uni: "20260103", exp: "intermediate", bio: "Joined late but catching up fast." },
  { key: "yousef", email: "yousef.demo@icpc-sgu.dev", name: "Yousef Tarek",   status: "active",  role: "student", cf: "SecondThread", uni: "20260104", exp: "beginner",     bio: "Team Binary Bandits captain." },
  { key: "sara",   email: "sara.demo@icpc-sgu.dev",   name: "Sara Nabil",     status: "active",  role: "student", cf: null,           uni: "20260105", exp: "none",         bio: "New to competitive programming." },
  { key: "khaled", email: "khaled.demo@icpc-sgu.dev", name: "Khaled Mostafa", status: "active",  role: "student", cf: null,           uni: "20260106", exp: "beginner",     bio: "Building my first team." },
  { key: "rania",  email: "rania.demo@icpc-sgu.dev",  name: "Rania Samir",    status: "active",  role: "student", cf: null,           uni: "20260107", exp: "beginner",     bio: "Looking for a team — available evenings and weekends." },
  { key: "mentor", email: "mentor.demo@icpc-sgu.dev", name: "Karim El-Sayed", status: "active",  role: "mentor",  cf: null,           uni: null,       exp: "advanced",     bio: "ICPC regional medalist, mentoring Level 1 students." },
  { key: "hana",   email: "hana.demo@icpc-sgu.dev",   name: "Hana Mahmoud",   status: "pending_approval", role: "student", cf: null, uni: "20260108", exp: "none",      bio: "Application pending admin review." },
  { key: "tarek",  email: "tarek.demo@icpc-sgu.dev",  name: "Tarek Ashraf",   status: "pending_approval", role: "student", cf: null, uni: "20260109", exp: "beginner",  bio: "Application pending admin review." },
  { key: "nour",   email: "nour.demo@icpc-sgu.dev",   name: "Nour El-Din",    status: "suspended", role: "student", cf: null,          uni: "20260110", exp: "beginner",     bio: "Suspended test account (policy-check fixture)." },
];

const ids = {}; // key -> profile id

async function signup(u) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ email: u.email, password: PASSWORD, data: { full_name_en: u.name } }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body?.user?.id) return body.user.id;
  if (String(body?.msg || body?.error_description || body?.error || "").toLowerCase().includes("already registered")) {
    const r = await q(`select id from auth.users where email = $1`, [u.email]);
    if (r.rows[0]) return r.rows[0].id;
  }
  throw new Error(`signup failed for ${u.email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
}

for (const u of USERS) {
  const existing = await q(`select id from auth.users where email = $1`, [u.email]);
  ids[u.key] = existing.rows[0]?.id ?? (await signup(u));
  console.log(`user ${u.key.padEnd(7)} -> ${ids[u.key]} ${existing.rows[0] ? "(existing)" : "(created)"}`);
}

const adminId = (await q(`select id from public.profiles where personal_email = $1`, [ADMIN_EMAIL])).rows[0]?.id
  ?? (await q(`select id from public.profiles where role = 'admin' limit 1`)).rows[0]?.id;

// Profile enrichment + role/status — must run inside the trusted_write guard.
for (const u of USERS) {
  await q("begin");
  await q(`select set_config('icpc.trusted_write','on', true)`);
  await q(
    `update public.profiles set
       role = $2, status = $3, full_name_en = $4, university_id = $5,
       academic_year = case when $2 = 'student' then 'First Year' else null end,
       faculty = case when $2 = 'student' then 'Computer Science' else null end,
       programming_experience = $6, preferred_language = 'C++',
       codeforces_handle = $7, bio = $8, availability = $9::text[],
       personal_email = $10, profile_completed_at = now(), updated_at = now()
     where id = $1`,
    [ids[u.key], u.role, u.status, u.name, u.uni, u.exp, u.cf, u.bio, ["Evenings", "Weekends"], u.email],
  );
  await q("commit");
}
console.log("profiles enriched (guard transaction ok)");

// ---------------------------------------------------------------------------
// 2) Teams, members, join request, invitation
// ---------------------------------------------------------------------------
async function ensureTeam(t) {
  const existing = await q(`select id from public.teams where lower(name) = lower($1) and status not in ('rejected','cancelled','archived')`, [t.name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const r = await q(
    `insert into public.teams (name, status, registration_type, leader_id, description,
       preferred_languages, experience_preference, availability, capacity, created_by, approved_by, approved_at)
     values ($1,$2,$3,$4,$5,$6::text[],$7,$8::text[],$9,$10,$11::uuid,case when $11::uuid is null then null else now() end)
     returning id`,
    [t.name, t.status, t.type, ids[t.leader], t.desc, t.langs, t.expPref ?? "any", ["Evenings"], t.capacity, ids[t.leader], t.status === "approved" ? adminId : null],
  );
  return r.rows[0].id;
}

const teamDelta = await ensureTeam({ name: "Delta Force", status: "approved", type: "complete", leader: "alice", desc: "Serious about regionals. We meet twice a week.", langs: ["C++"], capacity: 3 });
const teamBinary = await ensureTeam({ name: "Binary Bandits", status: "looking_for_members", type: "incomplete", leader: "yousef", desc: "Friendly team looking for a third member.", langs: ["C++", "Python"], capacity: 3 });
const teamNull = await ensureTeam({ name: "NULL Pointers", status: "draft", type: "incomplete", leader: "khaled", desc: "Just registered — still confirming members.", langs: ["C++"], capacity: 3 });

async function ensureMember(teamId, key, status) {
  const existing = await q(
    `select id from public.team_members where team_id = $1 and student_id = $2 and status <> 'removed'`, [teamId, ids[key]],
  );
  if (existing.rows[0]) return;
  await q(
    `insert into public.team_members (team_id, student_id, status, joined_at, confirmed_at)
     values ($1,$2,$3, now(), case when $3 = 'active' then now() else null end)`,
    [teamId, ids[key], status],
  );
}
await ensureMember(teamDelta, "alice", "active");
await ensureMember(teamDelta, "omar", "active");
await ensureMember(teamDelta, "mona", "active");
await ensureMember(teamBinary, "yousef", "active");
await ensureMember(teamBinary, "sara", "active");
await ensureMember(teamNull, "khaled", "pending_confirmation");

if (!(await q(`select 1 from public.team_join_requests where team_id = $1 and student_id = $2 and status = 'pending'`, [teamBinary, ids.rania])).rows[0]) {
  await q(`insert into public.team_join_requests (team_id, student_id, message) values ($1,$2,$3)`,
    [teamBinary, ids.rania, "Hi! I solve daily on Codeforces and I'm free every evening — would love to join."]);
}
if (!(await q(`select 1 from public.team_invitations where team_id = $1 and invitee_id = $2 and status = 'pending'`, [teamDelta, ids.rania])).rows[0]) {
  await q(`insert into public.team_invitations (team_id, inviter_id, invitee_id, message) values ($1,$2,$3,$4)`,
    [teamDelta, ids.alice, ids.rania, "We saw your skill map — strong on math. Want to be our third?"]);
}
console.log("teams + membership ready");

// Chat: one conversation per approved/active team + messages + read states.
async function ensureConversation(teamId, msgs) {
  let conv = (await q(`select id from public.team_conversations where team_id = $1`, [teamId])).rows[0]?.id;
  if (!conv) conv = (await q(`insert into public.team_conversations (team_id) values ($1) returning id`, [teamId])).rows[0].id;
  const count = (await q(`select count(*)::int as c from public.messages where conversation_id = $1`, [conv])).rows[0].c;
  if (count >= msgs.length) return conv;
  let i = 0;
  for (const m of msgs) {
    const dup = await q(`select 1 from public.messages where conversation_id = $1 and body = $2 limit 1`, [conv, m.body]);
    if (dup.rows[0]) continue;
    await q(
      `insert into public.messages (conversation_id, sender_id, body, pinned, created_at) values ($1,$2,$3,$4,$5)`,
      [conv, ids[m.from], m.body, !!m.pinned, D(m.daysAgo ? -m.daysAgo : 0, m.hours ?? 0)],
    );
    i++;
  }
  return conv;
}

const convDelta = await ensureConversation(teamDelta, [
  { from: "alice", body: "Team Delta is official! Approved by admin ✅", daysAgo: 4, pinned: true },
  { from: "omar", body: "Nice. I linked my Codeforces handle — sync picked up my solves automatically.", daysAgo: 3 },
  { from: "mona", body: "I'm 4/6 on Sheet 1, Watermelon still failing on test 3 😅", daysAgo: 2 },
  { from: "alice", body: "Check the parity of w — if it's odd it's impossible.", daysAgo: 2 },
  { from: "mona", body: "Got it, accepted! Starting Assignment 2 tonight.", daysAgo: 1 },
  { from: "alice", body: "Reminder: Weekly Virtual Contest #3 registration closes in 3 days. Register!", daysAgo: 0, hours: -3 },
]);
const convBinary = await ensureConversation(teamBinary, [
  { from: "yousef", body: "Welcome Sara! We still need one more member for the full roster.", daysAgo: 3, pinned: true },
  { from: "sara", body: "Thanks! I've just started — mostly doing 800-rated problems.", daysAgo: 2 },
  { from: "yousef", body: "Perfect, start with Sheet 1 and ask here when stuck.", daysAgo: 1 },
]);
for (const [conv, members] of [[convDelta, ["alice", "omar", "mona"]], [convBinary, ["yousef", "sara"]]]) {
  for (const key of members) {
    await q(
      `insert into public.conversation_read_states (conversation_id, user_id, last_read_at)
       values ($1,$2,$3) on conflict do nothing`,
      [conv, ids[key], key === "alice" ? D(-1) : new Date()],
    );
  }
}
console.log("chat seeded");

// ---------------------------------------------------------------------------
// 3) Training: weeks 2-3, resources, sessions (past + upcoming)
// ---------------------------------------------------------------------------
async function ensureWeek(weekNumber, title, status, extra) {
  const existing = (await q(`select id from public.training_weeks where week_number = $1`, [weekNumber])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.training_weeks (week_number, title, description, objectives, topics, status, publish_at, start_date, end_date)
     values ($1,$2,$3,$4::text[],$5::text[],$6, case when $6 = 'published' then now() else null end, $7, $8) returning id`,
    [weekNumber, title, extra.desc, extra.objectives, extra.topics, status, extra.start ?? D(7), extra.end ?? D(14)],
  )).rows[0].id;
}
const week2 = await ensureWeek(2, "Week 2 — Number Theory Basics", "published", {
  desc: "Divisibility, primes, GCD/LCM, and modular arithmetic.",
  objectives: ["Apply divisibility rules", "Compute GCD with Euclid", "Solve basic number-theory problems"],
  topics: ["math", "number-theory"], start: D(7), end: D(14),
});
const week3 = await ensureWeek(3, "Week 3 — Dynamic Programming Intro", "draft", {
  desc: "Memoization, tabulation, and classic DP patterns.",
  objectives: ["Recognize overlapping subproblems", "Implement top-down and bottom-up DP"],
  topics: ["dynamic-programming"], start: D(14), end: D(21),
});

async function ensureResource(weekId, title, kind, url, order) {
  const existing = (await q(`select id from public.training_resources where week_id = $1 and title = $2`, [weekId, title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(`insert into public.training_resources (week_id, title, kind, url, sort_order) values ($1,$2,$3,$4,$5) returning id`, [weekId, title, kind, url, order])).rows[0].id;
}
const w2res = [
  await ensureResource(week2, "Number theory primer (e-maxx)", "document", "https://cp-algorithms.com/algebra/", 1),
  await ensureResource(week2, "Euclid's algorithm video", "youtube", "https://www.youtube.com/watch?v=H_2nq4XpFxw", 2),
  await ensureResource(week2, "Practice set: divisibility", "practice_sheet", "https://codeforces.com/problemset/tags/math", 3),
];

// Past session (for attendance) + upcoming week-2 session
async function ensureSession(title, startsAt, endsAt, loc, weekId, mentorKey = null) {
  const existing = (await q(`select id from public.training_sessions where title = $1`, [title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.training_sessions (title, description, starts_at, ends_at, location, week_id, mentor_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [title, `Session: ${title}`, startsAt, endsAt, loc, weekId, mentorKey ? ids[mentorKey] : null],
  )).rows[0].id;
}
const pastSession = await ensureSession("Week 0 — Orientation & environment setup", D(-4, -8), D(-4, -6), "Hall B, Faculty of Computers", null);
const w2session = await ensureSession("Week 2 session — primes & gcd workshop", D(5, 6), D(5, 8), "Lab 3 + Zoom", week2, "mentor");
console.log("training seeded");

// ---------------------------------------------------------------------------
// 4) Problems, Sheet 2, topic links
// ---------------------------------------------------------------------------
async function ensureProblem(externalId, title, url, rating) {
  return (await q(
    `insert into public.problems (source, external_id, title, url, rating) values ('codeforces',$1,$2,$3,$4)
     on conflict (source, external_id) do update set title = excluded.title returning id`,
    [externalId, title, url, rating],
  )).rows[0].id;
}

// Sheet 1 problems (already seeded) + Sheet 2 + contest problems
const sheet1Ids = {};
for (const [ext, title, url] of [
  ["4A", "Watermelon", "https://codeforces.com/problemset/problem/4/A"],
  ["71A", "Way Too Long Words", "https://codeforces.com/problemset/problem/71/A"],
  ["231A", "Team", "https://codeforces.com/problemset/problem/231/A"],
  ["158A", "Next Round", "https://codeforces.com/problemset/problem/158/A"],
  ["50A", "Domino piling", "https://codeforces.com/problemset/problem/50/A"],
  ["282A", "Bit++", "https://codeforces.com/problemset/problem/282/A"],
]) sheet1Ids[ext] = await ensureProblem(ext, title, url, 800);

const sheet2Ids = {};
for (const [ext, title, rating] of [
  ["110A", "Nearly Lucky Number", 900],
  ["236A", "Boy or Girl", 900],
  ["96A", "Football", 900],
  ["112A", "Petya and Strings", 900],
  ["339A", "Helpful Maths", 800],
  ["61A", "Ultra-Fast Mathematician", 800],
]) sheet2Ids[ext] = await ensureProblem(ext, title, `https://codeforces.com/problemset/problem/${ext.replace("A", "")}/${ext.slice(-1)}`, rating);

const contestProblemIds = {};
for (const [ext, title, rating] of [
  ["977A", "Wrong Subtraction", 800],
  ["118A", "String Task", 800],
  ["281A", "Word Capitalization", 800],
  ["263A", "Beautiful Matrix", 800],
  ["520A", "Pangram", 1000],
  ["1A", "Theatre Square", 1000],
  ["116A", "Tram", 1000],
  ["160A", "Twins", 1100],
]) contestProblemIds[ext] = await ensureProblem(ext, title, `https://codeforces.com/problemset/problem/${ext.replace("A", "")}/${ext.slice(-1)}`, rating);

async function ensureSheet(title, opts) {
  const existing = (await q(`select id from public.problem_sheets where title = $1`, [title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.problem_sheets (title, description, week_id, difficulty, objectives, status, deadline)
     values ($1,$2,$3,$4,$5::text[],$6,$7) returning id`,
    [title, opts.desc, opts.weekId, opts.difficulty, opts.objectives, opts.status, opts.deadline ?? null],
  )).rows[0].id;
}
const sheet2 = await ensureSheet("Sheet 2 — Number Theory", {
  desc: "Divisibility, strings over sets, and simple math constructions.",
  weekId: week2, difficulty: "easy", objectives: ["GCD/LCM", "Digit manipulation", "Sorting tricks"],
  status: "published", deadline: D(6),
});

async function sheetItem(sheetId, problemId, order) {
  await q(`insert into public.problem_sheet_items (sheet_id, problem_id, sort_order) values ($1,$2,$3) on conflict do nothing`, [sheetId, problemId, order]);
}
for (const [i, pid] of Object.values(sheet2Ids).entries()) await sheetItem(sheet2, pid, i + 1);

// Topic links for the skill map
const topicId = {};
for (const row of (await q(`select id, slug from public.topics`)).rows) topicId[row.slug] = row.id;
async function linkProblemTopic(problemId, slug) {
  if (topicId[slug]) await q(`insert into public.problem_topics (problem_id, topic_id) values ($1,$2) on conflict do nothing`, [problemId, topicId[slug]]);
}
for (const [ext, slugs] of Object.entries({ "4A": ["implementation", "math"], "71A": ["implementation", "strings"], "231A": ["implementation", "brute-force"], "158A": ["implementation", "sorting"], "50A": ["math", "greedy"], "282A": ["implementation"] })) {
  for (const s of slugs) await linkProblemTopic(sheet1Ids[ext], s);
}
async function linkSheetTopic(sheetId, slug) {
  if (topicId[slug]) await q(`insert into public.sheet_topics (sheet_id, topic_id) values ($1,$2) on conflict do nothing`, [sheetId, topicId[slug]]);
}
const sheet1Id = (await q(`select id from public.problem_sheets where title like 'Sheet 1%'`)).rows[0].id;
for (const s of ["implementation", "arrays-strings", "brute-force"]) await linkSheetTopic(sheet1Id, s);
for (const s of ["math", "number-theory", "strings", "sorting"]) await linkSheetTopic(sheet2, s);
console.log("problems/sheets/topics ready");

// ---------------------------------------------------------------------------
// 5) Completions: problems, materials, milestones
// ---------------------------------------------------------------------------
async function completeProblem(key, problemId, source = "manual") {
  await q(
    `insert into public.problem_completions (user_id, problem_id, source, verified_at, completed_at)
     values ($1,$2,$3, case when $3 = 'codeforces' then now() else null end, now() - interval '1 day' * floor(random()*3)) on conflict do nothing`,
    [ids[key], problemId, source],
  );
}
const S1 = Object.values(sheet1Ids), S2 = Object.values(sheet2Ids);
for (const p of S1.slice(0, 5)) { await completeProblem("alice", p, "codeforces"); }
await completeProblem("alice", S2[0], "codeforces"); await completeProblem("alice", S2[1], "codeforces"); await completeProblem("alice", S2[2], "codeforces");
for (const p of S1.slice(0, 3)) await completeProblem("omar", p, "codeforces");
for (const p of S2.slice(0, 2)) await completeProblem("omar", p);
for (const p of S1.slice(0, 4)) await completeProblem("mona", p);
for (const p of S1.slice(0, 2)) await completeProblem("yousef", p);
await completeProblem("yousef", S1[5]);
await completeProblem("sara", S1[0]);
await completeProblem("khaled", S1[0]);
await completeProblem("rania", S1[0]); await completeProblem("rania", S1[1]);

async function completeMaterial(key, resourceId) {
  if (!resourceId) return;
  await q(`insert into public.material_completions (user_id, resource_id) values ($1,$2) on conflict do nothing`, [ids[key], resourceId]);
}
await completeMaterial("alice", w2res[0]); await completeMaterial("alice", w2res[1]); await completeMaterial("alice", w2res[2]);
await completeMaterial("omar", w2res[0]); await completeMaterial("omar", w2res[1]);
await completeMaterial("mona", w2res[0]);

// Roadmap milestones 2-3 + prerequisites
async function ensureMilestone(title, opts) {
  const existing = (await q(`select id from public.roadmap_milestones where title = $1`, [title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.roadmap_milestones (title, description, objectives, topic_slugs, week_id, sheet_id, assignment_id,
       completion_threshold, hard_prerequisite, sort_order, target_date, status)
     values ($1,$2,$3::text[],$4::text[],$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [title, opts.desc, opts.objectives, opts.topics, opts.weekId ?? null, opts.sheetId ?? null, opts.assignmentId ?? null,
     0.8, !!opts.hard, opts.sort, opts.target ?? null, opts.status],
  )).rows[0].id;
}
const m1Id = (await q(`select id from public.roadmap_milestones where title like 'Milestone 1%'`)).rows[0]?.id;
const m2Id = await ensureMilestone("Milestone 2 — Number Theory", {
  desc: "Master divisibility, primes and modular arithmetic; finish Sheet 2 and Assignment 2.",
  objectives: ["Complete Week 2 materials", "Solve 70% of Sheet 2", "Submit Assignment 2"],
  topics: ["math", "number-theory"], weekId: week2, sheetId: sheet2, assignmentId: null, hard: true, sort: 2,
  target: D(21), status: "published",
});
const m3Id = await ensureMilestone("Milestone 3 — Dynamic Programming", {
  desc: "First steps into DP: memoization and classic patterns.",
  objectives: ["Complete Week 3 materials", "Solve 5 introductory DP problems"],
  topics: ["dynamic-programming"], weekId: week3, sort: 3, target: D(35), status: "draft",
});
for (const [milestone, prereq] of [[m2Id, m1Id], [m3Id, m2Id]]) {
  if (milestone && prereq) await q(`insert into public.roadmap_prerequisites (milestone_id, prerequisite_id) values ($1,$2) on conflict do nothing`, [milestone, prereq]);
}
async function completeMilestone(key, milestoneId, override = false) {
  if (!milestoneId) return;
  await q(
    `insert into public.milestone_completions (user_id, milestone_id, override, overridden_by, override_reason)
     values ($1,$2,$3, case when $3 then $4::uuid else null end, case when $3 then $5 else null end) on conflict do nothing`,
    [ids[key], milestoneId, override, adminId, override ? "Joined the program one week late — manually cleared after review." : null],
  );
}
await completeMilestone("alice", m1Id); await completeMilestone("omar", m1Id); await completeMilestone("yousef", m1Id);
await completeMilestone("mona", m1Id, true);
console.log("completions + roadmap ready");

// ---------------------------------------------------------------------------
// 6) Assignments 2-3, submissions (A1 due date moved to past for realism)
// ---------------------------------------------------------------------------
await q(`update public.assignments set due_at = $2, starts_at = $3 where title like $1`, ["Assignment 1%", D(-2, 10), D(-9)]);
const a1Id = (await q(`select id from public.assignments where title like 'Assignment 1%'`)).rows[0]?.id;

async function ensureAssignment(title, opts) {
  const existing = (await q(`select id from public.assignments where title = $1`, [title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.assignments (title, description, instructions, topics, difficulty, starts_at, due_at, max_score,
       week_id, sheet_id, mode, reminder_target, status)
     values ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [title, opts.desc, opts.instructions, opts.topics, opts.difficulty, opts.starts ?? D(0), opts.due, opts.maxScore,
     opts.weekId ?? null, opts.sheetId ?? null, opts.mode, opts.reminderTarget ?? "all", opts.status],
  )).rows[0].id;
}
const a2Id = await ensureAssignment("Assignment 2 — Number Theory Set", {
  desc: "Solve Sheet 2 and submit your approach notes.",
  instructions: "Team submission: include one accepted submission link per problem and a short note on the trick used.",
  topics: ["math", "number-theory"], difficulty: "easy", due: D(4, 12), maxScore: 100,
  weekId: week2, sheetId: sheet2, mode: "team", reminderTarget: "leader", status: "published",
});
await ensureAssignment("Assignment 3 — Binary Search Practice", {
  desc: "Draft assignment for week 3 — not published yet.",
  instructions: "Will appear here once the admin publishes it.",
  topics: ["binary-search"], difficulty: "medium", due: D(15), maxScore: 100, mode: "individual", status: "draft",
});

async function ensureSubmission(assignmentId, studentId, opts) {
  if ((await q(`select 1 from public.assignment_submissions where assignment_id = $1 and student_id = $2`, [assignmentId, studentId])).rows[0]) return;
  await q(
    `insert into public.assignment_submissions (assignment_id, student_id, team_id, content_url, notes, status, score, feedback, reviewed_by, reviewed_at, submitted_at)
     values ($1,$2,$3,$4,$5,$6,$7::numeric,$8, case when $7::numeric is null then null else $9::uuid end, case when $7::numeric is null then null else now() end, $10)`,
    [assignmentId, studentId, opts.teamId ?? null, opts.url ?? null, opts.notes ?? null, opts.status, opts.score ?? null,
     opts.feedback ?? null, adminId, opts.submittedAt ?? D(-1)],
  );
}
await ensureSubmission(a1Id, ids.alice, { url: "https://codeforces.com/submissions/AliceFahmyDemo", status: "accepted", score: 100, feedback: "Excellent — all 6 accepted. Try the harder 900s next.", submittedAt: D(-3) });
await ensureSubmission(a1Id, ids.omar, { url: "https://codeforces.com/submissions/OmarDemo", status: "under_review", submittedAt: D(-2) });
await ensureSubmission(a1Id, ids.mona, { url: "https://codeforces.com/submissions/MonaDemo", status: "late", notes: "Submitted after the deadline — computer broke.", submittedAt: D(-1) });
await ensureSubmission(a1Id, ids.yousef, { url: "https://codeforces.com/submissions/YousefDemo", status: "needs_improvement", score: 60, feedback: "3/6 accepted. Revisit conditionals in Week 1 slides.", submittedAt: D(-3) });
await ensureSubmission(a2Id, ids.alice, { teamId: teamDelta, url: "https://github.com/delta-force/nt-set", notes: "Team Delta submission — 4/6 solved so far.", status: "submitted", submittedAt: D(0, -2) });
console.log("assignments + submissions ready");

// ---------------------------------------------------------------------------
// 7) Contests: upcoming team, upcoming individual, past with results
// ---------------------------------------------------------------------------
async function ensureContest(title, opts) {
  const existing = (await q(`select id from public.virtual_contests where title = $1`, [title])).rows[0]?.id;
  if (existing) return existing;
  return (await q(
    `insert into public.virtual_contests (title, description, starts_at, ends_at, registration_deadline, participation,
       scoring_mode, penalty_minutes, rules, external_url, announcement, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [title, opts.desc, opts.starts, opts.ends, opts.regDeadline, opts.participation, opts.scoring ?? "icpc",
     opts.penalty ?? 20, opts.rules ?? null, opts.url ?? null, opts.announcement ?? null, opts.status, adminId],
  )).rows[0].id;
}
const cUpcoming = await ensureContest("Weekly Virtual Contest #3", {
  desc: "Regular team contest — 5 problems, ICPC scoring, 2 hours.",
  starts: D(5), ends: D(5, 2), regDeadline: D(3), participation: "team", status: "scheduled",
  announcement: "Register as a team before the deadline. Individual registrations are ignored for team contests.",
  rules: "Standard ICPC rules: 20-minute penalty per wrong submission.",
});
const cIndividual = await ensureContest("Individual Sprint #1", {
  desc: "Solo speed round — 6 easy problems, 90 minutes, points scoring.",
  starts: D(7, 4), ends: D(7, 6), regDeadline: D(6), participation: "individual", scoring: "points", status: "scheduled",
});
const cPast = await ensureContest("Mock Regional #1", {
  desc: "Full mock of a regional format — 5 problems, 3 hours.",
  starts: D(-10), ends: D(-10, 3), regDeadline: D(-12), participation: "team", status: "completed",
});

async function contestProblem(contestId, code, problemId, order) {
  await q(
    `insert into public.contest_problems (contest_id, code, title, url, points, sort_order)
     select $1,$2,p.title,p.url,$4,$5 from public.problems p where p.id = $3
     on conflict do nothing`,
    [contestId, code, problemId, order <= 4 ? 100 : 200, order],
  );
}
for (const [i, [code, ext]] of [["A", "977A"], ["B", "118A"], ["C", "281A"], ["D", "263A"], ["E", "520A"]].entries()) await contestProblem(cUpcoming, code, contestProblemIds[ext], i + 1);
for (const [i, [code, ext]] of [["A", "1A"], ["B", "116A"], ["C", "160A"], ["D", "263A"], ["E", "520A"]].entries()) await contestProblem(cPast, code, contestProblemIds[ext], i + 1);

async function registerTeam(contestId, teamId, byKey) {
  if (!(await q(`select 1 from public.contest_registrations where contest_id = $1 and team_id = $2`, [contestId, teamId])).rows[0]) {
    await q(`insert into public.contest_registrations (contest_id, team_id, student_id, registered_by) values ($1,$2,null,$3)`, [contestId, teamId, ids[byKey]]);
  }
}
async function registerStudent(contestId, key) {
  if (!(await q(`select 1 from public.contest_registrations where contest_id = $1 and student_id = $2`, [contestId, ids[key]])).rows[0]) {
    await q(`insert into public.contest_registrations (contest_id, team_id, student_id, registered_by) values ($1,null,$2,$2)`, [contestId, ids[key]]);
  }
}
await registerTeam(cUpcoming, teamDelta, "alice");
await registerTeam(cUpcoming, teamBinary, "yousef");
await registerStudent(cIndividual, "alice"); await registerStudent(cIndividual, "yousef"); await registerStudent(cIndividual, "rania");
await registerTeam(cPast, teamDelta, "alice"); await registerTeam(cPast, teamBinary, "yousef");

async function ensureResult(contestId, teamId, solved, penalty, problems) {
  let rid = (await q(`select id from public.contest_results where contest_id = $1 and team_id = $2`, [contestId, teamId])).rows[0]?.id;
  if (!rid) {
    rid = (await q(
      `insert into public.contest_results (contest_id, team_id, solved_count, total_score, penalty_minutes, source, entered_by)
       values ($1,$2,$3::int,$3::numeric,$4,'manual',$5) returning id`,
      [contestId, teamId, solved, penalty, adminId],
    )).rows[0].id;
  }
  for (const p of problems) {
    if ((await q(`select 1 from public.contest_problem_results where result_id = $1 and problem_code = $2`, [rid, p.code])).rows[0]) continue;
    await q(
      `insert into public.contest_problem_results (result_id, problem_code, solved, attempts, solve_time_minutes, points)
       values ($1,$2,$3,$4,$5,$6)`,
      [rid, p.code, p.solved, p.attempts, p.time ?? null, p.solved ? 100 : 0],
    );
  }
}
await ensureResult(cPast, teamDelta, 4, 142, [
  { code: "A", solved: true, attempts: 1, time: 25 },
  { code: "B", solved: true, attempts: 1, time: 40 },
  { code: "C", solved: true, attempts: 2, time: 95 },
  { code: "D", solved: true, attempts: 1, time: 140 },
  { code: "E", solved: false, attempts: 3 },
]);
await ensureResult(cPast, teamBinary, 3, 180, [
  { code: "A", solved: true, attempts: 2, time: 35 },
  { code: "B", solved: true, attempts: 1, time: 60 },
  { code: "C", solved: true, attempts: 3, time: 150 },
  { code: "D", solved: false, attempts: 2 },
  { code: "E", solved: false, attempts: 1 },
]);
console.log("contests ready");

// ---------------------------------------------------------------------------
// 8) Attendance for the past session
// ---------------------------------------------------------------------------
if (pastSession) {
  const attendance = [
    ["alice", "present", null], ["omar", "present", null], ["mona", "late", "Arrived 20 minutes late"],
    ["yousef", "absent", "No prior notice"], ["sara", "excused", "Medical appointment"], ["khaled", "present", null],
  ];
  for (const [key, status, note] of attendance) {
    await q(
      `insert into public.attendance_records (session_id, student_id, status, note, recorded_by)
       select $1,$2,$3,$4,$5 where not exists (select 1 from public.attendance_records where session_id = $1 and student_id = $2)`,
      [pastSession, ids[key], status, note, adminId],
    );
  }
}
console.log("attendance ready");

// ---------------------------------------------------------------------------
// 9) Mentorship: mentor profile, availability, blackout, bookings, notes
// ---------------------------------------------------------------------------
if (!(await q(`select 1 from public.mentors where profile_id = $1`, [ids.mentor])).rows[0]) {
  await q(
    `insert into public.mentors (profile_id, headline, bio, expertise, session_types, default_duration_minutes)
     values ($1,$2,$3,$4::text[],$5::text[],45)`,
    [ids.mentor, "ICPC Regionalist · Level 2 mentor",
     "Two years of ICPC regionals. I help with DP, graphs and contest strategy.",
     ["dynamic-programming", "graphs", "codeforces-strategy", "number-theory"],
     ["1:1 doubt clearing", "Code review", "Mock interview"]],
  );
}
// mentor_id columns reference the mentors row, not the profile
const mentorRowId = (await q(`select id from public.mentors where profile_id = $1`, [ids.mentor])).rows[0].id;
for (const [day, start, end] of [[4, "18:00", "21:00"], [5, "18:00", "21:00"], [6, "10:00", "13:00"]]) {
  await q(
    `insert into public.mentor_availability_rules (mentor_id, day_of_week, start_time, end_time, duration_minutes, buffer_minutes, max_per_day, min_notice_hours)
     select $1,$2,$3::time,$4::time,45,10,4,12 where not exists (
       select 1 from public.mentor_availability_rules where mentor_id = $1 and day_of_week = $2 and start_time = $3::time)`,
    [mentorRowId, day, start, end],
  );
}
await q(
  `insert into public.mentor_blackouts (mentor_id, date, reason) select $1, current_date + 9, 'Midterm exams week'
   where not exists (select 1 from public.mentor_blackouts where mentor_id = $1 and date = current_date + 9)`,
  [mentorRowId],
);

async function ensureBooking(key, topic, startsAt, hours, status, extra = {}) {
  if ((await q(`select 1 from public.mentor_bookings where mentor_id = $1 and student_id = $2 and topic = $3`, [mentorRowId, ids[key], topic])).rows[0]) return null;
  return (await q(
    `insert into public.mentor_bookings (mentor_id, student_id, topic, description, related_topic, starts_at, ends_at, status, meeting_url, outcome_notes, cancel_reason, cancelled_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [mentorRowId, ids[key], topic, extra.desc ?? null, extra.relatedTopic ?? null, startsAt,
     new Date(startsAt.getTime() + hours * 36e5), status, extra.url ?? null, extra.outcome ?? null, extra.cancelReason ?? null, extra.cancelledBy ? ids[extra.cancelledBy] : null],
  )).rows[0].id;
}
await ensureBooking("rania", "Introduction to dynamic programming", D(3, 8), 0.75, "pending", { desc: "Never written a DP before — want a gentle start.", relatedTopic: "dynamic-programming" });
await ensureBooking("alice", "Codeforces strategy review", D(5, 9), 0.75, "confirmed", { desc: "Review my last virtual contest and rating plan.", relatedTopic: "codeforces-strategy", url: "https://meet.google.com/icpc-mentor-demo" });
const doneBooking = await ensureBooking("omar", "Recursion & backtracking clinic", D(-6, 8), 0.75, "completed", { desc: "Struggling with recursive enumeration problems.", relatedTopic: "recursion", outcome: "Covered base cases and pruning; assigned 3 practice problems from Sheet 1." });
await ensureBooking("sara", "Getting started with C++", D(-2, 10), 0.5, "cancelled", { cancelReason: "Conflict with a lecture", cancelledBy: "sara" });
if (doneBooking) {
  await q(
    `insert into public.mentor_session_notes (booking_id, private_notes, recommended_resources)
     values ($1,$2,$3::jsonb) on conflict do nothing`,
    [doneBooking, "Omar has solid intuition; needs discipline writing base cases first. Recommended: cp-algorithms recursion chapter.",
      JSON.stringify([{ title: "cp-algorithms — Recursion", url: "https://cp-algorithms.com/" }])],
  );
}
console.log("mentorship ready");

// ---------------------------------------------------------------------------
// 10) Support tickets + replies
// ---------------------------------------------------------------------------
async function ensureSupport(key, subject, category, description, status, replies) {
  let requestId = (await q(`select id from public.support_requests where student_id = $1 and subject = $2`, [ids[key], subject])).rows[0]?.id;
  if (!requestId) {
    requestId = (await q(
      `insert into public.support_requests (student_id, subject, category, description, status, assigned_to)
       values ($1,$2,$3,$4,$5, case when $5 <> 'open' then $6::uuid else null end) returning id`,
      [ids[key], subject, category, description, status, adminId],
    )).rows[0].id;
  }
  for (const r of replies) {
    await q(
      `insert into public.support_replies (request_id, author_id, body, internal)
       select $1,$2,$3,$4 where not exists (select 1 from public.support_replies where request_id = $1 and body = $3)`,
      [requestId, r.from === "admin" ? adminId : ids[r.from], r.body, !!r.internal],
    );
  }
}
await ensureSupport("rania", "Cannot upload my avatar", "account", "Uploading a PNG avatar from the profile page spins forever and nothing is saved.", "open",
  [{ from: "admin", body: "Checking the storage bucket policy — will update you shortly.", internal: true }]);
await ensureSupport("mona", "Codeforces sync stuck at 'queued'", "codeforces", "I linked my handle an hour ago and the sync status is still queued. My solves are not appearing on Sheet 1.", "resolved",
  [{ from: "admin", body: "The sync worker runs every 30 minutes — your account is processed now and 4 solves were imported. Marking as resolved." }]);
console.log("support ready");

// ---------------------------------------------------------------------------
// 11) Notifications + preferences
// ---------------------------------------------------------------------------
async function ensureNotification(key, kind, title, body, link, daysAgo, read = false) {
  await q(
    `insert into public.notifications (recipient_id, kind, title, body, link, created_at, read_at)
     select $1,$2,$3,$4,$5,$6, case when $7 then now() else null end
     where not exists (select 1 from public.notifications where recipient_id = $1 and title = $3)`,
    [ids[key], kind, title, body, link, D(-daysAgo), read],
  );
}
await ensureNotification("alice", "assignment_deadline", "Assignment 2 due in 4 days", "Number Theory Set closes soon — leader should submit for Team Delta.", "/assignments", 0);
await ensureNotification("alice", "team_invitation", "Rania wants to join a team", "You invited Rania Samir to Delta Force — awaiting her response.", "/team", 1);
await ensureNotification("alice", "announcement", "Contest results posted", "Mock Regional #1 results are up — Delta Force placed 1st.", "/contests", 8, true);
await ensureNotification("omar", "attendance_recorded", "Attendance recorded", "Week 0 orientation — you were marked present.", "/attendance", 4, true);
await ensureNotification("omar", "sheet_published", "New sheet published", "Sheet 2 — Number Theory is now open.", "/sheets", 2);
await ensureNotification("mona", "support", "Support request resolved", "Your Codeforces sync ticket was marked resolved.", "/support", 1);
await ensureNotification("rania", "info", "Welcome to the community", "Complete your profile and request to join a team to get started.", "/profile", 5);
await q(
  `insert into public.notification_preferences (user_id, email_enabled, email_kinds, muted_kinds)
   values ($1, false, '{}', '{system}') on conflict (user_id) do nothing`,
  [ids.alice],
);
await q(
  `insert into public.notification_preferences (user_id, email_enabled, email_kinds, muted_kinds)
   values ($1, true, '{assignment_deadline, announcement}', '{}') on conflict (user_id) do nothing`,
  [ids.mona],
);
console.log("notifications ready");

// ---------------------------------------------------------------------------
// 12) Codeforces: real public data for 4 handles
// ---------------------------------------------------------------------------
const CF_HANDLES = { alice: "Um_nik", omar: "pajenegod", mona: "adamant", yousef: "SecondThread" };
async function cfApi(path) {
  const res = await fetch(`https://codeforces.com/api/${path}`);
  if (!res.ok) throw new Error(`CF ${res.status}`);
  const j = await res.json();
  if (j.status !== "OK") throw new Error(`CF api status ${j.status}`);
  return j.result;
}
for (const [key, handle] of Object.entries(CF_HANDLES)) {
  try {
    const info = (await cfApi(`user.info?handles=${handle}`))[0];
    let accountId = (await q(`select id from public.codeforces_accounts where user_id = $1`, [ids[key]])).rows[0]?.id;
    if (!accountId) {
      accountId = (await q(
        `insert into public.codeforces_accounts (user_id, handle, verified, sync_status, last_synced_at)
         values ($1,$2,true,'ok', now()) returning id`,
        [ids[key], handle],
      )).rows[0].id;
    }
    await q(
      `insert into public.codeforces_snapshots (account_id, handle, rating, max_rating, rank, max_rank, contribution, title_photo, contests_count, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       on conflict (account_id) do update set rating = excluded.rating, max_rating = excluded.max_rating, rank = excluded.rank,
         max_rank = excluded.max_rank, contribution = excluded.contribution, title_photo = excluded.title_photo, fetched_at = now()`,
      [accountId, info.handle, info.rating ?? null, info.maxRating ?? null, info.rank ?? null, info.maxRank ?? null, info.contribution ?? 0, info.titlePhoto ?? null, 0],
    );
    const rating = await cfApi(`user.rating?handle=${handle}`).catch(() => []);
    let i = 0;
    for (const r of rating.slice(-8)) {
      await q(
        `insert into public.codeforces_rating_history (account_id, contest_id, contest_name, rank, rating_update_at, old_rating, new_rating)
         values ($1,$2,$3,$4,to_timestamp($5),$6,$7) on conflict (account_id, contest_id) do nothing`,
        [accountId, r.contestId, r.contestName, r.rank, r.ratingUpdateTimeSeconds, r.oldRating, r.newRating],
      );
      i++;
    }
    const subs = await cfApi(`user.status?handle=${handle}&from=1&count=250`).catch(() => []);
    const solved = [];
    const seen = new Set();
    for (const s of subs) {
      if (s.verdict !== "OK" || !s.problem?.contestId) continue;
      const k = `${s.problem.contestId}-${s.problem.index}`;
      if (seen.has(k)) continue;
      seen.add(k);
      solved.push([s.problem.contestId, s.problem.index, s.problem.name, s.problem.rating ?? null, s.problem.tags ?? [], s.creationTimeSeconds]);
      if (solved.length >= 120) break;
    }
    for (let c = 0; c < solved.length; c += 40) {
      const chunk = solved.slice(c, c + 40);
      const values = chunk.map((_, j) => `($1,$${j * 6 + 2},$${j * 6 + 3},$${j * 6 + 4},$${j * 6 + 5},$${j * 6 + 6}::text[],to_timestamp($${j * 6 + 7}))`).join(",");
      const params = [accountId];
      chunk.forEach((row) => params.push(...row));
      await q(`insert into public.codeforces_solved (account_id, contest_id, problem_index, problem_name, rating, tags, solved_at) values ${values} on conflict (account_id, contest_id, problem_index) do nothing`, params);
    }
    console.log(`codeforces ${key} (${handle}): snapshot + ${i} rating entries + ${solved.length} solves`);
  } catch (e) {
    console.warn(`codeforces ${key} (${handle}) skipped: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n=== TEST DATA SEEDED ===");
console.log(`Password for every test account: ${PASSWORD}`);
console.log("\nAccounts:");
for (const u of USERS) console.log(`  ${u.email.padEnd(28)} ${u.role.padEnd(7)} ${u.status}`);
console.log("\nStudent logins to try: alice.demo@icpc-sgu.dev (rich data), rania.demo@icpc-sgu.dev (no team, has bookings), hana.demo@icpc-sgu.dev (pending approval)");
await client.end();

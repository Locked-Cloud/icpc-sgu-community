#!/usr/bin/env node
/**
 * OPTIONAL demo content for development/preview environments.
 * Creates: a published training week + resources, a problem sheet with real
 * Codeforces problems, an assignment, an announcement, a roadmap milestone,
 * and a training session. Does NOT create users.
 *
 * Usage: SUPABASE_DB_URL=... node scripts/seed-demo.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});

await client.connect();

const q = (sql, params = []) => client.query(sql, params);

// Training week
const week = await q(
  `insert into public.training_weeks (week_number, title, description, objectives, topics, status, publish_at)
   values (1, 'Week 1 — Programming Fundamentals',
           'Variables, conditionals, loops, and basic I/O.',
           array['Write basic C++ programs','Use conditionals and loops','Read input and produce output'],
           array['implementation'], 'published', now())
   on conflict do nothing returning id`,
);
const weekId = week.rows[0]?.id;
console.log("training week:", weekId ?? "exists");

if (weekId) {
  await q(
    `insert into public.training_resources (week_id, title, kind, url, sort_order)
     values
       ($1, 'Fundamentals slides', 'slides', 'https://codeforces.com/blog/entry/4530', 1),
       ($1, 'C++ reference', 'link', 'https://en.cppreference.com/w/', 2),
       ($1, 'Practice: Watermelon', 'problem', 'https://codeforces.com/problemset/problem/4/A', 3)`,
    [weekId],
  );
}

// Problems + sheet
const problems = [
  ["4A", "Watermelon", "https://codeforces.com/problemset/problem/4/A", 800],
  ["71A", "Way Too Long Words", "https://codeforces.com/problemset/problem/71/A", 800],
  ["231A", "Team", "https://codeforces.com/problemset/problem/231/A", 800],
  ["158A", "Next Round", "https://codeforces.com/problemset/problem/158/A", 800],
  ["50A", "Domino piling", "https://codeforces.com/problemset/problem/50/A", 800],
  ["282A", "Bit++", "https://codeforces.com/problemset/problem/282/A", 800],
];
const problemIds = [];
for (const [ext, title, url, rating] of problems) {
  const r = await q(
    `insert into public.problems (source, external_id, title, url, rating)
     values ('codeforces', $1, $2, $3, $4)
     on conflict (source, external_id) do update set title = excluded.title
     returning id`,
    [ext, title, url, rating],
  );
  problemIds.push(r.rows[0].id);
}

const sheet = await q(
  `insert into public.problem_sheets (title, description, difficulty, objectives, status)
   values ('Sheet 1 — Programming Fundamentals',
           'Warm-up implementation problems.',
           'easy', array['Basic I/O','Conditionals','Loops'], 'published')
   returning id`,
);
const sheetId = sheet.rows[0].id;
for (let i = 0; i < problemIds.length; i++) {
  await q(
    `insert into public.problem_sheet_items (sheet_id, problem_id, sort_order) values ($1, $2, $3)`,
    [sheetId, problemIds[i], i + 1],
  );
}
console.log("problem sheet:", sheetId);

// Assignment
const assignment = await q(
  `insert into public.assignments (title, description, instructions, topics, difficulty, due_at, status, sheet_id, week_id)
   values ('Assignment 1 — Warm-up problems',
           'Solve the fundamentals sheet.',
           'Submit a link to your Codeforces submissions or repository.',
           array['implementation'], 'easy', now() + interval '7 days', 'published', $1, $2)
   returning id`,
  [sheetId, weekId],
);
console.log("assignment:", assignment.rows[0].id);

// Roadmap milestone
await q(
  `insert into public.roadmap_milestones (title, description, topic_slugs, week_id, sheet_id, assignment_id, sort_order, target_date, status)
   values ('Milestone 1 — Fundamentals',
           'Complete week 1 materials and the fundamentals sheet.',
           array['implementation'], $1, $2, $3, 1, current_date + 14, 'published')`,
  [weekId, sheetId, assignment.rows[0].id],
);
console.log("roadmap milestone created");

// Training session
await q(
  `insert into public.training_sessions (title, description, starts_at, ends_at, location, week_id)
   values ('Week 1 session — intro & environment setup',
           'Introduction to the community and C++ setup.',
           now() + interval '3 days', now() + interval '3 days 2 hours', 'To be announced', $1)`,
  [weekId],
);
console.log("training session created");

// Announcement
await q(
  `insert into public.announcements (title, body, priority, audience, status, published_at)
   values ('Welcome to Level 1',
           'Welcome to the ICPC SGU Community Level 1 platform. Complete your profile and register your team!',
           'important', 'all', 'published', now())`,
);
console.log("announcement created");

console.log("\nDemo content seeded.");
await client.end();

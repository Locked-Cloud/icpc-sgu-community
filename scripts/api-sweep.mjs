import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ADMIN_PASSWORD = process.argv[2];
if (!ADMIN_PASSWORD) {
  console.error("Usage: node scripts/api-sweep.mjs <admin-password>");
  process.exit(1);
}

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const adminRow = await db.query(
  "select u.email from auth.users u join public.profiles p on p.id = u.id where p.role = 'admin' and p.status = 'active' order by u.created_at limit 1",
);
await db.end();
if (!adminRow.rows[0]) {
  console.error("No active admin found in the database");
  process.exit(1);
}

const signin = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: adminRow.rows[0].email, password: ADMIN_PASSWORD }),
});
if (!signin.ok) {
  console.error("Admin sign-in failed:", signin.status);
  process.exit(1);
}
const { access_token: token } = await signin.json();
console.log("signin:", signin.status, "\n");

// every table the frontend queries + all RPCs
const tables = [
  "profiles", "profiles_public", "community_settings", "teams", "team_members",
  "team_invitations", "team_join_requests", "team_conversations", "messages",
  "conversation_read_states", "training_weeks", "training_resources", "material_completions",
  "topics", "problems", "problem_topics", "problem_sheets", "problem_sheet_items",
  "sheet_topics", "problem_completions", "codeforces_accounts", "codeforces_snapshots",
  "codeforces_rating_history", "codeforces_solved", "assignments", "assignment_submissions",
  "scheduled_reminders", "virtual_contests", "contest_problems", "contest_registrations",
  "contest_results", "contest_problem_results", "training_sessions", "attendance_records",
  "mentors", "mentor_availability_rules", "mentor_blackouts", "mentor_bookings",
  "mentor_session_notes", "announcements", "notifications", "notification_preferences",
  "support_requests", "support_replies", "audit_logs", "roadmap_milestones",
  "roadmap_prerequisites", "milestone_completions",
];

let fail = 0;
for (const t of tables) {
  const res = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    fail++;
    const body = await res.text();
    console.log(`FAIL ${t} → ${res.status}: ${body.slice(0, 140)}`);
  }
}
console.log(fail === 0 ? `ALL ${tables.length} tables readable (admin) ✓` : `${fail} failures`);

const rpcs = [
  "student_dashboard_data",
  "admin_dashboard_stats",
  "admin_topic_analytics",
  "roadmap_progress_for",
  "contest_standings", // needs arg — expect 400 for missing arg, not 500
];
console.log("");
for (const fn of rpcs) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: fn === "contest_standings" ? JSON.stringify({ p_contest_id: "00000000-0000-0000-0000-000000000000" }) : "{}",
  });
  const body = await res.text();
  const ok = res.status < 500;
  console.log(`${ok ? "OK  " : "FAIL"} rpc ${fn} → ${res.status}${ok ? "" : ": " + body.slice(0, 140)}`);
}

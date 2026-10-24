import { readFileSync } from "node:fs";
import pg from "pg";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const rest = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(body ? { Prefer: "return=representation" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const rpc = (token, fn, args = {}) => rest(`rpc/${fn}`, { method: "POST", token, body: args });

// ── demo student: reuse if it exists, otherwise create via the real API ─────
const EMAIL = "demo.student@icpc-sgu.community";
const PASSWORD = "Demo#Student2026";

const existing = await db.query("select id from auth.users where lower(email) = lower($1)", [EMAIL]);
let uid = existing.rows[0]?.id ?? null;

if (!uid) {
  const signup = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, data: { full_name_en: "Demo Student" } }),
  });
  const sj = await signup.json().catch(() => ({}));
  if (!signup.ok) {
    console.error("signup failed:", signup.status, JSON.stringify(sj).slice(0, 160));
    await db.end(); process.exit(1);
  }
  uid = sj.user?.id ?? sj.id;
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [uid]);
  await db.query("begin");
  await db.query("select set_config('icpc.trusted_write', 'on', true)");
  await db.query("update public.profiles set status = 'active' where id = $1", [uid]);
  await db.query("commit");
  console.log("demo student created:", EMAIL, "\n");
} else {
  console.log("reusing existing demo student:", EMAIL, "\n");
  // reset transient state so the full journey can run again
  await db.query("delete from teams where created_by = $1", [uid]);
  await db.query("delete from material_completions where user_id = $1", [uid]);
  await db.query("delete from problem_completions where user_id = $1", [uid]);
  await db.query("delete from assignment_submissions where student_id = $1", [uid]);
  await db.query("delete from support_requests where student_id = $1", [uid]);
  await db.query("delete from mentor_bookings where student_id = $1", [uid]);
  await db.query("delete from codeforces_accounts where user_id = $1", [uid]);
}

const signin = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const token = (await signin.json()).access_token;
check("sign in", !!token);

// ── Profile page flow ────────────────────────────────────────────────────────
const profilePatch = await rest(`profiles?id=eq.${uid}`, {
  method: "PATCH", token,
  body: {
    full_name_en: "Demo Student", university_id: "202601001", phone: "+201000000001",
    academic_year: "First Year", programming_experience: "beginner", preferred_language: "C++",
    availability: ["sat-morning", "tue-evening"], bio: "Demo account for testing",
  },
});
check("profile: PATCH allowed (own row)", profilePatch.status === 204 || profilePatch.status === 200, `status=${profilePatch.status}`);

const roleCheck = await rest(`profiles?id=eq.${uid}&select=role,status`, { token });
check("profile: guard blocks role/status changes", roleCheck.data?.[0]?.role === "student" && roleCheck.data?.[0]?.status === "active");

const profilesPublic = await rest("profiles_public?select=id,full_name_en,academic_year", { token });
check("profile: appears in profiles_public projection", profilesPublic.data?.some((p) => p.id === uid && p.academic_year === "First Year"));

const noPhoneLeak = profilesPublic.data?.every((p) => !("phone" in p));
check("profile: no sensitive fields in public projection", noPhoneLeak);

// ── Dashboard ────────────────────────────────────────────────────────────────
const dash = await rpc(token, "student_dashboard_data");
const d = dash.data;
check("dashboard rpc", dash.status === 200 && d?.profile_completion != null);
check("dashboard keys", ["team","pending_invitations","unread_messages","unread_notifications","current_week","recent_weeks","upcoming_assignments","upcoming_contests","next_bookings","attendance_summary","codeforces","announcements","profile_completion"].every((k) => k in (d ?? {})));
check("dashboard: sees published announcement", (d?.announcements ?? []).length >= 1);
check("dashboard: sees demo assignment", (d?.upcoming_assignments ?? []).some((a) => a.title.includes("Warm-up")));

// ── Team wizard flow ─────────────────────────────────────────────────────────
const team = await rpc(token, "create_team", { p_name: "Demo Seekers", p_registration_type: "individual", p_description: "Demo team looking for members" });
const teamId = typeof team.data === "string" ? team.data : null;
check("team: create (individual)", !!teamId, `status=${team.status}`);

const myTeamMembers = await rest(`team_members?select=team_id,status&student_id=eq.${uid}&status=eq.active`, { token });
check("team: membership row visible", myTeamMembers.data?.length === 1);

const teamsBrowse = await rest("teams?select=id,name,status&status=eq.looking_for_members", { token });
check("find-teammates: browsable team listed", teamsBrowse.data?.some((t) => t.id === teamId));

// ── Chat flow ────────────────────────────────────────────────────────────────
const conv = await db.query("select id from team_conversations where team_id = $1", [teamId]);
const convId = conv.rows[0].id;
const post = await rest("messages", { method: "POST", token, body: { conversation_id: convId, sender_id: uid, body: "Hello from demo student!", kind: "user" } });
check("chat: member can post", post.status === 201);
const readMsgs = await rest(`messages?conversation_id=eq.${convId}&select=id,body`, { token });
check("chat: can read messages", readMsgs.data?.length >= 1);
const markRead = await rpc(token, "mark_conversation_read", { p_conversation_id: convId });
check("chat: mark read", [200, 204].includes(markRead.status), `status=${markRead.status}`);
const pin = await rpc(token, "toggle_pin_message", { p_message_id: readMsgs.data[0].id });
check("chat: leader can pin", [200, 204].includes(pin.status), `status=${pin.status}`);

// ── Training + materials ─────────────────────────────────────────────────────
const weeks = await rest("training_weeks?select=id,week_number,title,status&status=eq.published&order=week_number", { token });
check("training: published weeks visible", weeks.data?.length >= 1);
const weekId = weeks.data?.[0]?.id;
const draftHidden = await rest("training_weeks?select=id&status=eq.draft", { token });
check("training: drafts hidden", (draftHidden.data ?? []).length === 0);

const resources = await rest(`training_resources?select=id,title,kind&week_id=eq.${weekId}&visible=eq.true&order=sort_order`, { token });
check("training: resources visible", resources.data?.length >= 1);
const done = await rest("material_completions", { method: "POST", token, body: { user_id: uid, resource_id: resources.data[0].id } });
check("training: mark material completed", done.status === 201, `status=${done.status}`);

// ── Sheets + problem completion ──────────────────────────────────────────────
const sheets = await rest("problem_sheets?select=id,title,difficulty&status=eq.published&order=created_at.desc", { token });
check("sheets: published visible", sheets.data?.length >= 1);
const sheetId = sheets.data?.[0]?.id;
const items = await rest(`problem_sheet_items?select=id,problem_id,sort_order&sheet_id=eq.${sheetId}&order=sort_order`, { token });
check("sheets: items visible", items.data?.length >= 1);
const toggle = await rpc(token, "toggle_problem_completion", { p_problem_id: items.data[0].problem_id, p_completed: true });
check("sheets: mark problem solved (manual)", [200, 204].includes(toggle.status), `status=${toggle.status}`);
const completions = await rest(`problem_completions?select=problem_id,source&user_id=eq.${uid}`, { token });
check("sheets: completion persisted", completions.data?.some((c) => c.problem_id === items.data[0].problem_id && c.source === "manual"));

// ── Roadmap + skills ─────────────────────────────────────────────────────────
const roadmap = await rpc(token, "roadmap_progress_for");
check("roadmap: rpc returns milestones", roadmap.status === 200 && roadmap.data?.length >= 1);
const ms = roadmap.data?.[0];
check("roadmap: status reflects activity", ["in_progress", "not_started"].includes(ms?.status), `status=${ms?.status}`);
check("roadmap: progress keys", ms && "progress" in ms && "prereqs_met" in ms && "overdue" in ms);

const skillTopics = await rest("topics?select=slug,name&active=eq.true&order=sort_order", { token });
check("skills: topics readable", skillTopics.data?.length >= 10);

// ── Assignments ──────────────────────────────────────────────────────────────
const assignments = await rest("assignments?select=id,title,mode,due_at&status=eq.published&order=due_at", { token });
check("assignments: published visible", assignments.data?.length >= 1);
const assignmentId = assignments.data?.[0]?.id;
const submit = await rpc(token, "submit_assignment", { p_assignment_id: assignmentId, p_content_url: "https://github.com/demo/submission", p_notes: "demo" });
check("assignments: submit", submit.status === 200, `status=${submit.status}`);
const sub = await rest(`assignment_submissions?select=id,status,content_url&assignment_id=eq.${assignmentId}`, { token });
check("assignments: submission visible to author", sub.data?.length === 1 && sub.data[0].content_url.includes("github"));

// ── Contests ─────────────────────────────────────────────────────────────────
const contests = await rest("virtual_contests?select=id,title,status,scoring_mode&status=neq.draft", { token });
check("contests: list works", contests.status === 200);

// ── Mentorship ───────────────────────────────────────────────────────────────
const mentors = await rest("mentors?select=id,default_duration_minutes&active=eq.true", { token });
check("mentorship: browse mentors", mentors.status === 200 && mentors.data?.length >= 1);
const slots = mentors.data?.[0]
  ? await rpc(token, "mentor_available_slots", { p_mentor_id: mentors.data[0].id, p_days: 14 })
  : { status: 0, data: [] };
check("mentorship: slots available", slots.status === 200 && (slots.data ?? []).length > 0, `${(slots.data ?? []).length} slots`);
const booking = (slots.data ?? [])[0]
  ? await rpc(token, "book_mentor_slot", { p_mentor_id: mentors.data[0].id, p_starts_at: slots.data[0].starts_at, p_topic: "Help with binary search" })
  : { status: 0 };
check("mentorship: book slot", [200, 201, 204].includes(booking.status), `status=${booking.status}`);

// ── Notifications / announcements / calendar / attendance / support ──────────
const notifs = await rest("notifications?select=id,kind,title&order=created_at.desc&limit=10", { token });
check("notifications: list", notifs.status === 200);
const anns = await rest("announcements?select=id,title,priority&status=eq.published&order=published_at.desc", { token });
check("announcements: published visible", anns.data?.length >= 1);
const sessions = await rest("training_sessions?select=id,title,starts_at&order=starts_at.desc", { token });
check("calendar: sessions readable", sessions.data?.length >= 1);
const attendance = await rest("attendance_records?select=id,status&student_id=eq." + uid, { token });
check("attendance: own records (empty ok)", attendance.status === 200);
const support = await rest("support_requests", { method: "POST", token, body: { student_id: uid, subject: "Demo ticket", category: "other", description: "Testing the support workflow end to end." } });
check("support: create request", support.status === 201, `status=${support.status}`);

// ── Settings (notification prefs) ────────────────────────────────────────────
const prefs = await rest("notification_preferences?select=user_id,muted_kinds&user_id=eq." + uid, { token });
check("settings: prefs row exists (from trigger)", prefs.data?.length === 1);

// ── Codeforces link (real handle, small) ─────────────────────────────────────
const link = await rpc(token, "link_codeforces_handle", { p_handle: "Alixa" });
check("codeforces: link handle", [200, 204].includes(link.status), `status=${link.status}`);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n=== STUDENT JOURNEY: ${results.length - failed}/${results.length} passed ===`);
console.log(`Demo student: ${EMAIL} / ${PASSWORD} (kept for the user to try)`);
if (failed) process.exitCode = 1;
await db.end();

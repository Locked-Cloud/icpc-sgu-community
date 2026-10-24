#!/usr/bin/env node
/**
 * RLS integration checks against the live Supabase project.
 *
 * Creates throwaway student accounts through the REAL signup API, exercises
 * cross-access rules through the public REST API, and cleans up.
 *
 * Notes:
 *  - Signups send confirmation emails (2/hour on the free tier). The admin
 *    account is reused (ADMIN_EMAIL/ADMIN_PASSWORD env or .env) instead of
 *    being re-created; student C (chat-isolation checks) is skipped with a
 *    notice if the email rate limit is hit.
 *
 * Usage: node scripts/rls-check.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { SUPABASE_DB_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_DB_URL || !VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  console.error("Need SUPABASE_DB_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (env or .env).");
  process.exit(1);
}

const db = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: SUPABASE_DB_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

const STAMP = Date.now();
const results = [];
let weekId = null;
const createdUserIds = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: !!condition, detail, skipped: false });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
function skip(name, why) {
  results.push({ name, ok: null, detail: why, skipped: true });
  console.log(`SKIP  ${name} — ${why}`);
}

async function rest(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${VITE_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token ?? VITE_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function signUpViaApi(email, password, fullName) {
  const res = await fetch(`${VITE_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, data: { full_name_en: fullName } }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) return { rateLimited: true };
  const uid = json?.user?.id ?? json?.id ?? null;
  if (!uid) return { error: JSON.stringify(json).slice(0, 160) };
  return { uid };
}

async function signIn(email, password) {
  const res = await fetch(`${VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return json?.access_token ?? null;
}

const rpc = (fn, token, args = {}) =>
  rest(`rpc/${fn}`, { method: "POST", token, body: args });

try {
  await db.connect();

  // ── subjects ──────────────────────────────────────────────────────────────
  // Admin account lives in the database — email is discovered automatically;
  // its password is passed as the only CLI argument (never stored in files).
  const ADMIN_PASSWORD = process.argv[2];
  if (!ADMIN_PASSWORD) {
    throw new Error("Usage: node scripts/rls-check.mjs <admin-password>");
  }
  const adminRow = await db.query(
    "select u.id, u.email from auth.users u join public.profiles p on p.id = u.id where p.role = 'admin' and p.status = 'active' order by u.created_at limit 1",
  );
  if (!adminRow.rows[0]) throw new Error("No active admin found in the database");
  const ADMIN_EMAIL = adminRow.rows[0].email;

  const tokenB = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!tokenB) throw new Error("Admin sign-in failed — wrong password?");
  const uidB = adminRow.rows[0].id;

  // Student A — the only fresh signup in the happy path
  const A = { email: `rls-a-${STAMP}@gmail.com`, password: "RlsTest#12345" };
  const a = await signUpViaApi(A.email, A.password, "RLS Student A");
  if (a.rateLimited) throw new Error("Email rate limit hit for student A — re-run in the next hour window");
  if (!a.uid) throw new Error("Student A signup failed: " + a.error);
  createdUserIds.push(a.uid);
  const uidA = a.uid;

  // confirm + activate A (trusted write path)
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [uidA]);
  await db.query("begin");
  await db.query("select set_config('icpc.trusted_write', 'on', true)");
  await db.query("update public.profiles set status = 'active' where id = $1", [uidA]);
  await db.query("commit");

  const tokenA = await signIn(A.email, A.password);
  if (!tokenA) throw new Error("Student A sign-in failed");

  // Student C — for chat isolation; skippable when rate-limited
  const C = { email: `rls-c-${STAMP}@gmail.com`, password: "RlsTest#12345" };
  const c = await signUpViaApi(C.email, C.password, "RLS Student C");
  let tokenC = null;
  let uidC = null;
  if (c.rateLimited) {
    skip("outsider cannot read team messages", "student C creation rate-limited (free-tier email cap)");
    skip("outsider cannot post team messages", "student C creation rate-limited (free-tier email cap)");
  } else if (c.uid) {
    uidC = c.uid;
    createdUserIds.push(uidC);
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [uidC]);
    await db.query("begin");
    await db.query("select set_config('icpc.trusted_write', 'on', true)");
    await db.query("update public.profiles set status = 'active' where id = $1", [uidC]);
    await db.query("commit");
    tokenC = await signIn(C.email, C.password);
    if (!tokenC) uidC = null;
    if (!tokenC) {
      skip("outsider cannot read team messages", "student C sign-in failed");
      skip("outsider cannot post team messages", "student C sign-in failed");
    }
  } else {
    skip("outsider cannot read team messages", "student C signup: " + c.error);
    skip("outsider cannot post team messages", "student C signup: " + c.error);
  }

  // ── checks ────────────────────────────────────────────────────────────────
  // 1. anonymous access is denied
  const anonProfiles = await rest("profiles?select=id");
  check("anon cannot list profiles", anonProfiles.status === 401 || (Array.isArray(anonProfiles.data) && anonProfiles.data.length === 0), `status=${anonProfiles.status}`);

  // 2. student cannot read another profile row (sensitive fields protected)
  const otherProfile = await rest(`profiles?id=eq.${uidB}&select=id`, { token: tokenA });
  check("student cannot read another profile row", Array.isArray(otherProfile.data) && otherProfile.data.length === 0);

  // 3. student cannot escalate role via profile update (guard trigger reverts)
  const escalate = await rest("profiles", {
    method: "PATCH",
    token: tokenA,
    body: { role: "admin", status: "active" },
  });
  const afterA = await rest(`profiles?id=eq.${uidA}&select=role,status`, { token: tokenA });
  const roleA = afterA.data?.[0]?.role;
  check("student cannot escalate own role", roleA === "student", `role after attempt: ${roleA}, patch status=${escalate.status}`);

  // 4. create team via the public RPC
  const teamA = await rpc("create_team", tokenA, {
    p_name: `RLS Team ${STAMP}`,
    p_registration_type: "individual",
  });
  const teamAId = typeof teamA.data === "string" ? teamA.data : null;
  check("student can create a team", !!teamAId, `status=${teamA.status}`);

  // 5. unpublished training week is invisible to students, visible to admin
  const week = await db.query(
    `insert into public.training_weeks (week_number, title, status)
     values (900 + floor(random()*100)::int, 'RLS draft week', 'draft') returning id`,
  );
  weekId = week.rows[0].id;
  const weeksForA = await rest(`training_weeks?id=eq.${weekId}&select=id`, { token: tokenA });
  check("draft training week hidden from student", Array.isArray(weeksForA.data) && weeksForA.data.length === 0);
  const weeksForB = await rest(`training_weeks?id=eq.${weekId}&select=id`, { token: tokenB });
  check("draft training week visible to admin", Array.isArray(weeksForB.data) && weeksForB.data.length === 1);

  // 6. audit logs admin-only
  const auditsForA = await rest("audit_logs?select=id&limit=1", { token: tokenA });
  check("audit logs hidden from student", Array.isArray(auditsForA.data) && auditsForA.data.length === 0);
  const auditsForB = await rest("audit_logs?select=id&limit=1", { token: tokenB });
  check("audit logs visible to admin", auditsForB.status === 200 && Array.isArray(auditsForB.data));

  // 7. chat isolation with outsider C
  if (tokenC && teamAId) {
    const conv = await db.query(
      "select id from public.team_conversations where team_id = $1",
      [teamAId],
    );
    const convId = conv.rows[0]?.id;
    const intruderRead = await rest(`messages?conversation_id=eq.${convId}&select=id`, { token: tokenC });
    check("outsider cannot read team messages", Array.isArray(intruderRead.data) && intruderRead.data.length === 0, `status=${intruderRead.status}`);
    const intruderWrite = await rest("messages", {
      method: "POST",
      token: tokenC,
      body: { conversation_id: convId, sender_id: uidC, body: "intruding", kind: "user" },
    });
    check("outsider cannot post team messages", intruderWrite.status >= 400, `status=${intruderWrite.status}`);
  }

  // 8. member CAN post to own conversation
  if (teamAId) {
    const conv = await db.query("select id from public.team_conversations where team_id = $1", [teamAId]);
    const memberWrite = await rest("messages", {
      method: "POST",
      token: tokenA,
      body: { conversation_id: conv.rows[0].id, sender_id: uidA, body: "hello team", kind: "user" },
    });
    check("team member can post messages", memberWrite.status === 201, `status=${memberWrite.status}`);
  }

  // 9. notifications are isolated per user (admins may see all BY DESIGN —
  //    what matters: a student sees ONLY their own rows, never an admin's)
  await db.query(
    "insert into public.notifications (recipient_id, kind, title) values ($1, 'system', 'private note')",
    [uidA],
  );
  await db.query(
    "insert into public.notifications (recipient_id, kind, title) values ($1, 'system', 'admin private note')",
    [uidB],
  );
  const notifA = await rest("notifications?select=recipient_id", { token: tokenA });
  const onlyOwn =
    Array.isArray(notifA.data) &&
    notifA.data.length > 0 &&
    notifA.data.every((n) => n.recipient_id === uidA);
  check("notifications isolated per user (student sees only own)", onlyOwn, `rows=${notifA.data?.length}`);

  // 10. scheduled reminders hidden from students
  const remindersA = await rest("scheduled_reminders?select=id&limit=1", { token: tokenA });
  check("scheduled reminders admin-only", Array.isArray(remindersA.data) && remindersA.data.length === 0);

  // 11. student dashboard rpc works for the student
  const dash = await rpc("student_dashboard_data", tokenA, {});
  check("student dashboard rpc returns own data", dash.status === 200 && dash.data?.profile_completion != null, `status=${dash.status}`);

  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(
    `\n${results.length - skipped - failed}/${results.length - skipped} checks passed` +
      (skipped ? `, ${skipped} skipped (rate limit)` : "") +
      (failed ? " — FAILURES PRESENT" : ""),
  );
  process.exitCode = failed ? 1 : 0;
} catch (err) {
  console.error("RLS check crashed:", err.message);
  process.exitCode = 1;
} finally {
  try {
    if (weekId) await db.query("delete from public.training_weeks where id = $1", [weekId]);
    if (createdUserIds.length) {
      // messages.sender_id and teams.leader_id/created_by do not cascade —
      // remove the test team (which cascades conversations+messages) and any
      // direct references before dropping the auth users, or the delete fails.
      await db.query("delete from public.teams where leader_id = any($1::uuid[]) or created_by = any($1::uuid[])", [createdUserIds]);
      await db.query("delete from public.messages where sender_id = any($1::uuid[])", [createdUserIds]);
      await db.query("delete from public.notifications where recipient_id = any($1::uuid[])", [createdUserIds]);
      await db.query("delete from auth.users where id = any($1::uuid[])", [createdUserIds]);
    }
  } catch (e) {
    console.error("cleanup warning:", e.message);
  }
  await db.end().catch(() => {});
}

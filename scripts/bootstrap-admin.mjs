#!/usr/bin/env node
/**
 * Bootstrap the first administrator through the REAL signup API:
 *  1. removes any hand-created user for the target email (cascades to profiles)
 *  2. signs up via POST /auth/v1/signup (GoTrue writes everything itself)
 *  3. confirms the email directly in the DB (avoids needing the email link)
 *  4. promotes the account to admin (audited)
 *
 * Usage: node scripts/bootstrap-admin.mjs <email> <password>
 */
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const email = process.argv[2];
const password = process.argv[3];
if (!email || !password) {
  console.error("Usage: node scripts/bootstrap-admin.mjs <email> <password>");
  process.exit(1);
}

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// 1. drop any previous hand-made user for this email
await db.query("delete from auth.users where lower(email) = lower($1)", [email]);

// 2. real signup through the API
const res = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, data: { full_name_en: "Level 1 Lead" } }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok || !json?.user?.id) {
  console.error(`signup failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  await db.end();
  process.exit(1);
}
const uid = json.user?.id ?? json.id;
console.log("signup OK:", uid, json.session ? "(session returned)" : "(confirmation required)");

// 3. confirm the email via DB (the confirmation email may be delayed/rate-limited)
await db.query("update auth.users set email_confirmed_at = now() where id = $1", [uid]);

// 4. promote to admin (trusted-write transaction so the guard trigger allows it)
await db.query("begin");
await db.query("select set_config('icpc.trusted_write', 'on', true)");
await db.query(
  "update public.profiles set role = 'admin', status = 'active', full_name_en = 'Level 1 Lead' where id = $1",
  [uid],
);
await db.query(
  "insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values ($1,'profile.role_changed','profile',$2,$3)",
  [uid, String(uid), JSON.stringify({ role: "admin", via: "bootstrap-admin script" })],
);

// 5. verify sign-in works
const signin = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const sj = await signin.json().catch(() => ({}));
console.log(
  signin.ok
    ? "ADMIN READY — sign-in verified ✓"
    : `sign-in check failed (${signin.status}): ${JSON.stringify(sj).slice(0, 150)}`,
);
console.log(`ADMIN EMAIL: ${email}`);
await db.end();

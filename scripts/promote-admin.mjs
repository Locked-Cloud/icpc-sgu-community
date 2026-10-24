#!/usr/bin/env node
/**
 * Trusted admin provisioning. The target user must have signed up through the
 * app first (a profiles row exists). This script uses the database connection
 * string (server-side, never exposed to the browser) to set their role.
 *
 * Usage: SUPABASE_DB_URL=... node scripts/promote-admin.mjs user@example.com
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/promote-admin.mjs <email-of-registered-user>");
  process.exit(1);
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

const user = await client.query(
  "select id, email, email_confirmed_at from auth.users where lower(email) = lower($1)",
  [email],
);

if (user.rowCount === 0) {
  console.error(`No auth user found with email ${email}.`);
  console.error("The person must register in the app first, then run this script.");
  await client.end();
  process.exit(1);
}

const { id, email: userEmail } = user.rows[0];

const updated = await client.query(
  `begin;
   select set_config('icpc.trusted_write', 'on', true);
   update public.profiles set role = 'admin', status = 'active'
   where id = $1 returning id, full_name_en, role, status;
   commit;`,
  [id],
);

if (updated.rowCount === 0) {
  console.error("Auth user exists but has no profile row — sign in once in the app, then retry.");
  await client.end();
  process.exit(1);
}

await client.query(
  "insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values ($1, 'profile.role_changed', 'profile', $2, $3)",
  [id, String(id), JSON.stringify({ role: "admin", via: "promote-admin script" })],
);

console.log(`OK: ${userEmail} is now an administrator.`);
console.log(JSON.stringify(updated.rows[0]));
await client.end();

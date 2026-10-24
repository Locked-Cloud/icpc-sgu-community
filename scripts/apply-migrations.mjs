#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql in order, tracking applied files in
 * public.schema_migrations. Each file runs inside a transaction.
 *
 * Usage: SUPABASE_DB_URL=postgres://... node scripts/apply-migrations.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");

// tiny .env loader (no dependency)
if (existsSync(join(__dirname, "..", ".env"))) {
  for (const line of readFileSync(join(__dirname, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL (Postgres connection string).");
  console.error("Copy .env.example to .env and fill it in, or export the variable.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

await client.connect();

await client.query("create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let applied = 0;
let skipped = 0;

for (const file of files) {
  const already = await client.query("select 1 from public.schema_migrations where name = $1", [file]);
  if (already.rowCount > 0) {
    skipped++;
    console.log(`= skip   ${file} (already applied)`);
    continue;
  }

  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
    await client.query("commit");
    applied++;
    console.log(`+ apply  ${file}`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`x FAILED ${file}`);
    console.error("  " + String(err.message).split("\n").slice(0, 6).join("\n  "));
    process.exitCode = 1;
    break;
  }
}

console.log(`\nDone. applied=${applied} skipped=${skipped} total=${files.length}`);
await client.end();

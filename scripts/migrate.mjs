#!/usr/bin/env node
/**
 * Applies prisma/migrations/*\/migration.sql.
 *
 * SQLite (DATABASE_URL=file:...): applied here with better-sqlite3, recorded in Prisma's own
 *   `_prisma_migrations` table with the same sha256 checksums, so `prisma migrate deploy` /
 *   `migrate status` treat the history as applied.
 * PostgreSQL: delegates to `prisma migrate deploy` (run it with a DIRECT, non-pooled URL).
 *
 *   node scripts/migrate.mjs            apply pending migrations
 *   node scripts/migrate.mjs --reset    delete the local SQLite file first (dev only)
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

for (const f of [".env.local", ".env"]) if (existsSync(f)) { try { process.loadEnvFile(f); } catch {} }
const url = process.env.DATABASE_URL ?? "file:./.data/dev.db";
const reset = process.argv.includes("--reset");

if (!url.startsWith("file:")) {
  const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}

const dbPath = resolve(process.cwd(), url.slice("file:".length).split("?")[0]);
if (reset) {
  if (process.env.NODE_ENV === "production") { console.error("Refusing --reset in production."); process.exit(1); }
  for (const s of ["", "-wal", "-shm", "-journal"]) rmSync(dbPath + s, { force: true });
}
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL,
  "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);

const dir = resolve(process.cwd(), "prisma/migrations");
const names = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort();
const applied = new Map(db.prepare(`SELECT migration_name n, checksum c FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all().map((r) => [r.n, r.c]));
let count = 0;
for (const name of names) {
  const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  if (applied.has(name)) {
    if (applied.get(name) !== checksum) { console.error(`Migration ${name} was modified after it was applied.`); process.exit(1); }
    continue;
  }
  db.exec("BEGIN");
  try {
    db.exec(sql);
    db.prepare(`INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, current_timestamp, ?, 1)`).run(randomUUID(), checksum, name);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); console.error(`Migration ${name} failed:`, e.message); process.exit(1); }
  console.log(`applied ${name}`); count++;
}

const triggers = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`).all().map((r) => r.name);
const need = ["AuditEvent", "Ballot", "BallotSelection"].flatMap((t) => [`${t}_append_only_update`, `${t}_append_only_delete`]);
const missing = need.filter((n) => !triggers.includes(n));
db.close();
if (missing.length) { console.error(`Append-only guards missing: ${missing.join(", ")}`); process.exit(1); }
console.log(count ? `Done: ${count} migration(s) applied.` : "Database is up to date.");

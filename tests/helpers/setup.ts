/**
 * Runs before every test file. Gives each file its own throw-away SQLite database built from the real
 * migrations (including the append-only triggers), and test-only secrets.
 */
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "quorum-test-"));
const dbPath = join(dir, "test.db");

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: `file:${dbPath}`,
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdef0123456789",
  APP_SECRET: "test-app-secret-fedcba9876543210fedcba9876543210",
  CRON_SECRET: "test-cron-secret-0123456789",
  RATE_LIMIT_DRIVER: "memory",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: join(dir, "uploads"),
  JOB_DRIVER: "inline",
  OCR_DRIVER: "none",
  MAIL_DRIVER: "none",
});

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const migrations = resolve(process.cwd(), "prisma/migrations");
for (const name of readdirSync(migrations).filter((n) => statSync(join(migrations, n)).isDirectory()).sort()) {
  sqlite.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
}
sqlite.close();

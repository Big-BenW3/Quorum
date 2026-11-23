import "server-only";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { env, isProduction } from "@/server/env";
import { configError } from "@/server/errors";

/**
 * Database access. SQLite (better-sqlite3 driver adapter) for local development.
 *
 * Moving to Neon / any Postgres: see docs/deployment.md. In short, change `provider` in
 * prisma/schema.prisma, regenerate the baseline migration, install `@prisma/adapter-pg`, and swap the
 * adapter below for `new PrismaPg({ connectionString })`. No domain code changes: every
 * correctness-critical write is an atomic conditional UPDATE plus a unique constraint, which behaves
 * identically on both engines.
 */

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export type DbLike = Db | Tx;

const g = globalThis as unknown as { __quorumPrisma?: PrismaClient };

function create(): PrismaClient {
  const url = env().DATABASE_URL;
  if (url.startsWith("file:")) {
    if (isProduction() && !env().ALLOW_SQLITE_IN_PRODUCTION) throw configError("SQLite is disabled in production.");
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }), log: ["warn", "error"] });
  }
  throw configError("Only SQLite is wired into this build. Follow docs/deployment.md to enable Postgres.");
}

export const db: Db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    g.__quorumPrisma ??= create();
    return Reflect.get(g.__quorumPrisma, prop);
  },
});

export async function disconnectForTests() {
  await g.__quorumPrisma?.$disconnect();
  g.__quorumPrisma = undefined;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** SQLite reports lock contention as SQLITE_BUSY surfaced through P1008/P2034; treat as retryable. */
export function isRetryable(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2034" || e.code === "P1008");
}

export { Prisma };

import "server-only";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, configError } from "@/server/errors";

/**
 * Rate limiting behind a small interface. The default driver stores fixed-window counters in the
 * application database using one atomic upsert, so it works on serverless without Redis. Swap in an
 * Upstash/Redis implementation by implementing RateLimiter and returning it from getRateLimiter().
 *
 * Fails closed: with RATE_LIMIT_DRIVER=none every limited public endpoint answers 503 rather than
 * silently running unprotected.
 */

export type LimitOptions = { limit: number; windowSec: number };
export type LimitResult = { ok: boolean; count: number; remaining: number; retryAfterSec: number };

export interface RateLimiter {
  /** Count one hit and report whether it is within the limit. */
  consume(key: string, opts: LimitOptions): Promise<LimitResult>;
  /** Report the current count without counting a hit. */
  peek(key: string, opts: LimitOptions): Promise<LimitResult>;
}

const windowOf = (windowSec: number, nowMs: number) => Math.floor(nowMs / 1000 / windowSec) * windowSec;
const result = (count: number, o: LimitOptions, nowMs: number): LimitResult => {
  const ws = windowOf(o.windowSec, nowMs);
  return { ok: count <= o.limit, count, remaining: Math.max(0, o.limit - count), retryAfterSec: Math.max(1, ws + o.windowSec - Math.floor(nowMs / 1000)) };
};

class DatabaseRateLimiter implements RateLimiter {
  async consume(key: string, o: LimitOptions): Promise<LimitResult> {
    const nowMs = Date.now();
    const ws = windowOf(o.windowSec, nowMs);
    // One atomic statement; identical on SQLite (>= 3.35) and PostgreSQL.
    const rows = await db.$queryRaw<{ count: number | bigint }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${ws}, 1)
      ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
      RETURNING "count"`;
    return result(Number(rows[0]?.count ?? 1), o, nowMs);
  }
  async peek(key: string, o: LimitOptions): Promise<LimitResult> {
    const nowMs = Date.now();
    const ws = windowOf(o.windowSec, nowMs);
    const row = await db.rateLimitBucket.findUnique({ where: { key_windowStart: { key, windowStart: ws } } });
    return result(row?.count ?? 0, o, nowMs);
  }
}

/** Process-local. Development and tests only: it is not shared between serverless instances. */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, number>();
  async consume(key: string, o: LimitOptions) {
    const nowMs = Date.now();
    const id = `${key}@${windowOf(o.windowSec, nowMs)}`;
    const count = (this.buckets.get(id) ?? 0) + 1;
    this.buckets.set(id, count);
    if (this.buckets.size > 10_000) this.buckets.clear();
    return result(count, o, nowMs);
  }
  async peek(key: string, o: LimitOptions) {
    const nowMs = Date.now();
    return result(this.buckets.get(`${key}@${windowOf(o.windowSec, nowMs)}`) ?? 0, o, nowMs);
  }
  reset() {
    this.buckets.clear();
  }
}

class UnconfiguredRateLimiter implements RateLimiter {
  private fail(): never {
    throw configError("Rate limiting is not configured, so this endpoint is disabled. Set RATE_LIMIT_DRIVER.");
  }
  consume(): Promise<LimitResult> { return this.fail(); }
  peek(): Promise<LimitResult> { return this.fail(); }
}

let instance: RateLimiter | undefined;
export function getRateLimiter(): RateLimiter {
  if (instance) return instance;
  const driver = env().RATE_LIMIT_DRIVER;
  instance = driver === "database" ? new DatabaseRateLimiter() : driver === "memory" ? new MemoryRateLimiter() : new UnconfiguredRateLimiter();
  return instance;
}
export function setRateLimiterForTests(l: RateLimiter | undefined) {
  instance = l;
}

/** Consume and throw a 429 with Retry-After when over the limit. */
export async function enforceLimit(key: string, o: LimitOptions, message = "Too many requests. Please wait a moment and try again.") {
  const r = await getRateLimiter().consume(key, o);
  if (!r.ok) throw new AppError("RATE_LIMITED", message, { retryAfterSec: r.retryAfterSec });
  return r;
}

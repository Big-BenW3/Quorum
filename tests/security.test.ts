import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { MemoryRateLimiter, enforceLimit, setRateLimiterForTests, getRateLimiter } from "@/server/adapters/ratelimit";
import { loadEnv, resetEnvForTests } from "@/server/env";
import { hmacHex, open, seal, signPayload, resetKeyCacheForTests } from "@/server/crypto/keys";
import { redactForTests } from "@/server/log";
import { route } from "@/server/http";
import { signLocalUrl, verifyLocalUrl } from "@/server/adapters/storage";
import { sanitizeMetadata } from "@/server/audit";
import { loadElection, transitionElection } from "@/server/domain/election";
import { getAdminResults, getAdminAnalytics, buildReport } from "@/server/domain/results";
import { getTurnout, rollCall } from "@/server/domain/turnout";
import { listImports, createManualImport, getImport } from "@/server/domain/roster";
import { addCandidate, updateCandidate, removePosition } from "@/server/domain/ballot-config";
import { requireCandidate, requireOrganization, requirePosition } from "@/server/authz";
import { submitBallot, verifyVoter } from "@/server/domain/voting";
import { freezeClock, makeElection, makeUser, makeOrg } from "./helpers/factory";

afterEach(() => { setClockForTests(null); setRateLimiterForTests(undefined); resetEnvForTests(); });

const code = async (p: Promise<unknown>) => (await p.then(() => null, (x) => x))?.code as string | undefined;

describe("tenant isolation (IDOR)", () => {
  it("answers 404 for every object in another organization, across every admin read and write", async () => {
    freezeClock();
    const f = await makeElection();
    const outsider = { id: (await makeUser("Mallory")).id };
    await makeOrg(outsider); // she owns a different organization

    const eid = f.election.id;
    const attempts: Record<string, Promise<unknown>> = {
      election: loadElection(outsider, eid),
      results: getAdminResults(outsider, eid),
      analytics: getAdminAnalytics(outsider, eid),
      turnout: getTurnout(outsider, eid),
      rollCall: rollCall(outsider, eid, { page: 1 }),
      report: buildReport(outsider, eid, "csv"),
      imports: listImports(outsider, eid),
      manualImport: createManualImport(outsider, eid, { csv: "email\nx@x.test" }),
      candidateUpdate: updateCandidate(outsider, f.alice.id, { name: "Hacked" }),
      candidateAdd: addCandidate(outsider, f.position.id, { name: "Mallory" }),
      positionRemove: removePosition(outsider, f.position.id),
      transition: transitionElection(outsider, eid, "close"),
      requireOrg: requireOrganization(outsider.id, f.org.id),
      requirePosition: requirePosition(outsider.id, f.position.id),
      requireCandidate: requireCandidate(outsider.id, f.alice.id),
    };
    for (const [name, p] of Object.entries(attempts)) expect(await code(p), name).toBe("NOT_FOUND");
    // Nothing changed.
    expect((await db.candidate.findUniqueOrThrow({ where: { id: f.alice.id } })).name).toBe("Alice");
    expect((await db.election.findUniqueOrThrow({ where: { id: eid } })).status).toBe("OPEN");
  });

  it("does not let an import id from one election be used through another", async () => {
    freezeClock();
    const a = await makeElection();
    const b = await makeElection();
    const imp = await createManualImport(a.actor, a.election.id, { csv: "email\nx@x.test" }).catch(() => null); // frozen/open: may be refused, fall back below
    const own = imp ?? (await db.rosterImport.findFirstOrThrow({ where: { electionId: a.election.id } }));
    expect(await code(getImport(b.actor, b.election.id, own.id))).toBe("NOT_FOUND");
  });

  it("restricts owner-only actions to owners", async () => {
    freezeClock();
    const f = await makeElection();
    const admin = await makeUser("Admin");
    await db.membership.create({ data: { organizationId: f.org.id, userId: admin.id, role: "ADMIN" } });
    await transitionElection(f.actor, f.election.id, "close");
    expect(await code(transitionElection({ id: admin.id }, f.election.id, "publish"))).toBe("FORBIDDEN");
    await transitionElection(f.actor, f.election.id, "publish");
  });
});

describe("database guards", () => {
  it("blocks updates and deletes of audit events, ballots and selections", async () => {
    freezeClock();
    const f = await makeElection();
    const i = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    await submitBallot({ slug: f.election.voterSlug, credential: i.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id] }], deviceId: null });
    for (const sql of [
      `UPDATE "AuditEvent" SET action = 'x'`, `DELETE FROM "AuditEvent"`,
      `UPDATE "Ballot" SET electionId = 'x'`, `DELETE FROM "Ballot"`,
      `UPDATE "BallotSelection" SET candidateId = NULL`, `DELETE FROM "BallotSelection"`,
    ]) {
      await expect(db.$executeRawUnsafe(sql), sql).rejects.toThrow(/append-only/i);
    }
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(1);
  });

  it("enforces foreign keys", async () => {
    freezeClock();
    await expect(db.$executeRawUnsafe(`INSERT INTO "BallotSelection" (id, ballotId, positionId, candidateId) VALUES ('s1', 'no-such-ballot', 'p', NULL)`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`INSERT INTO "Attendance" (id, electionId, eligibleVoterId, state, checkedInHour) VALUES ('a1', 'e', 'no-such-voter', 'CHECKED_IN', 0)`)).rejects.toThrow();
  });

  it("stores credentials only as keyed hashes", async () => {
    freezeClock();
    const f = await makeElection();
    const i = await verifyVoter({ slug: f.election.voterSlug, values: { email: "b@x.test" }, deviceId: null });
    const rows = await db.votingCredential.findMany({ where: { electionId: f.election.id } });
    expect(JSON.stringify(rows)).not.toContain(i.credential);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("crypto helpers", () => {
  it("seals and opens, binds to context, and detects tampering", () => {
    const env = seal("hello", "ctx-a");
    expect(env).not.toContain("hello");
    expect(open(env, "ctx-a")).toBe("hello");
    expect(() => open(env, "ctx-b")).toThrow();
    const parts = env.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."), "ctx-a")).toThrow();
    expect(seal("hello", "ctx-a")).not.toBe(env); // fresh IV each time
  });

  it("derives independent keys per purpose and election", () => {
    const a = hmacHex("roster-lookup", "e1", "email", "a@x.test");
    expect(a).toBe(hmacHex("roster-lookup", "e1", "email", "a@x.test"));
    expect(a).not.toBe(hmacHex("roster-lookup", "e2", "email", "a@x.test"));
    expect(a).not.toBe(hmacHex("roster-primary", "e1", "email", "a@x.test"));
    // Length-prefixed encoding: moving a boundary between parts changes the digest.
    expect(hmacHex("roster-lookup", "ab", "c")).not.toBe(hmacHex("roster-lookup", "a", "bc"));
  });

  it("changes every derived value when the application secret changes", () => {
    const before = hmacHex("seal", "x");
    const old = process.env.APP_SECRET;
    process.env.APP_SECRET = "another-app-secret-0123456789abcdef0123";
    resetEnvForTests(); resetKeyCacheForTests();
    expect(hmacHex("seal", "x")).not.toBe(before);
    process.env.APP_SECRET = old;
    resetEnvForTests(); resetKeyCacheForTests();
  });

  it("signs and verifies local storage URLs, rejecting tampering and expiry", () => {
    const key = "uploads/org1/el1/abcdefgh1234";
    const exp = Math.floor(Date.now() / 1000) + 60;
    const url = new URL(signLocalUrl({ op: "get", key, ct: "image/png", exp }));
    expect(verifyLocalUrl(url.searchParams, "get")).not.toBeNull();
    expect(verifyLocalUrl(url.searchParams, "put")).toBeNull(); // wrong operation
    const t = new URL(url); t.searchParams.set("key", "uploads/org1/el1/zzzzzzzz9999");
    expect(verifyLocalUrl(t.searchParams, "get")).toBeNull();
    expect(verifyLocalUrl(url.searchParams, "get", Date.now() + 120_000)).toBeNull(); // expired
    const esc = new URL(url); esc.searchParams.set("key", "../../etc/passwd");
    expect(verifyLocalUrl(esc.searchParams, "get")).toBeNull();
    expect(signPayload("a")).not.toBe(signPayload("b"));
  });
});

describe("configuration fails closed", () => {
  const base = { NODE_ENV: "production", APP_URL: "https://vote.example.org", DATABASE_URL: "postgresql://u:p@h/db", BETTER_AUTH_SECRET: "k".repeat(40), APP_SECRET: "j".repeat(40), CRON_SECRET: "c".repeat(20), STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "s", RATE_LIMIT_DRIVER: "database" };
  it("accepts a sound production configuration", () => { expect(() => loadEnv(base)).not.toThrow(); });
  it.each([
    ["placeholder secret", { BETTER_AUTH_SECRET: "please-change-me-please-change-me-please" }],
    ["short secret", { APP_SECRET: "short" }],
    ["same secret twice", { APP_SECRET: "k".repeat(40) }],
    ["missing cron secret", { CRON_SECRET: undefined }],
    ["sqlite in production", { DATABASE_URL: "file:./dev.db" }],
    ["local storage in production", { STORAGE_DRIVER: "local" }],
    ["memory rate limiter in production", { RATE_LIMIT_DRIVER: "memory" }],
    ["s3 without credentials", { S3_BUCKET: undefined }],
  ])("rejects %s", (_n, patch) => { expect(() => loadEnv({ ...base, ...patch } as Record<string, string | undefined>)).toThrow(/Invalid server configuration/); });

  it("never echoes the offending value in the error", () => {
    try { loadEnv({ ...base, BETTER_AUTH_SECRET: "super-secret-placeholder-value-xxxxxxxxxxxx" }); } catch (e) { expect(String(e)).not.toContain("super-secret-placeholder-value"); }
  });

  it("refuses to run unprotected when the rate limiter is disabled", async () => {
    process.env.RATE_LIMIT_DRIVER = "none"; resetEnvForTests(); setRateLimiterForTests(undefined);
    expect(await code(enforceLimit("k", { limit: 1, windowSec: 60 }))).toBe("CONFIG_ERROR");
    process.env.RATE_LIMIT_DRIVER = "memory"; resetEnvForTests();
  });
});

describe("rate limiting", () => {
  it("allows up to the limit, then answers 429 with a retry hint", async () => {
    setRateLimiterForTests(new MemoryRateLimiter());
    for (let i = 0; i < 3; i++) await enforceLimit("k1", { limit: 3, windowSec: 60 });
    const e = await enforceLimit("k1", { limit: 3, windowSec: 60 }).then(() => null, (x) => x);
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.details.retryAfterSec).toBeGreaterThan(0);
    await enforceLimit("other", { limit: 3, windowSec: 60 }); // keys are independent
  });

  it("counts atomically in the database-backed limiter", async () => {
    process.env.RATE_LIMIT_DRIVER = "database"; resetEnvForTests(); setRateLimiterForTests(undefined);
    const l = getRateLimiter();
    const results = await Promise.all(Array.from({ length: 12 }, () => l.consume("db-key", { limit: 5, windowSec: 3600 })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await l.peek("db-key", { limit: 5, windowSec: 3600 })).count).toBe(12);
    process.env.RATE_LIMIT_DRIVER = "memory"; resetEnvForTests(); setRateLimiterForTests(undefined);
  });
});

describe("HTTP boundary", () => {
  const handler = route("test.echo", { auth: "none", body: z.strictObject({ n: z.number().int() }) }, async ({ body }) => ({ n: body.n }));
  const post = (init: { origin?: string | null; type?: string; body?: string; site?: string }) =>
    handler(new Request("http://localhost:3000/api/echo", { method: "POST", headers: { ...(init.origin === null ? {} : { Origin: init.origin ?? "http://localhost:3000" }), ...(init.site ? { "Sec-Fetch-Site": init.site } : {}), "Content-Type": init.type ?? "application/json" }, body: init.body ?? '{"n":1}' }));

  it("accepts a same-origin JSON request", async () => { expect((await post({})).status).toBe(200); });
  it("rejects cross-origin and origin-less state-changing requests", async () => {
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ origin: null })).status).toBe(403);
    expect((await post({ origin: null, site: "same-origin" })).status).toBe(200);
  });
  it("requires JSON, rejects oversized bodies, and validates strictly", async () => {
    expect((await post({ type: "text/plain" })).status).toBe(415);
    expect((await post({ body: "x".repeat(300_000) })).status).toBe(413);
    const bad = await post({ body: '{"n":"1","extra":true}' });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.fields).toBeTruthy();
    expect((await post({ body: "{not json" })).status).toBe(422);
  });
  it("never echoes request data in error responses and always sets no-store", async () => {
    const r = await post({ body: '{"n":"super-secret-value"}' });
    expect(await r.text()).not.toContain("super-secret-value");
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("logging and audit hygiene", () => {
  it("redacts sensitive keys in log fields", () => {
    const out = redactForTests({ email: "a@x.test", credential: "tok", nested: { selection: ["alice"], ok: "fine" }, requestId: "r1" }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/a@x\.test|tok|alice/);
    expect(JSON.stringify(out)).toContain("fine");
  });
  it("drops sensitive metadata keys and non-primitive values from audit events", () => {
    const m = sanitizeMetadata({ email: "a@x.test", token: "t", candidate_id: "c", count: 3, nested: { a: 1 }, note: "ok" });
    expect(m).toEqual({ count: 3, note: "ok" });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { MemoryRateLimiter, setRateLimiterForTests } from "@/server/adapters/ratelimit";
import { getAuth } from "@/server/auth";
import { signLocalUrl } from "@/server/adapters/storage";
import { freezeClock, makeElection, uid } from "./helpers/factory";

import * as orgs from "@/app/api/orgs/route";
import * as org from "@/app/api/orgs/[orgId]/route";
import * as electionRoute from "@/app/api/elections/[electionId]/route";
import * as results from "@/app/api/elections/[electionId]/results/route";
import * as verify from "@/app/api/public/v/[slug]/verify/route";
import * as submit from "@/app/api/public/v/[slug]/submit/route";
import * as publicInfo from "@/app/api/public/v/[slug]/route";
import * as publicResults from "@/app/api/public/r/[slug]/results/route";
import * as sweep from "@/app/api/jobs/sweep/route";
import * as jobRun from "@/app/api/jobs/run/route";
import * as storage from "@/app/api/storage/local/route";
import * as health from "@/app/api/health/route";

const ORIGIN = "http://localhost:3000";
beforeEach(() => setRateLimiterForTests(new MemoryRateLimiter()));
afterEach(() => setClockForTests(null));

async function signUp() {
  const email = `${uid()}@example.test`;
  const res = await getAuth().api.signUpEmail({ body: { name: "Tester", email, password: "correct horse battery" }, asResponse: true });
  expect(res.status).toBe(200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  expect(cookie).toContain("quorum");
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { cookie, user };
}
const call = (handler: (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>, method: string, url: string, opts: { cookie?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {}) =>
  handler(new Request(`${ORIGIN}${url}`, {
    method,
    headers: { ...(method !== "GET" ? { Origin: ORIGIN, "Content-Type": "application/json" } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }), { params: Promise.resolve(opts.params ?? {}) });

describe("admin API", () => {
  it("rejects unauthenticated requests with the standard error shape", async () => {
    const res = await call(orgs.GET, "GET", "/api/orgs");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(body.error.requestId).toBeTruthy();
  });

  it("signs up, creates an organization, and keeps it invisible to another account", async () => {
    const a = await signUp();
    const b = await signUp();
    const created = await call(orgs.POST, "POST", "/api/orgs", { cookie: a.cookie, body: { name: "Chess Club" } });
    expect(created.status).toBe(201);
    const { organization } = await created.json();
    expect((await call(org.GET, "GET", `/api/orgs/${organization.id}`, { cookie: a.cookie, params: { orgId: organization.id } })).status).toBe(200);
    const denied = await call(org.GET, "GET", `/api/orgs/${organization.id}`, { cookie: b.cookie, params: { orgId: organization.id } });
    expect(denied.status).toBe(404);
    const list = await (await call(orgs.GET, "GET", "/api/orgs", { cookie: b.cookie })).json();
    expect(list.organizations).toEqual([]);
  });

  it("blocks cross-origin writes even with a valid session", async () => {
    const a = await signUp();
    const res = await orgs.POST(new Request(`${ORIGIN}/api/orgs`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: a.cookie }, body: JSON.stringify({ name: "Nope Club" }) }));
    expect(res.status).toBe(403);
    expect(await db.organization.count({ where: { name: "Nope Club" } })).toBe(0);
  });

  it("gates admin results behind membership and the disclosure policy", async () => {
    freezeClock();
    const f = await makeElection({ disclosure: "AFTER_CLOSE" });
    const owner = await signUp();
    await db.membership.create({ data: { organizationId: f.org.id, userId: owner.user.id, role: "ADMIN" } });
    const outsider = await signUp();
    const p = { electionId: f.election.id };
    expect((await call(results.GET, "GET", "/x", { cookie: outsider.cookie, params: p })).status).toBe(404);
    const hidden = await (await call(results.GET, "GET", "/x", { cookie: owner.cookie, params: p })).json();
    expect(hidden).toMatchObject({ available: false, reason: "voting_open" });
    expect(JSON.stringify(hidden)).not.toMatch(/"votes"/);
    const detail = await (await call(electionRoute.GET, "GET", "/x", { cookie: owner.cookie, params: p })).json();
    expect(detail.links.vote).toContain("/v/");
  });
});

describe("public voting API", () => {
  it("verifies and submits through the HTTP handlers, and never returns roster or tally data", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const info = await (await call(publicInfo.GET, "GET", "/x", { params: { slug } })).json();
    expect(info).toMatchObject({ title: "Board election", restricted: true, open: true });
    expect(JSON.stringify(info)).not.toContain("a@x.test");
    expect(info.resultsSlug).toBeNull(); // the results link is withheld until results can be public
    expect(JSON.stringify(info)).not.toContain(f.election.resultsSlug);

    const bad = await call(verify.POST, "POST", "/x", { params: { slug }, body: { values: { email: "ghost@x.test" } } });
    expect(bad.status).toBe(403);
    expect((await bad.json()).error.code).toBe("VERIFICATION_FAILED");

    const ok = await call(verify.POST, "POST", "/x", { params: { slug }, body: { values: { email: "a@x.test" } } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toBeNull(); // restricted elections set no device cookie
    const issued = await ok.json();
    expect(issued.ballot[0].candidates.map((c: { name: string }) => c.name)).toEqual(["Alice", "Bob"]);

    const sub = await call(submit.POST, "POST", "/x", { params: { slug }, body: { credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id] }] } });
    expect(sub.status).toBe(200);
    const again = await call(submit.POST, "POST", "/x", { params: { slug }, body: { credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id] }] } });
    expect(again.status).toBe(403);
    expect((await call(publicResults.GET, "GET", "/x", { params: { slug: f.election.resultsSlug } }).then((r) => r.json()))).toMatchObject({ available: false });
  });

  it("sets an HttpOnly device cookie for open-access elections only", async () => {
    freezeClock();
    const f = await makeElection({ mode: "OPEN" });
    const res = await call(verify.POST, "POST", "/x", { params: { slug: f.election.voterSlug }, body: { values: {} } });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/quorum_device=.+HttpOnly.+SameSite=Lax/);
  });

  it("answers 404 for malformed or unknown voting links and rate-limits repeated verification", async () => {
    expect((await call(publicInfo.GET, "GET", "/x", { params: { slug: "short" } })).status).toBe(404);
    expect((await call(publicInfo.GET, "GET", "/x", { params: { slug: "a".repeat(22) } })).status).toBe(404);
    freezeClock();
    const f = await makeElection();
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await call(verify.POST, "POST", "/x", { params: { slug: f.election.voterSlug }, body: { values: { email: `g${i}@x.test` } } })).status;
    expect(last).toBe(429);
  });
});

describe("infrastructure endpoints", () => {
  it("protects the sweeper with the cron secret", async () => {
    expect((await call(sweep.GET, "GET", "/api/jobs/sweep")).status).toBe(401);
    expect((await call(sweep.GET, "GET", "/api/jobs/sweep", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = await call(sweep.GET, "GET", "/api/jobs/sweep", { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });

  it("refuses unsigned job deliveries", async () => {
    const res = await jobRun.POST(new Request(`${ORIGIN}/api/jobs/run`, { method: "POST", body: JSON.stringify({ name: "roster.parse", payload: { importId: "x" } }) }));
    expect(res.status).toBe(401);
  });

  it("serves local storage only for valid signed URLs, enforces size and type, and never overwrites", async () => {
    const key = `uploads/org${uid()}/el${uid()}/${uid()}${uid()}`;
    const exp = Math.floor(Date.now() / 1000) + 60;
    const put = new URL(signLocalUrl({ op: "put", key, ct: "text/csv", exp, size: 10 }));
    const send = (u: URL, body: string, type = "text/csv") => storage.PUT(new Request(u, { method: "PUT", headers: { "Content-Type": type, "Content-Length": String(Buffer.byteLength(body)) }, body }));
    expect((await send(put, "a,b\n1,2\n")).status).toBe(204);
    expect((await send(put, "a,b\n1,2\n")).status).toBe(409); // no overwrite
    const tampered = new URL(put); tampered.searchParams.set("size", "999999");
    expect((await send(tampered, "x")).status).toBe(403);
    const key2 = `uploads/org${uid()}/el${uid()}/${uid()}${uid()}`;
    const small = new URL(signLocalUrl({ op: "put", key: key2, ct: "text/csv", exp, size: 4 }));
    expect((await send(small, "too long for the link")).status).toBe(413);
    expect((await send(small, "abc", "application/pdf")).status).toBe(415);
    const expired = new URL(signLocalUrl({ op: "put", key: key2, ct: "text/csv", exp: Math.floor(Date.now() / 1000) - 5, size: 4 }));
    expect((await send(expired, "abc")).status).toBe(403);
    const get = new URL(signLocalUrl({ op: "get", key, ct: "text/csv", exp }));
    const read = await storage.GET(new Request(get));
    expect(read.status).toBe(200);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await read.text()).toBe("a,b\n1,2\n");
    expect((await storage.GET(new Request(put))).status).toBe(403); // a PUT link cannot read
  });

  it("reports liveness without leaking configuration", async () => {
    const body = await (await health.GET()).json();
    expect(body).toEqual({ ok: true });
  });
});

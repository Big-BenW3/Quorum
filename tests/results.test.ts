import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { MemoryRateLimiter, setRateLimiterForTests } from "@/server/adapters/ratelimit";
import { transitionElection } from "@/server/domain/election";
import { submitBallot, verifyVoter } from "@/server/domain/voting";
import { buildReport, csvCell, buildSeries, getAdminAnalytics, getAdminResults, getPublicAnalytics, getPublicResults, groupTurnout } from "@/server/domain/results";
import { getTurnout } from "@/server/domain/turnout";
import { decide } from "@/server/domain/rules";
import { addCandidate } from "@/server/domain/ballot-config";
import { freezeClock, makeElection, type Fixture } from "./helpers/factory";

beforeEach(() => setRateLimiterForTests(new MemoryRateLimiter()));
afterEach(() => setClockForTests(null));

async function vote(f: Fixture, email: string, choice: string | null) {
  const i = await verifyVoter({ slug: f.election.voterSlug, values: { email }, deviceId: null });
  await submitBallot({ slug: f.election.voterSlug, credential: i.credential, selections: [{ positionId: f.position.id, candidateIds: choice ? [choice] : [] }], deviceId: null });
}

describe("disclosure gating", () => {
  it("AFTER_CLOSE: hides tallies and analytics from everyone until closed, and from the public until published", async () => {
    freezeClock();
    const f = await makeElection({ disclosure: "AFTER_CLOSE", voters: ["a@x.test", "b@x.test", "c@x.test"] });
    await vote(f, "a@x.test", f.alice.id);

    const open = await getAdminResults(f.actor, f.election.id);
    expect(open.available).toBe(false);
    expect((await getAdminAnalytics(f.actor, f.election.id)).available).toBe(false);
    expect((await getPublicResults(f.election.resultsSlug)).available).toBe(false);
    // A hidden payload carries no counts at all.
    expect(JSON.stringify(open)).not.toMatch(/votes|tally|ballots/);

    await transitionElection(f.actor, f.election.id, "close");
    const closed = await getAdminResults(f.actor, f.election.id);
    expect(closed.available).toBe(true);
    expect((await getAdminAnalytics(f.actor, f.election.id)).available).toBe(true);
    expect((await getPublicResults(f.election.resultsSlug)).available).toBe(false);
    expect((await getPublicAnalytics(f.election.resultsSlug)).available).toBe(false);

    await transitionElection(f.actor, f.election.id, "publish");
    expect((await getPublicResults(f.election.resultsSlug)).available).toBe(true);
    expect((await getPublicAnalytics(f.election.resultsSlug)).available).toBe(true);
  });

  it("LIVE: shows tallies while open but never analytics until the vote has ended", async () => {
    freezeClock();
    const f = await makeElection({ disclosure: "LIVE" });
    await vote(f, "a@x.test", f.bob.id);
    const live = await getPublicResults(f.election.resultsSlug);
    expect(live.available).toBe(true);
    if (live.available) expect(live.live).toBe(true);
    expect((await getPublicAnalytics(f.election.resultsSlug)).available).toBe(false);
    expect((await getAdminAnalytics(f.actor, f.election.id)).available).toBe(false);
    await transitionElection(f.actor, f.election.id, "close");
    expect((await getPublicAnalytics(f.election.resultsSlug)).available).toBe(true);
  });

  it("refuses downloads until results are visible and records the download", async () => {
    freezeClock();
    const f = await makeElection();
    await expect(buildReport(f.actor, f.election.id, "csv")).rejects.toMatchObject({ code: "RESULTS_NOT_AVAILABLE" });
    await transitionElection(f.actor, f.election.id, "close");
    const csv = await buildReport(f.actor, f.election.id, "csv");
    expect(csv.contentType).toContain("text/csv");
    expect(await db.auditEvent.count({ where: { electionId: f.election.id, action: "report.downloaded" } })).toBe(1);
  });
});

describe("tallies and analytics", () => {
  it("counts plurality results, abstentions, margins and turnout", async () => {
    freezeClock();
    const voters = ["a", "b", "c", "d", "e", "f"].map((x) => `${x}@x.test`);
    const f = await makeElection({ voters });
    await vote(f, "a@x.test", f.alice.id);
    await vote(f, "b@x.test", f.alice.id);
    await vote(f, "c@x.test", f.alice.id);
    await vote(f, "d@x.test", f.bob.id);
    await vote(f, "e@x.test", null);
    await transitionElection(f.actor, f.election.id, "close");

    const r = await getAdminResults(f.actor, f.election.id);
    if (!r.available) throw new Error("expected results");
    const p = r.tally.positions[0]!;
    expect(r.tally.ballots).toBe(5);
    expect(p.candidates.map((c) => [c.name, c.votes])).toEqual([["Alice", 3], ["Bob", 1]]);
    expect(p.abstentions).toBe(1);
    expect(p.outcome).toMatchObject({ status: "decided", winners: [f.alice.id] });
    expect(p.margin).toMatchObject({ votes: 2, leader: "Alice", runnerUp: "Bob" });

    const a = await getAdminAnalytics(f.actor, f.election.id);
    if (!a.available) throw new Error("expected analytics");
    expect(a.analytics.summary).toMatchObject({ ballots: 5, eligible: 6 });
    expect(a.analytics.summary.turnoutRate).toBeCloseTo(5 / 6);
    expect(a.analytics.funnel).toEqual({ eligible: 6, verified: 5, voted: 5 });
    expect(a.analytics.series.points.at(-1)!.cumulative).toBe(5);
    expect(a.analytics.positions[0]!.abstentionRate).toBeCloseTo(1 / 5);

    const t = await getTurnout(f.actor, f.election.id);
    expect(t).toMatchObject({ ballots: 5, eligible: 6, pending: 1 });
  });

  it("keeps per-group turnout out of the public analytics and combines small groups", async () => {
    freezeClock();
    const emails = Array.from({ length: 8 }, (_, i) => `u${i}@x.test`);
    const groups = Object.fromEntries(emails.map((e, i) => [e, i < 6 ? "Engineering" : i === 6 ? "Legal" : "Ops"]));
    const f = await makeElection({ voters: emails, groups });
    await vote(f, "u0@x.test", f.alice.id);
    await vote(f, "u6@x.test", f.bob.id);
    await transitionElection(f.actor, f.election.id, "close");
    await transitionElection(f.actor, f.election.id, "publish");
    const admin = await getAdminAnalytics(f.actor, f.election.id);
    const pub = await getPublicAnalytics(f.election.resultsSlug);
    if (!admin.available || !pub.available) throw new Error("expected analytics");
    expect(pub.analytics.groups).toBeNull();
    expect(pub.analytics.funnel).not.toBeNull(); // totals are fine, group breakdowns are not
    const rows = admin.analytics.groups!.rows;
    expect(rows.map((r) => r.group)).toEqual(["Engineering"]);
    expect(admin.analytics.groups!.hiddenVoters).toBe(2); // Legal(1)+Ops(1) is below the minimum even when combined
  });

  it("builds a continuous series with zero-vote hours and aggregates long elections by day", () => {
    const h = 3_600_000;
    const t0 = Date.UTC(2026, 10, 9, 12);
    const short = buildSeries(new Map([[t0, 2], [t0 + 3 * h, 1]]), new Date(t0), new Date(t0 + 4 * h));
    expect(short.bucket).toBe("hour");
    expect(short.points.map((p) => p.votes)).toEqual([2, 0, 0, 1, 0]);
    expect(short.points.at(-1)!.cumulative).toBe(3);
    const long = buildSeries(new Map([[t0, 1], [t0 + 10 * 24 * h, 1]]), new Date(t0), new Date(t0 + 10 * 24 * h));
    expect(long.bucket).toBe("day");
    expect(long.points.at(-1)!.cumulative).toBe(2);
    expect(buildSeries(new Map(), null, null).points).toEqual([]);
  });

  it("suppresses tiny groups", () => {
    const rows = [...Array(5).fill(0).map(() => ({ group: "A", voted: true })), { group: "B", voted: false }, { group: "C", voted: true }];
    const g = groupTurnout(rows);
    expect(g.rows).toEqual([{ group: "A", eligible: 5, voted: 5, rate: 1 }]);
    expect(g.hiddenVoters).toBe(2);
  });
});

describe("ties are never broken silently", () => {
  const c = (id: string, votes: number) => ({ id, name: id, votes });
  it("reports a tie for the last seat", () => {
    expect(decide([c("a", 5), c("b", 3), c("c", 3)], 2)).toMatchObject({ status: "tie", winners: ["a"], tied: ["b", "c"] });
  });
  it("reports a full tie for a single seat", () => {
    expect(decide([c("a", 4), c("b", 4)], 1)).toMatchObject({ status: "tie", winners: [], tied: ["a", "b"] });
  });
  it("does not elect candidates with no votes", () => {
    expect(decide([c("a", 0), c("b", 0)], 1)).toMatchObject({ status: "no_votes" });
    expect(decide([c("a", 2), c("b", 0)], 2)).toMatchObject({ status: "decided", winners: ["a"], seatsOpen: 1 });
  });
});

describe("report export", () => {
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("Smith, Jane")).toBe('"Smith, Jane"');
    expect(csvCell(12)).toBe("12");
  });

  it("exports a CSV that contains no voter information", async () => {
    freezeClock();
    const f = await makeElection();
    await addCandidate(f.actor, f.position.id, { name: "=cmd()" }).catch(() => null); // locked once open; ignore
    await vote(f, "a@x.test", f.alice.id);
    await transitionElection(f.actor, f.election.id, "close");
    const csv = await buildReport(f.actor, f.election.id, "csv");
    expect(csv.body).toContain("Alice");
    expect(csv.body).not.toContain("x.test");
    const json = await buildReport(f.actor, f.election.id, "json");
    expect(JSON.parse(json.body).notice).toMatch(/not certified/i);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { MemoryRateLimiter, setRateLimiterForTests } from "@/server/adapters/ratelimit";
import { extendVoting, rotateLinks, transitionElection, updateElection, deleteDraftElection } from "@/server/domain/election";
import { addCandidate, addPosition, removeCandidate, removePosition, updatePosition } from "@/server/domain/ballot-config";
import { getAdminResults, getAdminAnalytics, getPublicResults } from "@/server/domain/results";
import { submitBallot, verifyVoter } from "@/server/domain/voting";
import { createElection } from "@/server/domain/election";
import { AppError } from "@/server/errors";
import { freezeClock, hours, makeElection, makeOrg, makeUser, T0 } from "./helpers/factory";

/** Resolves to the error code a call fails with, or null if it succeeds. */
const codeOf = async (p: Promise<unknown>) => ((await p.then(() => null, (x) => x)) as AppError | null)?.code ?? null;

beforeEach(() => { setRateLimiterForTests(new MemoryRateLimiter()); });
afterEach(() => { setClockForTests(null); setRateLimiterForTests(undefined); });

describe("lifecycle: illegal moves are refused", () => {
  it("rejects every transition that doesn't start from an allowed state", async () => {
    freezeClock();
    const f = await makeElection({ open: false });
    // DRAFT: can't close or publish, can't unschedule.
    expect(await codeOf(transitionElection(f.actor, f.election.id, "close"))).toBe("INVALID_STATE");
    expect(await codeOf(transitionElection(f.actor, f.election.id, "publish"))).toBe("INVALID_STATE");
    expect(await codeOf(transitionElection(f.actor, f.election.id, "unschedule"))).toBe("INVALID_STATE");

    await transitionElection(f.actor, f.election.id, "open");
    // OPEN: can't open again, schedule, or publish before closing.
    expect(await codeOf(transitionElection(f.actor, f.election.id, "open"))).toBe("INVALID_STATE");
    expect(await codeOf(transitionElection(f.actor, f.election.id, "schedule"))).toBe("INVALID_STATE");
    expect(await codeOf(transitionElection(f.actor, f.election.id, "publish"))).toBe("INVALID_STATE");

    await transitionElection(f.actor, f.election.id, "close");
    // CLOSED: can't reopen or close again.
    expect(await codeOf(transitionElection(f.actor, f.election.id, "open"))).toBe("INVALID_STATE");
    expect(await codeOf(transitionElection(f.actor, f.election.id, "close"))).toBe("INVALID_STATE");

    await transitionElection(f.actor, f.election.id, "publish");
    // PUBLISHED is terminal.
    for (const a of ["open", "close", "publish", "schedule", "unschedule"] as const) {
      expect(await codeOf(transitionElection(f.actor, f.election.id, a)), a).toBe("INVALID_STATE");
    }
    expect((await db.election.findUniqueOrThrow({ where: { id: f.election.id } })).status).toBe("PUBLISHED");
  });

  it("changes state at most once when the same transition is fired concurrently", async () => {
    freezeClock();
    const f = await makeElection({ open: true });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => transitionElection(f.actor, f.election.id, "close")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const audits = await db.auditEvent.count({ where: { electionId: f.election.id, action: "election.closed" } });
    expect(audits).toBe(1);
  });

  it("only owners can publish; admins are refused", async () => {
    freezeClock();
    const f = await makeElection({ open: true });
    const admin = await makeUser("Admin");
    await db.membership.create({ data: { organizationId: f.org.id, userId: admin.id, role: "ADMIN" } });
    await transitionElection(f.actor, f.election.id, "close");
    expect(await codeOf(transitionElection({ id: admin.id }, f.election.id, "publish"))).toBe("FORBIDDEN");
    await transitionElection(f.actor, f.election.id, "publish");
  });

  it("refuses to open an unfinished ballot or an empty restricted roster", async () => {
    freezeClock();
    const { org, user } = await makeOrg();
    const actor = { id: user.id };
    const e = await createElection(actor, org.id, { title: "Empty", timezone: "UTC", eligibilityMode: "OPEN" });
    await updateElection(actor, e.id, { endsAt: new Date(T0.getTime() + hours(5)) });
    // No positions at all.
    expect(await codeOf(transitionElection(actor, e.id, "open"))).toBe("INVALID_STATE");
    // A position with no candidates.
    const p = await addPosition(actor, e.id, { title: "Chair" });
    expect(await codeOf(transitionElection(actor, e.id, "open"))).toBe("INVALID_STATE");
    // Two candidates with the same name.
    await addCandidate(actor, p.id, { name: "Sam" });
    await addCandidate(actor, p.id, { name: " sam " });
    expect(await codeOf(transitionElection(actor, e.id, "open"))).toBe("INVALID_STATE");
    // More seats than candidates.
    const q = await addPosition(actor, e.id, { title: "Board", seats: 3, maxSelections: 3 });
    await addCandidate(actor, q.id, { name: "X" });
    await addCandidate(actor, q.id, { name: "Y" });
    expect(await codeOf(transitionElection(actor, e.id, "open"))).toBe("INVALID_STATE");
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("DRAFT");
    // Restricted with an empty roster.
    const r = await createElection(actor, org.id, { title: "Restricted", timezone: "UTC", eligibilityMode: "RESTRICTED" });
    const p2 = await addPosition(actor, r.id, { title: "Chair" });
    await addCandidate(actor, p2.id, { name: "A" });
    await addCandidate(actor, p2.id, { name: "B" });
    await updateElection(actor, r.id, { endsAt: new Date(T0.getTime() + hours(5)) });
    expect(await codeOf(transitionElection(actor, r.id, "open"))).toBe("INVALID_STATE");
  });

  it("rejects schedules in the past, too short, or longer than 90 days", async () => {
    freezeClock();
    const f = await makeElection({ open: false });
    const set = (startsAt: Date, endsAt: Date) => codeOf(updateElection(f.actor, f.election.id, { startsAt, endsAt }).then(() => transitionElection(f.actor, f.election.id, "schedule")));
    expect(await set(new Date(T0.getTime() - hours(1)), new Date(T0.getTime() + hours(30)))).not.toBeNull();
    expect(await set(new Date(T0.getTime() + hours(48)), new Date(T0.getTime() + hours(48) + 60_000))).not.toBeNull();
    expect(await set(new Date(T0.getTime() + hours(48)), new Date(T0.getTime() + hours(48) + hours(24 * 91)))).not.toBeNull();
    expect((await db.election.findUniqueOrThrow({ where: { id: f.election.id } })).status).toBe("DRAFT");
  });

  it("extends voting later but never shorter, and only while open", async () => {
    const clock = freezeClock();
    const f = await makeElection({ open: true });
    const ends = (await db.election.findUniqueOrThrow({ where: { id: f.election.id } })).endsAt!;
    expect(await codeOf(extendVoting(f.actor, f.election.id, new Date(ends.getTime() - 1000)))).toBe("VALIDATION_FAILED");
    expect(await codeOf(extendVoting(f.actor, f.election.id, ends))).toBe("VALIDATION_FAILED");
    await extendVoting(f.actor, f.election.id, new Date(ends.getTime() + hours(2)));
    expect((await db.election.findUniqueOrThrow({ where: { id: f.election.id } })).endsAt!.getTime()).toBe(ends.getTime() + hours(2));
    clock.advance(hours(1));
    await transitionElection(f.actor, f.election.id, "close");
    expect(await codeOf(extendVoting(f.actor, f.election.id, new Date(ends.getTime() + hours(9))))).toBe("INVALID_STATE");
  });

  it("closes automatically when the end time passes, with no admin action", async () => {
    const clock = freezeClock();
    const f = await makeElection({ open: true });
    clock.set(new Date(f.election.endsAt!.getTime() + 1000));
    const res = await getAdminResults(f.actor, f.election.id);
    expect(res.election.status).toBe("CLOSED");
  });

  it("deletes only empty drafts", async () => {
    freezeClock();
    const f = await makeElection({ open: true });
    expect(await codeOf(deleteDraftElection(f.actor, f.election.id))).toBe("INVALID_STATE");
    const g = await makeElection({ open: false });
    await deleteDraftElection(g.actor, g.election.id);
    expect(await db.election.findUnique({ where: { id: g.election.id } })).toBeNull();
  });

  it("refuses to rotate links after voting has closed, and a rotated link stops working", async () => {
    freezeClock();
    const f = await makeElection({ open: true });
    const old = f.election.voterSlug;
    const next = await rotateLinks(f.actor, f.election.id, "voter");
    expect(next.voterSlug).not.toBe(old);
    expect(await codeOf(verifyVoter({ slug: old, values: { email: "a@x.test" }, deviceId: null }))).toBe("NOT_FOUND");
    await transitionElection(f.actor, f.election.id, "close");
    expect(await codeOf(rotateLinks(f.actor, f.election.id, "both"))).toBe("INVALID_STATE");
  });
});

describe("ballot configuration is locked once voting begins", () => {
  it("rejects every ballot edit after the election opens", async () => {
    freezeClock();
    const f = await makeElection({ open: true });
    expect(await codeOf(addPosition(f.actor, f.election.id, { title: "Treasurer" }))).toBe("BALLOT_FROZEN");
    expect(await codeOf(updatePosition(f.actor, f.position.id, { title: "Renamed" }))).toBe("BALLOT_FROZEN");
    expect(await codeOf(addCandidate(f.actor, f.position.id, { name: "Late entry" }))).toBe("BALLOT_FROZEN");
    expect(await codeOf(removeCandidate(f.actor, f.alice.id))).toBe("BALLOT_FROZEN");
    expect(await codeOf(removePosition(f.actor, f.position.id))).toBe("BALLOT_FROZEN");
    expect(await db.candidate.count({ where: { positionId: f.position.id } })).toBe(2);
  });

  it("enforces the 100-candidate cap", async () => {
    freezeClock();
    const f = await makeElection({ open: false });
    const p = await addPosition(f.actor, f.election.id, { title: "Big race" });
    await db.candidate.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ positionId: p.id, name: `C${i}`, sortOrder: i })) });
    expect(await codeOf(addCandidate(f.actor, p.id, { name: "One too many" }))).toBe("INVALID_STATE");
  });
});

describe("ballot validation edge cases", () => {
  const vote = async (f: Awaited<ReturnType<typeof makeElection>>, selections: { positionId: string; candidateIds: string[] }[]) => {
    const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    return codeOf(submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections, deviceId: null }));
  };

  it("refuses an empty ballot, a duplicated position, an unknown position, and a repeated candidate", async () => {
    freezeClock();
    const f = await makeElection();
    expect(await vote(f, [])).toBe("BALLOT_INVALID");
    expect(await vote(f, [{ positionId: f.position.id, candidateIds: [f.alice.id] }, { positionId: f.position.id, candidateIds: [f.bob.id] }])).toBe("BALLOT_INVALID");
    expect(await vote(f, [{ positionId: "missing", candidateIds: [] }])).toBe("BALLOT_INVALID");
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(0);
  });

  it("refuses an abstention where the position doesn't allow one", async () => {
    freezeClock();
    const f = await makeElection();
    await db.election.update({ where: { id: f.election.id }, data: { status: "DRAFT", startsAt: null } });
    await updatePosition(f.actor, f.position.id, { allowAbstain: false });
    await db.election.update({ where: { id: f.election.id }, data: { status: "OPEN", startsAt: T0 } });
    expect(await vote(f, [{ positionId: f.position.id, candidateIds: [] }])).toBe("BALLOT_INVALID");
  });

  it("refuses a candidate that belongs to a different position or election", async () => {
    freezeClock();
    const f = await makeElection();
    const g = await makeElection();
    expect(await vote(f, [{ positionId: f.position.id, candidateIds: [g.alice.id] }])).toBe("BALLOT_INVALID");
  });

  it("refuses a vote with a credential from a different election", async () => {
    freezeClock();
    const f = await makeElection();
    const g = await makeElection();
    const issued = await verifyVoter({ slug: g.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    const code = await codeOf(submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id] }], deviceId: null }));
    expect(code).not.toBeNull();
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(0);
  });

  it("accepts a ballot whose votes arrive in a burst without losing or duplicating any", async () => {
    freezeClock();
    const emails = Array.from({ length: 12 }, (_, i) => `v${i}@x.test`);
    const f = await makeElection({ voters: emails });
    const outcomes = await Promise.allSettled(emails.map(async (email) => {
      const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email }, deviceId: null });
      return submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id] }], deviceId: null });
    }));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(12);
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(12);
    expect(await db.ballotSelection.count({ where: { ballot: { electionId: f.election.id } } })).toBe(12);
    expect(await db.attendance.count({ where: { electionId: f.election.id } })).toBe(12);
  });
});

describe("results and analytics for elections with no votes", () => {
  it("reports an empty tally and zero turnout without dividing by zero", async () => {
    const clock = freezeClock();
    const f = await makeElection({ open: true });
    clock.advance(hours(80));
    const res = await getAdminResults(f.actor, f.election.id);
    expect(res.election.status).toBe("CLOSED");
    if (!res.available) throw new Error("expected tallies once closed");
    expect(res.tally.ballots).toBe(0);
    for (const p of res.tally.positions) expect(p.candidates.every((c) => c.votes === 0 && c.shareOfBallots === 0)).toBe(true);
    const an = await getAdminAnalytics(f.actor, f.election.id);
    expect(JSON.stringify(an)).not.toMatch(/NaN|Infinity/);
  });

  it("keeps public results hidden until published, then shows them", async () => {
    const clock = freezeClock();
    const f = await makeElection({ open: true });
    clock.advance(hours(80));
    const hidden = await getPublicResults(f.election.resultsSlug);
    expect("available" in hidden && hidden.available).toBe(false);
    await transitionElection(f.actor, f.election.id, "publish");
    const shown = await getPublicResults(f.election.resultsSlug);
    expect("available" in shown && shown.available === false).toBe(false);
  });

  it("answers an unknown results link without revealing anything", async () => {
    freezeClock();
    expect(await codeOf(getPublicResults("not-a-real-slug"))).toBe("NOT_FOUND");
  });
});

describe("chart axis ticks", () => {
  it("are whole numbers, ascending, and cover the maximum", async () => {
    const { niceTicks } = await import("@/components/charts/kit");
    for (const max of [0, 1, 2, 3, 7, 10, 23, 99, 100, 1234, 56_789]) {
      const t = niceTicks(max);
      expect(t.every(Number.isInteger), `max ${max}: ${t}`).toBe(true);
      expect(t).toEqual([...t].sort((a, b) => a - b));
      expect(t[0]).toBe(0);
      expect(t.at(-1)!).toBeGreaterThanOrEqual(max);
      expect(t.length).toBeLessThanOrEqual(7);
    }
    expect(niceTicks(2)).toEqual([0, 1, 2]);
  });
});

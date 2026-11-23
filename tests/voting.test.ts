import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { setRateLimiterForTests, MemoryRateLimiter } from "@/server/adapters/ratelimit";
import { submitBallot, verifyVoter } from "@/server/domain/voting";
import { freezeClock, hours, makeElection, type Fixture } from "./helpers/factory";
import { AppError } from "@/server/errors";

const pick = (f: Fixture, candidateId: string | null) => [{ positionId: f.position.id, candidateIds: candidateId ? [candidateId] : [] }];
const rejects = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x) => x);
  expect(e, `expected ${code}`).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
};

beforeEach(() => { setRateLimiterForTests(new MemoryRateLimiter()); });
afterEach(() => { setClockForTests(null); });

describe("restricted voting", () => {
  it("lets a rostered voter verify and cast exactly one ballot", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const issued = await verifyVoter({ slug, values: { email: "A@X.test " }, deviceId: null });
    expect(issued.ballot[0]!.candidates.map((c) => c.name)).toEqual(["Alice", "Bob"]);
    await submitBallot({ slug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null });
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(1);
    const att = await db.attendance.findMany({ where: { electionId: f.election.id } });
    expect(att).toHaveLength(1);
    expect(att[0]!.state).toBe("VOTED");
    // A second attempt with the same details is refused.
    await rejects(verifyVoter({ slug, values: { email: "a@x.test" }, deviceId: null }), "ALREADY_VOTED");
  });

  it("does not reveal whether an identity is on the roster", async () => {
    freezeClock();
    const f = await makeElection();
    const miss = await verifyVoter({ slug: f.election.voterSlug, values: { email: "nobody@x.test" }, deviceId: null }).catch((e) => e as AppError);
    expect(miss).toBeInstanceOf(AppError);
    expect((miss as AppError).code).toBe("VERIFICATION_FAILED");
    expect((miss as AppError).message).toMatch(/couldn't match/i);
  });

  it("throttles repeated guesses per identity, including for identities that don't exist", async () => {
    freezeClock();
    const f = await makeElection();
    for (let i = 0; i < 6; i++) await rejects(verifyVoter({ slug: f.election.voterSlug, values: { email: "ghost@x.test" }, deviceId: null }), "VERIFICATION_FAILED");
    await rejects(verifyVoter({ slug: f.election.voterSlug, values: { email: "ghost@x.test" }, deviceId: null }), "RATE_LIMITED");
  });

  it("rejects replay of a spent credential", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const issued = await verifyVoter({ slug, values: { email: "b@x.test" }, deviceId: null });
    await submitBallot({ slug, credential: issued.credential, selections: pick(f, f.bob.id), deviceId: null });
    await rejects(submitBallot({ slug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null }), "CREDENTIAL_INVALID");
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(1);
  });

  it("expires credentials and retires older ones when a voter re-verifies", async () => {
    const clock = freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const first = await verifyVoter({ slug, values: { email: "c@x.test" }, deviceId: null });
    const second = await verifyVoter({ slug, values: { email: "c@x.test" }, deviceId: null });
    await rejects(submitBallot({ slug, credential: first.credential, selections: pick(f, f.alice.id), deviceId: null }), "CREDENTIAL_INVALID");
    clock.advance(f.election.credentialTtlSeconds * 1000 + 1000);
    await rejects(submitBallot({ slug, credential: second.credential, selections: pick(f, f.alice.id), deviceId: null }), "CREDENTIAL_INVALID");
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(0);
  });

  it("counts a single ballot when the same credential is submitted 20 times at once", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const issued = await verifyVoter({ slug, values: { email: "a@x.test" }, deviceId: null });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => submitBallot({ slug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(1);
    expect(await db.ballotSelection.count({ where: { ballot: { electionId: f.election.id } } })).toBe(1);
  });

  it("allows only one ballot per voter even when two verifications race", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const [a, b] = await Promise.all([verifyVoter({ slug, values: { email: "b@x.test" }, deviceId: null }), verifyVoter({ slug, values: { email: "b@x.test" }, deviceId: null })]);
    const out = await Promise.allSettled([
      submitBallot({ slug, credential: a.credential, selections: pick(f, f.alice.id), deviceId: null }),
      submitBallot({ slug, credential: b.credential, selections: pick(f, f.bob.id), deviceId: null }),
    ]);
    expect(out.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(1);
  });

  it("validates answers before spending the credential", async () => {
    freezeClock();
    const f = await makeElection();
    const slug = f.election.voterSlug;
    const issued = await verifyVoter({ slug, values: { email: "a@x.test" }, deviceId: null });
    await rejects(submitBallot({ slug, credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: [f.alice.id, f.bob.id] }], deviceId: null }), "BALLOT_INVALID");
    await rejects(submitBallot({ slug, credential: issued.credential, selections: [{ positionId: f.position.id, candidateIds: ["nope"] }], deviceId: null }), "BALLOT_INVALID");
    // The credential is still good after a rejected attempt.
    await submitBallot({ slug, credential: issued.credential, selections: pick(f, null), deviceId: null });
    const sel = await db.ballotSelection.findMany({ where: { ballot: { electionId: f.election.id } } });
    expect(sel).toHaveLength(1);
    expect(sel[0]!.candidateId).toBeNull(); // recorded as an abstention
  });

  it("refuses to verify or submit when voting is not open", async () => {
    const clock = freezeClock();
    const f = await makeElection({ open: false });
    await rejects(verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null }), "ELECTION_NOT_OPEN");
    clock.set(new Date(f.election.endsAt!.getTime() + 1000));
    await rejects(verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null }), "ELECTION_NOT_OPEN");
  });

  it("rejects a ballot that arrives after the closing time even with a valid credential", async () => {
    const clock = freezeClock();
    const f = await makeElection();
    const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    clock.set(new Date(f.election.endsAt!.getTime() + 1000));
    await rejects(submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null }), "ELECTION_NOT_OPEN");
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(0);
  });
});

describe("open-access voting", () => {
  it("accepts one ballot per device and refuses a second", async () => {
    freezeClock();
    const f = await makeElection({ mode: "OPEN" });
    const slug = f.election.voterSlug;
    const issued = await verifyVoter({ slug, values: {}, deviceId: "device-1" });
    await submitBallot({ slug, credential: issued.credential, selections: pick(f, f.bob.id), deviceId: "device-1" });
    await rejects(verifyVoter({ slug, values: {}, deviceId: "device-1" }), "ALREADY_VOTED");
    const other = await verifyVoter({ slug, values: {}, deviceId: "device-2" });
    await submitBallot({ slug, credential: other.credential, selections: pick(f, f.alice.id), deviceId: "device-2" });
    expect(await db.ballot.count({ where: { electionId: f.election.id } })).toBe(2);
  });
});

describe("ballot privacy boundary", () => {
  it("stores ballots with no voter, attendance, credential or time reference", async () => {
    freezeClock();
    const f = await makeElection();
    const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    await submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null });

    const cols = async (table: string) => (await db.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info("${table}")`)).map((c) => c.name.toLowerCase());
    for (const t of ["Ballot", "BallotSelection"]) {
      const names = await cols(t);
      for (const bad of ["voter", "eligible", "attendance", "credential", "token", "user", "createdat", "time", "at"]) {
        expect(names.filter((n) => n.includes(bad) && n !== "candidateid"), `${t} must not have a column like "${bad}"`).toEqual([]);
      }
    }
    const [ballot] = await db.ballot.findMany({ where: { electionId: f.election.id } });
    expect(ballot!.id).toMatch(/^[0-9a-f-]{36}$/); // random UUID, not time-ordered
  });

  it("truncates attendance and credential times to the hour", async () => {
    const clock = freezeClock();
    clock.advance(37 * 60_000 + 12_345); // 12:37:12
    const f = await makeElection();
    const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    await submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null });
    const att = await db.attendance.findFirstOrThrow({ where: { electionId: f.election.id } });
    const cred = await db.votingCredential.findFirstOrThrow({ where: { electionId: f.election.id } });
    for (const d of [att.checkedInHour, att.votedHour!, cred.consumedAt!]) expect(d.getTime() % 3_600_000).toBe(0);
  });

  it("writes nothing to the audit log while voters verify and vote", async () => {
    freezeClock();
    const f = await makeElection();
    const before = await db.auditEvent.count({ where: { electionId: f.election.id } });
    const issued = await verifyVoter({ slug: f.election.voterSlug, values: { email: "a@x.test" }, deviceId: null });
    await submitBallot({ slug: f.election.voterSlug, credential: issued.credential, selections: pick(f, f.alice.id), deviceId: null });
    // Per-ballot audit rows would be a timing side channel; administrative events only.
    expect(await db.auditEvent.count({ where: { electionId: f.election.id } })).toBe(before);
    const dump = JSON.stringify(await db.auditEvent.findMany({ where: { electionId: f.election.id } }));
    expect(dump).not.toContain(issued.credential);
    expect(dump).not.toContain("a@x.test");
  });
});

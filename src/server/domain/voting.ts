import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Election } from "@/generated/prisma/client";
import { db, isUniqueViolation } from "@/server/db";
import { env } from "@/server/env";
import { AppError, notFound } from "@/server/errors";
import { now, truncateToHour } from "@/server/clock";
import { hmacHex, randomToken } from "@/server/crypto/keys";
import { enforceLimit, getRateLimiter } from "@/server/adapters/ratelimit";
import { getRealtime } from "@/server/adapters/realtime";
import { getStorage } from "@/server/adapters/storage";
import { findByVoterSlug } from "@/server/domain/election";
import { getBallot } from "@/server/domain/ballot-config";
import { validateSelections } from "@/server/domain/rules";
import { checkAll, computeKeys, parseFields, publicFields } from "@/server/domain/verification";
import { logger } from "@/server/log";

/**
 * The voter-facing flow. Two steps, and the only link between them is a short-lived random credential:
 *
 *   1. verify  → proves the voter is on the roster (or, for open elections, passes the weak device
 *                guard), marks them "checked in", and hands back a single-use credential.
 *   2. submit  → spends the credential, marks the voter as "voted", and stores the ballot.
 *
 * Privacy boundary: the ballot is stored with a random id and NO reference to the voter, attendance
 * record or credential, and no timestamp. Attendance and credential times are truncated to the hour.
 * Steps 2's three writes happen in one transaction, so a ballot never exists without its voter being
 * marked, and the reverse. Residual correlation risks (physical row order, backups, operators with
 * database access, server logs) are listed honestly in docs/threat-model.md — they are reduced, not
 * eliminated.
 *
 * Race safety comes from compare-and-swap updates, never from check-then-write:
 *   - credential:   UPDATE ... WHERE consumedAt IS NULL AND revokedAt IS NULL AND expiresAt > now   (1 row or fail)
 *   - attendance:   UPDATE ... WHERE state = 'CHECKED_IN'                                           (1 row or fail)
 *   - open access:  INSERT device mark under a unique (election, device) key                        (conflict → fail)
 *   - election:     UPDATE ... WHERE status = 'OPEN' AND endsAt > now                               (1 row or fail)
 * If any step fails the transaction rolls back and nothing is recorded.
 */

const GENERIC_MISMATCH = "We couldn't match those details to the voter list. Check them and try again.";
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export const verifyInput = z.strictObject({ values: z.record(z.string().max(40), z.string().max(400)).refine((v) => Object.keys(v).length <= 8, "Too many fields.") });
export const submitInput = z.strictObject({
  credential: z.string().regex(TOKEN, "That voting session isn't valid. Verify again to continue."),
  selections: z
    .array(z.strictObject({ positionId: z.string().min(1).max(64), candidateIds: z.array(z.string().min(1).max(64)).max(50) }))
    .min(1)
    .max(100),
});

// ───────────────────────── public election info ─────────────────────────

async function imageUrls(ids: (string | null)[], electionId: string): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))];
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const uploads = await db.upload.findMany({ where: { id: { in: wanted }, electionId, status: "UPLOADED", kind: { in: ["BANNER", "LOGO", "CANDIDATE_IMAGE"] } } });
  await Promise.all(
    uploads.map(async (u) => {
      try { out.set(u.id, await getStorage().createReadUrl({ key: u.objectKey, contentType: u.contentType, expiresInSec: 600 })); } catch { /* image is optional */ }
    }),
  );
  return out;
}

export type VoterElectionView = Awaited<ReturnType<typeof getVoterElection>>;

/** What anyone with the voting link may see. No ballot, no counts, no roster information. */
export async function getVoterElection(slug: string) {
  const e = await findByVoterSlug(slug);
  if (!e) throw notFound("That voting link");
  const org = await db.organization.findUnique({ where: { id: e.organizationId }, select: { name: true } });
  const urls = await imageUrls([e.bannerUploadId, e.logoUploadId], e.id);
  return {
    title: e.title,
    description: e.description,
    organization: org?.name ?? "",
    status: e.status,
    open: e.status === "OPEN",
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    timezone: e.timezone,
    restricted: e.eligibilityMode === "RESTRICTED",
    fields: e.eligibilityMode === "RESTRICTED" ? publicFields(parseFields(e.verificationFields)) : [],
    bannerUrl: e.bannerUploadId ? urls.get(e.bannerUploadId) ?? null : null,
    logoUrl: e.logoUploadId ? urls.get(e.logoUploadId) ?? null : null,
    resultsSlug: e.status === "PUBLISHED" || e.resultsDisclosure === "LIVE" ? e.resultsSlug : null,
  };
}

function assertOpen(e: Election) {
  if (e.status === "OPEN" && (!e.endsAt || now() < e.endsAt)) return;
  const message =
    e.status === "DRAFT" || e.status === "SCHEDULED"
      ? e.startsAt ? "Voting hasn't started yet." : "Voting hasn't been opened yet."
      : "Voting has ended.";
  throw new AppError("ELECTION_NOT_OPEN", message);
}

async function ballotFor(e: Election) {
  const positions = await getBallot(e.id);
  const urls = await imageUrls(positions.flatMap((p) => p.candidates.map((c) => c.imageUploadId)), e.id);
  return positions.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    maxSelections: p.maxSelections,
    allowAbstain: p.allowAbstain,
    candidates: p.candidates.map((c) => ({ id: c.id, name: c.name, bio: c.bio, imageUrl: c.imageUploadId ? urls.get(c.imageUploadId) ?? null : null })),
  }));
}

// ───────────────────────── step 1: verify ─────────────────────────

export type Issued = { credential: string; expiresAt: Date; ballot: Awaited<ReturnType<typeof ballotFor>> };

const credentialHash = (electionId: string, token: string) => hmacHex("credential-token", electionId, token);

export async function verifyVoter(input: { slug: string; values: Record<string, string>; deviceId: string | null }): Promise<Issued> {
  const e = await findByVoterSlug(input.slug);
  if (!e) throw notFound("That voting link");
  assertOpen(e);
  const ttlMs = e.credentialTtlSeconds * 1000;

  if (e.eligibilityMode === "OPEN") return issueOpen(e, input.deviceId, ttlMs);

  const fields = parseFields(e.verificationFields);
  const problems = checkAll(fields, input.values);
  if (Object.keys(problems).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted details.", { fields: problems });
  const keys = computeKeys(e.id, fields, input.values);

  // Throttle guessing per *identity* (the first field, e.g. an email), whether or not that identity exists,
  // so the limit itself reveals nothing about who is on the roster.
  const failKey = `verify-fail:${keys.primaryKey.slice(0, 40)}`;
  const failOpts = { limit: env().VERIFY_FAILS_PER_IDENTITY_PER_15MIN, windowSec: 900 };
  const state = await getRateLimiter().peek(failKey, failOpts);
  if (state.count >= failOpts.limit) throw new AppError("RATE_LIMITED", "Too many attempts for those details. Wait a few minutes, then try again.", { retryAfterSec: state.retryAfterSec });

  const voter = await db.eligibleVoter.findUnique({ where: { electionId_lookupKey: { electionId: e.id, lookupKey: keys.lookupKey } }, select: { id: true } });
  if (!voter) {
    await getRateLimiter().consume(failKey, failOpts);
    throw new AppError("VERIFICATION_FAILED", GENERIC_MISMATCH);
  }

  const at = now();
  // Create-if-missing, outside the transaction below (a failed INSERT inside it would abort a Postgres transaction).
  // A racing request that wins the insert surfaces as a unique violation, which is exactly the outcome we want.
  try {
    await db.attendance.upsert({ where: { eligibleVoterId: voter.id }, create: { electionId: e.id, eligibleVoterId: voter.id, checkedInHour: truncateToHour(at) }, update: {} });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  const token = randomToken(32);
  const expiresAt = new Date(at.getTime() + ttlMs);
  await db.$transaction(async (tx) => {
    const att = await tx.attendance.findUniqueOrThrow({ where: { eligibleVoterId: voter.id } });
    if (att.state === "VOTED") throw new AppError("ALREADY_VOTED", "A ballot has already been submitted for those details.");
    // One live credential per voter: a new verification retires any earlier unused one.
    await tx.votingCredential.updateMany({ where: { attendanceId: att.id, consumedAt: null, revokedAt: null }, data: { revokedAt: truncateToHour(at) } });
    await tx.votingCredential.create({ data: { electionId: e.id, attendanceId: att.id, tokenHash: credentialHash(e.id, token), expiresAt } });
  });
  void getRealtime().publish(`election:${e.id}`, { type: "turnout.updated" }).catch(() => {});
  return { credential: token, expiresAt, ballot: await ballotFor(e) };
}

async function issueOpen(e: Election, deviceId: string | null, ttlMs: number): Promise<Issued> {
  if (!deviceId) throw new AppError("VERIFICATION_FAILED", "Your browser needs to allow cookies to vote in this election.");
  await enforceLimit(`open-issue:${hmacHex("device", e.id, deviceId).slice(0, 24)}`, { limit: env().OPEN_ISSUE_PER_IP_PER_HOUR, windowSec: 3600 }, "Too many attempts from this device. Try again later.");
  const mark = await db.openAccessMark.findUnique({ where: { electionId_deviceHash: { electionId: e.id, deviceHash: hmacHex("device", e.id, deviceId) } } });
  if (mark) throw new AppError("ALREADY_VOTED", "A ballot has already been submitted from this browser.");
  const at = now();
  const token = randomToken(32);
  const expiresAt = new Date(at.getTime() + ttlMs);
  await db.votingCredential.create({ data: { electionId: e.id, attendanceId: null, tokenHash: credentialHash(e.id, token), expiresAt } });
  return { credential: token, expiresAt, ballot: await ballotFor(e) };
}

// ───────────────────────── step 2: submit ─────────────────────────

class Rejected extends Error {
  constructor(public readonly appError: AppError) { super(appError.message); }
}

export async function submitBallot(input: { slug: string; credential: string; selections: z.infer<typeof submitInput>["selections"]; deviceId: string | null }): Promise<{ ok: true }> {
  const e = await findByVoterSlug(input.slug);
  if (!e) throw notFound("That voting link");
  assertOpen(e);

  // Validate the answers against the ballot *before* spending anything.
  const positions = await getBallot(e.id);
  const checked = validateSelections(positions, input.selections);
  if ("error" in checked) throw new AppError("BALLOT_INVALID", checked.error);

  const hash = credentialHash(e.id, input.credential);
  const deviceHash = input.deviceId ? hmacHex("device", e.id, input.deviceId) : null;
  if (e.eligibilityMode === "OPEN" && !deviceHash) throw new AppError("CREDENTIAL_INVALID", "Your browser needs to allow cookies to vote in this election.");

  try {
    await db.$transaction(async (tx) => {
      const at = now();

      // Gate: the election must still be open *at commit time*. Conditional update on the election row, so a
      // concurrent close (which updates the same row) either happens first (we fail) or waits for us.
      const gate = await tx.election.updateMany({ where: { id: e.id, status: "OPEN", OR: [{ endsAt: null }, { endsAt: { gt: at } }] }, data: { updatedAt: at } });
      if (gate.count !== 1) throw new Rejected(new AppError("ELECTION_NOT_OPEN", "Voting has ended."));

      // Single-use credential: exactly one transaction can flip consumedAt.
      const spent = await tx.votingCredential.updateMany({
        where: { tokenHash: hash, electionId: e.id, consumedAt: null, revokedAt: null, expiresAt: { gt: at } },
        data: { consumedAt: truncateToHour(at) },
      });
      if (spent.count !== 1) throw new Rejected(new AppError("CREDENTIAL_INVALID", "This voting session has expired or was already used. Verify again to continue."));

      if (e.eligibilityMode === "RESTRICTED") {
        const cred = await tx.votingCredential.findUniqueOrThrow({ where: { tokenHash: hash }, select: { attendanceId: true } });
        if (!cred.attendanceId) throw new Rejected(new AppError("CREDENTIAL_INVALID", "This voting session isn't valid."));
        // One ballot per voter even if two credentials were somehow issued: only one can move CHECKED_IN → VOTED.
        const marked = await tx.attendance.updateMany({ where: { id: cred.attendanceId, state: "CHECKED_IN" }, data: { state: "VOTED", votedHour: truncateToHour(at) } });
        if (marked.count !== 1) throw new Rejected(new AppError("ALREADY_VOTED", "A ballot has already been submitted for those details."));
      } else {
        const exists = await tx.openAccessMark.findUnique({ where: { electionId_deviceHash: { electionId: e.id, deviceHash: deviceHash! } } });
        if (exists) throw new Rejected(new AppError("ALREADY_VOTED", "A ballot has already been submitted from this browser."));
        await tx.openAccessMark.create({ data: { electionId: e.id, deviceHash: deviceHash! } });
      }

      // The ballot itself: random ids, no voter reference, no timestamp.
      const ballotId = randomUUID();
      await tx.ballot.create({ data: { id: ballotId, electionId: e.id } });
      await tx.ballotSelection.createMany({ data: checked.rows.map((r) => ({ id: randomUUID(), ballotId, positionId: r.positionId, candidateId: r.candidateId })) });
    }, { timeout: 15_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof Rejected) throw err.appError;
    // A device-mark unique violation from a concurrent request on the same browser.
    if (e.eligibilityMode === "OPEN" && err instanceof Error && /Unique constraint|P2002/i.test(err.message)) throw new AppError("ALREADY_VOTED", "A ballot has already been submitted from this browser.");
    logger.error("ballot.submit_failed", { name: err instanceof Error ? err.name : "unknown" });
    throw err;
  }

  void getRealtime().publish(`election:${e.id}`, { type: "turnout.updated" }).catch(() => {});
  void getRealtime().publish(`election:${e.id}`, { type: "results.updated" }).catch(() => {});
  return { ok: true };
}

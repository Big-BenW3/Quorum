import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, invalidState } from "@/server/errors";
import { now } from "@/server/clock";
import { requireCandidate, requirePosition } from "@/server/authz";
import { loadElection, type Actor } from "@/server/domain/election";

/**
 * Ballot builder. Every mutation runs inside a transaction that first takes a compare-and-swap
 * "lock" on the election row, succeeding only while the election is DRAFT/SCHEDULED and its start
 * time has not been reached. Once voting starts, the ballot cannot change, except for the single
 * audited exception `correctCandidateText` (typo fixes that never touch ids, counts or ballots).
 */

const title = z.string().trim().min(1, "Give this a title.").max(120);
const description = z.string().trim().max(500).nullable();

export const positionCreateInput = z.strictObject({
  title,
  description: description.optional(),
  maxSelections: z.number().int().min(1).max(20).optional(),
  seats: z.number().int().min(1).max(20).optional(),
  allowAbstain: z.boolean().optional(),
});
export const positionUpdateInput = z.strictObject({
  title: title.optional(),
  description: description.optional(),
  maxSelections: z.number().int().min(1).max(20).optional(),
  seats: z.number().int().min(1).max(20).optional(),
  allowAbstain: z.boolean().optional(),
});
export const candidateCreateInput = z.strictObject({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  bio: z.string().trim().max(1000).nullable().optional(),
  imageUploadId: z.string().min(1).nullable().optional(),
});
export const candidateUpdateInput = candidateCreateInput.partial();
export const orderInput = z.strictObject({ ids: z.array(z.string().min(1)).min(1).max(200) });
export const correctionInput = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().min(5, "Say why this is being corrected.").max(200),
});

async function withBallotLock<T>(actor: Actor, electionId: string, fn: (tx: Tx, organizationId: string) => Promise<T>): Promise<T> {
  const { election } = await loadElection(actor, electionId);
  return db.$transaction(async (tx) => {
    const at = now();
    const lock = await tx.election.updateMany({
      where: { id: electionId, status: { in: ["DRAFT", "SCHEDULED"] }, OR: [{ startsAt: null }, { startsAt: { gt: at } }] },
      data: { updatedAt: at },
    });
    if (lock.count !== 1) throw new AppError("BALLOT_FROZEN", "Voting has started, so the ballot is locked.");
    return fn(tx, election.organizationId);
  });
}

async function assertImage(tx: Tx, organizationId: string, electionId: string, uploadId: string | null | undefined) {
  if (!uploadId) return;
  const up = await tx.upload.findFirst({ where: { id: uploadId, organizationId, electionId, kind: "CANDIDATE_IMAGE", status: "UPLOADED" } });
  if (!up) throw new AppError("VALIDATION_FAILED", "That image isn't available. Upload it again.", { fields: { imageUploadId: "Upload the image again." } });
}

export async function addPosition(actor: Actor, electionId: string, input: z.infer<typeof positionCreateInput>) {
  return withBallotLock(actor, electionId, async (tx, organizationId) => {
    const count = await tx.position.count({ where: { electionId } });
    if (count >= 50) throw invalidState("An election can have at most 50 positions.");
    const last = await tx.position.findFirst({ where: { electionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const p = await tx.position.create({
      data: {
        electionId, title: input.title, description: input.description || null,
        maxSelections: input.maxSelections ?? 1, seats: input.seats ?? 1, allowAbstain: input.allowAbstain ?? true,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await audit(tx, { organizationId, electionId, actorId: actor.id, action: "ballot.position_added", targetType: "Position", targetId: p.id });
    return p;
  });
}

export async function updatePosition(actor: Actor, positionId: string, input: z.infer<typeof positionUpdateInput>) {
  const { position } = await requirePosition(actor.id, positionId);
  return withBallotLock(actor, position.electionId, async (tx, organizationId) => {
    const p = await tx.position.update({
      where: { id: positionId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.maxSelections !== undefined ? { maxSelections: input.maxSelections } : {}),
        ...(input.seats !== undefined ? { seats: input.seats } : {}),
        ...(input.allowAbstain !== undefined ? { allowAbstain: input.allowAbstain } : {}),
      },
    });
    await audit(tx, { organizationId, electionId: position.electionId, actorId: actor.id, action: "ballot.position_updated", targetType: "Position", targetId: positionId, metadata: { fields: Object.keys(input).join(",") } });
    return p;
  });
}

export async function removePosition(actor: Actor, positionId: string) {
  const { position } = await requirePosition(actor.id, positionId);
  await withBallotLock(actor, position.electionId, async (tx, organizationId) => {
    await tx.position.delete({ where: { id: positionId } });
    await audit(tx, { organizationId, electionId: position.electionId, actorId: actor.id, action: "ballot.position_removed", targetType: "Position", targetId: positionId });
  });
}

export async function reorderPositions(actor: Actor, electionId: string, ids: string[]) {
  await withBallotLock(actor, electionId, async (tx) => {
    const existing = await tx.position.findMany({ where: { electionId }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((p) => ids.includes(p.id))) throw new AppError("VALIDATION_FAILED", "The order must list every position exactly once.");
    for (const [i, id] of ids.entries()) await tx.position.update({ where: { id }, data: { sortOrder: i } });
  });
}

export async function addCandidate(actor: Actor, positionId: string, input: z.infer<typeof candidateCreateInput>) {
  const { position } = await requirePosition(actor.id, positionId);
  return withBallotLock(actor, position.electionId, async (tx, organizationId) => {
    const count = await tx.candidate.count({ where: { positionId } });
    if (count >= 100) throw invalidState("A position can have at most 100 candidates.");
    await assertImage(tx, organizationId, position.electionId, input.imageUploadId);
    const last = await tx.candidate.findFirst({ where: { positionId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    const c = await tx.candidate.create({
      data: { positionId, name: input.name, bio: input.bio || null, imageUploadId: input.imageUploadId ?? null, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    await audit(tx, { organizationId, electionId: position.electionId, actorId: actor.id, action: "ballot.candidate_added", targetType: "Candidate", targetId: c.id });
    return c;
  });
}

export async function updateCandidate(actor: Actor, candidateId: string, input: z.infer<typeof candidateUpdateInput>) {
  const { candidate, position } = await requireCandidate(actor.id, candidateId);
  return withBallotLock(actor, position.electionId, async (tx, organizationId) => {
    if (input.imageUploadId !== undefined) await assertImage(tx, organizationId, position.electionId, input.imageUploadId);
    const c = await tx.candidate.update({
      where: { id: candidate.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio || null } : {}),
        ...(input.imageUploadId !== undefined ? { imageUploadId: input.imageUploadId } : {}),
      },
    });
    await audit(tx, { organizationId, electionId: position.electionId, actorId: actor.id, action: "ballot.candidate_updated", targetType: "Candidate", targetId: candidateId, metadata: { fields: Object.keys(input).join(",") } });
    return c;
  });
}

export async function removeCandidate(actor: Actor, candidateId: string) {
  const { position } = await requireCandidate(actor.id, candidateId);
  await withBallotLock(actor, position.electionId, async (tx, organizationId) => {
    await tx.candidate.delete({ where: { id: candidateId } });
    await audit(tx, { organizationId, electionId: position.electionId, actorId: actor.id, action: "ballot.candidate_removed", targetType: "Candidate", targetId: candidateId });
  });
}

export async function reorderCandidates(actor: Actor, positionId: string, ids: string[]) {
  const { position } = await requirePosition(actor.id, positionId);
  await withBallotLock(actor, position.electionId, async (tx) => {
    const existing = await tx.candidate.findMany({ where: { positionId }, select: { id: true } });
    if (existing.length !== ids.length || !existing.every((c) => ids.includes(c.id))) throw new AppError("VALIDATION_FAILED", "The order must list every candidate exactly once.");
    for (const [i, id] of ids.entries()) await tx.candidate.update({ where: { id }, data: { sortOrder: i } });
  });
}

/**
 * The one audited exception to the ballot freeze: fix a typo in a candidate's name or biography while
 * voting is open. Candidate ids, positions and every submitted ballot are untouched.
 */
export async function correctCandidateText(actor: Actor, candidateId: string, input: z.infer<typeof correctionInput>) {
  const { candidate, position } = await requireCandidate(actor.id, candidateId);
  const { election } = await loadElection(actor, position.electionId);
  if (election.status !== "OPEN") throw invalidState("Corrections are only for elections that are open. Edit the candidate normally instead.");
  return db.$transaction(async (tx) => {
    const lock = await tx.election.updateMany({ where: { id: election.id, status: "OPEN" }, data: { updatedAt: now() } });
    if (lock.count !== 1) throw invalidState("Voting has just closed, so the ballot can no longer be corrected.");
    const c = await tx.candidate.update({
      where: { id: candidate.id },
      data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.bio !== undefined ? { bio: input.bio || null } : {}) },
    });
    await audit(tx, {
      organizationId: election.organizationId, electionId: election.id, actorId: actor.id, action: "ballot.candidate_text_corrected",
      targetType: "Candidate", targetId: candidate.id, metadata: { reason: input.reason, fields: Object.keys(input).filter((k) => k !== "reason").join(",") },
    });
    return c;
  });
}

export async function getBallot(electionId: string) {
  return db.position.findMany({
    where: { electionId },
    orderBy: { sortOrder: "asc" },
    include: { candidates: { orderBy: { sortOrder: "asc" } } },
  });
}

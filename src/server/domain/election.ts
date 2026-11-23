import "server-only";
import { z } from "zod";
import type { Election } from "@/generated/prisma/client";
import { db, Prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, invalidState, notFound } from "@/server/errors";
import { now, freezeTimeFor } from "@/server/clock";
import { randomToken } from "@/server/crypto/keys";
import { requireElection, requireOrganization, requireRole } from "@/server/authz";
import { DEFAULT_FIELDS, verificationFieldsSchema } from "@/server/domain/verification";
import { ballotProblems, scheduleProblems, TRANSITIONS, MAX_DURATION_MS, type Action } from "@/server/domain/rules";

export type Actor = { id: string };

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const timezone = z.string().max(64).refine((tz) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}, "Choose a valid time zone.");

export const createElectionInput = z.strictObject({
  title: z.string().trim().min(3, "Give the election a title of at least 3 characters.").max(120),
  description: z.string().trim().max(2000).optional(),
  timezone: timezone.default("UTC"),
  eligibilityMode: z.enum(["OPEN", "RESTRICTED"]).default("RESTRICTED"),
  verificationFields: verificationFieldsSchema.optional(),
});

export const updateElectionInput = z.strictObject({
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  timezone: timezone.optional(),
  startsAt: isoDate.nullable().optional(),
  endsAt: isoDate.nullable().optional(),
  eligibilityMode: z.enum(["OPEN", "RESTRICTED"]).optional(),
  verificationFields: verificationFieldsSchema.optional(),
  credentialTtlSeconds: z.number().int().min(120).max(3600).optional(),
  // Owner-only policy settings. Locked once voting is scheduled to open (they are configured before voting).
  resultsDisclosure: z.enum(["LIVE", "AFTER_CLOSE"]).optional(),
  autoPublish: z.boolean().optional(),
  tieRule: z.enum(["REPORT_TIE", "REQUIRE_RUNOFF"]).optional(),
  bannerUploadId: z.string().min(1).nullable().optional(),
  logoUploadId: z.string().min(1).nullable().optional(),
});
export type UpdateElectionInput = z.infer<typeof updateElectionInput>;
export type CreateElectionInput = z.infer<typeof createElectionInput>;

const OWNER_ONLY_FIELDS = ["resultsDisclosure", "autoPublish", "tieRule"] as const;

// ───────────────────────── lifecycle sync (deadline enforcement) ─────────────────────────

/**
 * Applies any time-based transition that is due: roster freeze, scheduled open, scheduled close
 * (and auto-publish). Called at every relevant read and write, so correctness never depends on a cron
 * firing on time. Every step is a compare-and-swap on the expected status, so concurrent callers
 * apply each transition at most once.
 */
export async function syncElection(electionId: string): Promise<Election> {
  const at = now();
  let e = await db.election.findUnique({ where: { id: electionId } });
  if (!e) throw notFound("That election");
  const reload = async () => (e = (await db.election.findUnique({ where: { id: electionId } }))!);

  if (!e.rosterFrozenAt && e.rosterFreezeAt && at >= e.rosterFreezeAt) {
    await db.$transaction(async (tx) => {
      const r = await tx.election.updateMany({ where: { id: electionId, rosterFrozenAt: null }, data: { rosterFrozenAt: at } });
      if (r.count) await audit(tx, { organizationId: e!.organizationId, electionId, action: "roster.frozen", targetType: "Election", targetId: electionId, metadata: { reason: "freeze_time_reached" } });
    });
    await reload();
  }

  if (e.status === "SCHEDULED" && e.startsAt && at >= e.startsAt) {
    const row = e;
    await db.$transaction(async (tx) => {
      const r = await tx.election.updateMany({ where: { id: electionId, status: "SCHEDULED" }, data: { status: "OPEN", openedAt: row.startsAt, rosterFrozenAt: row.rosterFrozenAt ?? at } });
      if (r.count) await audit(tx, { organizationId: row.organizationId, electionId, action: "election.opened", targetType: "Election", targetId: electionId, metadata: { by: "schedule" } });
    });
    await reload();
  }

  if (e.status === "OPEN" && e.endsAt && at >= e.endsAt) {
    const row = e;
    await db.$transaction(async (tx) => {
      const r = await tx.election.updateMany({ where: { id: electionId, status: "OPEN" }, data: { status: "CLOSED", closedAt: row.endsAt } });
      if (r.count) {
        await audit(tx, { organizationId: row.organizationId, electionId, action: "election.closed", targetType: "Election", targetId: electionId, metadata: { by: "schedule" } });
        if (row.autoPublish) {
          const p = await tx.election.updateMany({ where: { id: electionId, status: "CLOSED" }, data: { status: "PUBLISHED", publishedAt: at } });
          if (p.count) await audit(tx, { organizationId: row.organizationId, electionId, action: "election.published", targetType: "Election", targetId: electionId, metadata: { by: "auto_publish" } });
        }
      }
    });
    await reload();
  }
  return e;
}

/** Authorized, tenant-scoped, deadline-synced election load. The entry point for admin routes and pages. */
export async function loadElection(actor: Actor, electionId: string, min: "ADMIN" | "OWNER" = "ADMIN") {
  const scoped = await requireElection(actor.id, electionId, min);
  const election = await syncElection(electionId);
  return { election, role: scoped.role, organization: scoped.organization };
}

// ───────────────────────── create / update ─────────────────────────

export async function createElection(actor: Actor, organizationId: string, input: CreateElectionInput) {
  const { organization } = await requireOrganization(actor.id, organizationId, "ADMIN");
  return db.$transaction(async (tx) => {
    const election = await tx.election.create({
      data: {
        organizationId: organization.id,
        title: input.title,
        description: input.description || null,
        timezone: input.timezone,
        eligibilityMode: input.eligibilityMode,
        verificationFields: input.verificationFields ?? DEFAULT_FIELDS,
        voterSlug: randomToken(16),
        resultsSlug: randomToken(16),
        createdById: actor.id,
      },
    });
    await audit(tx, { organizationId: organization.id, electionId: election.id, actorId: actor.id, action: "election.created", targetType: "Election", targetId: election.id });
    return election;
  });
}

export async function updateElection(actor: Actor, electionId: string, input: UpdateElectionInput) {
  const { role } = await loadElection(actor, electionId);
  const touchesOwnerField = OWNER_ONLY_FIELDS.some((k) => input[k] !== undefined);
  if (touchesOwnerField) requireRole(role, "OWNER");

  return db.$transaction(async (tx) => {
    // Compare-and-swap "lock": fails if the election left DRAFT/SCHEDULED, and (on Postgres) takes the row lock.
    const lock = await tx.election.updateMany({ where: { id: electionId, status: { in: ["DRAFT", "SCHEDULED"] } }, data: { updatedAt: now() } });
    if (lock.count !== 1) throw new AppError("BALLOT_FROZEN", "Voting has started, so this election can no longer be edited. You can extend the end time from the election page.");
    const e = (await tx.election.findUnique({ where: { id: electionId } }))!;
    const at = now();
    const data: Prisma.ElectionUpdateInput = {};
    const changed: string[] = [];

    const voterCount = await tx.eligibleVoter.count({ where: { electionId } });

    const modeChange = input.eligibilityMode !== undefined && input.eligibilityMode !== e.eligibilityMode;
    const fieldsChange = input.verificationFields !== undefined && JSON.stringify(input.verificationFields) !== JSON.stringify(e.verificationFields);
    if (modeChange || fieldsChange) {
      if (e.rosterFrozenAt) throw new AppError("ROSTER_FROZEN", "The roster is frozen, so verification settings can't change.");
      if (voterCount > 0) throw invalidState("Remove the imported voters before changing who can vote or which fields they verify with.");
      if (modeChange) { data.eligibilityMode = input.eligibilityMode; changed.push("eligibilityMode"); }
      if (fieldsChange) { data.verificationFields = input.verificationFields as Prisma.InputJsonValue; changed.push("verificationFields"); }
    }

    for (const k of ["title", "timezone", "credentialTtlSeconds", "resultsDisclosure", "autoPublish", "tieRule", "bannerUploadId", "logoUploadId"] as const) {
      if (input[k] !== undefined && input[k] !== e[k]) { (data as Record<string, unknown>)[k] = input[k]; changed.push(k); }
    }
    if (input.description !== undefined) { data.description = input.description || null; changed.push("description"); }

    // Voting window. Re-derives the roster freeze instant and never un-freezes a frozen roster.
    const datesTouched = input.startsAt !== undefined || input.endsAt !== undefined;
    if (datesTouched) {
      const startsAt = input.startsAt === undefined ? e.startsAt : input.startsAt;
      const endsAt = input.endsAt === undefined ? e.endsAt : input.endsAt;
      if (e.status === "SCHEDULED" && (!startsAt || !endsAt)) throw invalidState("Return the election to draft before clearing its dates.");
      if (startsAt && endsAt) {
        const problems = scheduleProblems({ startsAt, endsAt, now: at, restricted: (data.eligibilityMode ?? e.eligibilityMode) === "RESTRICTED", voterCount });
        if (problems.length) throw new AppError("VALIDATION_FAILED", problems[0]!, { fields: { startsAt: problems.join(" ") } });
      } else if (startsAt && !endsAt && startsAt.getTime() <= at.getTime()) {
        throw new AppError("VALIDATION_FAILED", "Voting must start in the future.", { fields: { startsAt: "Voting must start in the future." } });
      } else if (startsAt && endsAt && endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS) {
        throw new AppError("VALIDATION_FAILED", "Voting can stay open for at most 90 days.");
      }
      data.startsAt = startsAt;
      data.endsAt = endsAt;
      data.rosterFreezeAt = startsAt ? freezeTimeFor(startsAt) : null;
      if (!e.rosterFrozenAt && data.rosterFreezeAt && (data.rosterFreezeAt as Date) <= at) data.rosterFrozenAt = at;
      changed.push("startsAt", "endsAt");
    }

    if (changed.length === 0) return e;
    const updated = await tx.election.update({ where: { id: electionId }, data });
    const rescheduled = e.status === "SCHEDULED" && datesTouched;
    await audit(tx, {
      organizationId: e.organizationId, electionId, actorId: actor.id,
      action: rescheduled ? "election.rescheduled" : "election.updated", targetType: "Election", targetId: electionId,
      metadata: { fields: changed.join(","), froze_roster: Boolean(data.rosterFrozenAt) },
    });
    if (data.rosterFrozenAt) await audit(tx, { organizationId: e.organizationId, electionId, actorId: actor.id, action: "roster.frozen", targetType: "Election", targetId: electionId, metadata: { reason: "start_within_24h" } });
    return updated;
  });
}

// ───────────────────────── lifecycle actions ─────────────────────────

async function readiness(tx: Prisma.TransactionClient, e: Election, at: Date, opts: { endsAt?: Date | null } = {}) {
  const positions = await tx.position.findMany({
    where: { electionId: e.id },
    orderBy: { sortOrder: "asc" },
    include: { candidates: { select: { id: true, name: true } } },
  });
  const voterCount = e.eligibilityMode === "RESTRICTED" ? await tx.eligibleVoter.count({ where: { electionId: e.id } }) : 0;
  const problems = ballotProblems(positions).map((p) => p.message);
  if (e.eligibilityMode === "RESTRICTED" && voterCount === 0) problems.push("Import at least one eligible voter, or switch to open access.");
  return { problems, voterCount, endsAt: opts.endsAt ?? e.endsAt, at };
}

export async function transitionElection(actor: Actor, electionId: string, action: Action, input: { endsAt?: Date | null } = {}) {
  const { election: e0, role } = await loadElection(actor, electionId, action === "publish" ? "OWNER" : "ADMIN");
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(e0.status)) throw invalidState(`This election is ${e0.status.toLowerCase()}, so it can't be ${verb(action)} right now.`);
  void role;

  return db.$transaction(async (tx) => {
    const e = (await tx.election.findUnique({ where: { id: electionId } }))!;
    const at = now();
    const data: Prisma.ElectionUpdateInput = { status: rule.to };
    let auditAction: Parameters<typeof audit>[1]["action"];
    const meta: Record<string, unknown> = {};

    if (action === "schedule" || action === "open") {
      const r = await readiness(tx, e, at, input);
      const endsAt = r.endsAt;
      const problems = [...r.problems];
      if (action === "schedule") {
        problems.push(...scheduleProblems({ startsAt: e.startsAt, endsAt: e.endsAt, now: at, restricted: e.eligibilityMode === "RESTRICTED", voterCount: r.voterCount }));
      } else {
        if (!endsAt) problems.push("Choose when voting ends.");
        else if (endsAt.getTime() < at.getTime() + 10 * 60_000) problems.push("Voting must stay open for at least 10 minutes.");
        else if (endsAt.getTime() - at.getTime() > MAX_DURATION_MS) problems.push("Voting can stay open for at most 90 days.");
      }
      if (problems.length) throw new AppError("INVALID_STATE", "This election isn't ready yet.", { fields: { problems: problems.join("\n") }, problems });
      if (action === "schedule") {
        data.rosterFreezeAt = freezeTimeFor(e.startsAt!);
        if (data.rosterFreezeAt <= at) data.rosterFrozenAt = e.rosterFrozenAt ?? at;
        auditAction = "election.scheduled";
      } else {
        data.startsAt = at;
        data.endsAt = endsAt;
        data.openedAt = at;
        data.rosterFreezeAt = e.rosterFreezeAt && e.rosterFreezeAt < at ? e.rosterFreezeAt : at;
        data.rosterFrozenAt = e.rosterFrozenAt ?? at;
        auditAction = "election.opened";
        meta.by = "manual";
      }
    } else if (action === "unschedule") {
      if (e.rosterFrozenAt || (e.startsAt && at >= e.startsAt)) throw invalidState("The roster is already frozen, so this election can't go back to draft. Change its dates instead.");
      auditAction = "election.unscheduled";
    } else if (action === "close") {
      data.closedAt = at;
      if (e.endsAt && e.endsAt > at) data.endsAt = at;
      auditAction = "election.closed";
      meta.by = "manual";
    } else {
      data.publishedAt = at;
      auditAction = "election.published";
    }

    // Compare-and-swap on the expected status: concurrent or repeated requests change state at most once.
    const cas = await tx.election.updateMany({ where: { id: electionId, status: { in: rule.from } }, data: data as Prisma.ElectionUpdateManyMutationInput });
    if (cas.count !== 1) throw invalidState("Someone else changed this election at the same moment. Refresh and try again.");
    await audit(tx, { organizationId: e.organizationId, electionId, actorId: actor.id, action: auditAction, targetType: "Election", targetId: electionId, metadata: meta });

    if (action === "close" && e.autoPublish) {
      const p = await tx.election.updateMany({ where: { id: electionId, status: "CLOSED" }, data: { status: "PUBLISHED", publishedAt: at } });
      if (p.count) await audit(tx, { organizationId: e.organizationId, electionId, actorId: actor.id, action: "election.published", targetType: "Election", targetId: electionId, metadata: { by: "auto_publish" } });
    }
    return (await tx.election.findUnique({ where: { id: electionId } }))!;
  });
}

const verb = (a: Action) => ({ schedule: "scheduled", unschedule: "returned to draft", open: "opened", close: "closed", publish: "published" })[a];

/** Extend (never shorten) the end time of a running election. An explicit, audited exception to "configuration is frozen". */
export async function extendVoting(actor: Actor, electionId: string, newEndsAt: Date) {
  const { election: e0 } = await loadElection(actor, electionId);
  if (e0.status !== "OPEN") throw invalidState("Only an open election can be extended.");
  return db.$transaction(async (tx) => {
    const e = (await tx.election.findUnique({ where: { id: electionId } }))!;
    if (!e.endsAt || newEndsAt <= e.endsAt) throw new AppError("VALIDATION_FAILED", "The new end time must be later than the current one.", { fields: { endsAt: "Choose a later time." } });
    if (e.startsAt && newEndsAt.getTime() - e.startsAt.getTime() > MAX_DURATION_MS) throw new AppError("VALIDATION_FAILED", "Voting can stay open for at most 90 days.");
    const cas = await tx.election.updateMany({ where: { id: electionId, status: "OPEN", endsAt: e.endsAt }, data: { endsAt: newEndsAt } });
    if (cas.count !== 1) throw invalidState("The election changed while you were editing it. Refresh and try again.");
    await audit(tx, { organizationId: e.organizationId, electionId, actorId: actor.id, action: "election.extended", targetType: "Election", targetId: electionId, metadata: { from: e.endsAt.toISOString(), to: newEndsAt.toISOString() } });
    return (await tx.election.findUnique({ where: { id: electionId } }))!;
  });
}

export async function rotateLinks(actor: Actor, electionId: string, which: "voter" | "results" | "both") {
  const { election } = await loadElection(actor, electionId, "OWNER");
  if (election.status === "CLOSED" || election.status === "PUBLISHED") throw invalidState("Links can't be rotated after voting has closed.");
  return db.$transaction(async (tx) => {
    const updated = await tx.election.update({
      where: { id: electionId },
      data: { ...(which !== "results" ? { voterSlug: randomToken(16) } : {}), ...(which !== "voter" ? { resultsSlug: randomToken(16) } : {}) },
    });
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "election.links_rotated", targetType: "Election", targetId: electionId, metadata: { which } });
    return updated;
  });
}

export async function deleteDraftElection(actor: Actor, electionId: string) {
  const { election } = await loadElection(actor, electionId);
  if (election.status !== "DRAFT") throw invalidState("Only a draft election can be deleted.");
  return db.$transaction(async (tx) => {
    const ballots = await tx.ballot.count({ where: { electionId } });
    if (ballots > 0) throw invalidState("This election already has ballots and can't be deleted.");
    // Uploads have no foreign key to the election (assets are independently purgeable), so hand their ids back
    // and let the caller delete the stored objects; otherwise images and roster files would be orphaned.
    const uploads = await tx.upload.findMany({ where: { electionId, status: { not: "DELETED" } }, select: { id: true } });
    await tx.election.delete({ where: { id: electionId } });
    await audit(tx, { organizationId: election.organizationId, actorId: actor.id, action: "election.deleted", targetType: "Election", targetId: electionId });
    return { uploadIds: uploads.map((u) => u.id) };
  });
}

// ───────────────────────── public lookups ─────────────────────────

export async function findByVoterSlug(slug: string): Promise<Election | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return null;
  const e = await db.election.findUnique({ where: { voterSlug: slug }, select: { id: true } });
  return e ? syncElection(e.id) : null;
}

export async function findByResultsSlug(slug: string): Promise<Election | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) return null;
  const e = await db.election.findUnique({ where: { resultsSlug: slug }, select: { id: true } });
  return e ? syncElection(e.id) : null;
}

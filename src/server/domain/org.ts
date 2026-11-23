import "server-only";
import { z } from "zod";
import { db, isUniqueViolation } from "@/server/db";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { AppError, forbidden, invalidState, notFound } from "@/server/errors";
import { now } from "@/server/clock";
import { hmacHex, randomToken } from "@/server/crypto/keys";
import { requireOrganization } from "@/server/authz";
import { mailIsConfigured, sendMail } from "@/server/adapters/mailer";
import type { Actor } from "@/server/domain/election";

/** Organizations are the tenant boundary. Every other object is reached through a membership in one. */

export const createOrgInput = z.strictObject({
  name: z.string().trim().min(2, "Give the organization a name.").max(80),
  description: z.string().trim().max(300).optional(),
});
export const inviteInput = z.strictObject({
  email: z.email("Enter a valid email address.").max(200).optional(),
  role: z.enum(["ADMIN", "OWNER"]).default("ADMIN"),
});

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "org";

export async function createOrganization(actor: Actor, input: z.infer<typeof createOrgInput>) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = `${slugify(input.name)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
    try {
      return await db.$transaction(async (tx) => {
        const org = await tx.organization.create({ data: { name: input.name, slug, description: input.description || null } });
        await tx.membership.create({ data: { organizationId: org.id, userId: actor.id, role: "OWNER" } });
        await audit(tx, { organizationId: org.id, actorId: actor.id, action: "org.created", targetType: "Organization", targetId: org.id });
        return org;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new AppError("CONFLICT", "We couldn't create that organization. Try again.");
}

export async function listOrganizations(actor: Actor) {
  const rows = await db.membership.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "asc" },
    include: { organization: { include: { _count: { select: { elections: true, memberships: true } } } } },
  });
  return rows.map((m) => ({ id: m.organization.id, slug: m.organization.slug, name: m.organization.name, role: m.role, elections: m.organization._count.elections, members: m.organization._count.memberships }));
}

export async function getOrganization(actor: Actor, organizationId: string) {
  const { organization, role } = await requireOrganization(actor.id, organizationId);
  const [elections, members, invites] = await Promise.all([
    db.election.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true, eligibilityMode: true, startsAt: true, endsAt: true, createdAt: true, _count: { select: { voters: true, ballots: true } } },
    }),
    db.membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, email: true } } } }),
    role === "OWNER" ? db.invitation.findMany({ where: { organizationId, acceptedAt: null, expiresAt: { gt: now() } }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  return {
    organization: { id: organization.id, slug: organization.slug, name: organization.name, description: organization.description },
    role,
    elections: elections.map((e) => ({ id: e.id, title: e.title, status: e.status, restricted: e.eligibilityMode === "RESTRICTED", startsAt: e.startsAt, endsAt: e.endsAt, voters: e._count.voters, ballots: e._count.ballots })),
    members: members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role, you: m.user.id === actor.id })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
  };
}

// ───────────────────────── invitations ─────────────────────────

const INVITE_TTL_MS = 7 * 24 * 3_600_000;

/** Owner only. The link is shown once; only a keyed hash is stored. Email is optional and best-effort. */
export async function createInvite(actor: Actor, organizationId: string, input: z.infer<typeof inviteInput>) {
  const { organization } = await requireOrganization(actor.id, organizationId, "OWNER");
  const token = randomToken(32);
  const invite = await db.$transaction(async (tx) => {
    const inv = await tx.invitation.create({
      data: { organizationId, email: input.email?.toLowerCase() ?? null, role: input.role, tokenHash: hmacHex("invite-token", token), expiresAt: new Date(now().getTime() + INVITE_TTL_MS), createdById: actor.id },
    });
    await audit(tx, { organizationId, actorId: actor.id, action: "member.invited", targetType: "Invitation", targetId: inv.id, metadata: { role: input.role } });
    return inv;
  });
  const link = `${env().APP_URL.replace(/\/$/, "")}/invite/${token}`;
  let emailed = false;
  if (input.email && mailIsConfigured()) {
    try {
      await sendMail({ to: input.email, subject: `You're invited to ${organization.name} on ${env().APP_NAME}`, text: `You've been invited to help run elections for ${organization.name}.\n\nAccept the invitation:\n${link}\n\nThe link expires in 7 days.` });
      emailed = true;
    } catch { /* the link is still returned to the inviter */ }
  }
  return { id: invite.id, link, expiresAt: invite.expiresAt, emailed };
}

export async function revokeInvite(actor: Actor, organizationId: string, inviteId: string) {
  await requireOrganization(actor.id, organizationId, "OWNER");
  const r = await db.invitation.deleteMany({ where: { id: inviteId, organizationId, acceptedAt: null } });
  if (r.count !== 1) throw notFound("That invitation");
}

export async function acceptInvite(user: { id: string; email: string }, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound("That invitation");
  const hash = hmacHex("invite-token", token);
  const inv = await db.invitation.findUnique({ where: { tokenHash: hash } });
  if (!inv || inv.acceptedAt || inv.expiresAt <= now()) throw new AppError("NOT_FOUND", "This invitation has expired or was already used. Ask the owner for a new one.");
  if (inv.email && inv.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden("This invitation was sent to a different email address. Sign in with that address to accept it.");
  return db.$transaction(async (tx) => {
    const claim = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, expiresAt: { gt: now() } }, data: { acceptedAt: now() } });
    if (claim.count !== 1) throw invalidState("This invitation was just used.");
    const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: inv.organizationId, userId: user.id } } });
    if (!existing) await tx.membership.create({ data: { organizationId: inv.organizationId, userId: user.id, role: inv.role } });
    await audit(tx, { organizationId: inv.organizationId, actorId: user.id, action: "member.joined", targetType: "Invitation", targetId: inv.id });
    return { organizationId: inv.organizationId };
  });
}

/** Owners remove anyone; anyone may leave. The last owner can never be removed. */
export async function removeMember(actor: Actor, organizationId: string, userId: string) {
  const { role } = await requireOrganization(actor.id, organizationId);
  if (userId !== actor.id && role !== "OWNER") throw forbidden("Only an organization owner can remove members.");
  await db.$transaction(async (tx) => {
    const target = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!target) throw notFound("That member");
    if (target.role === "OWNER") {
      const owners = await tx.membership.count({ where: { organizationId, role: "OWNER" } });
      if (owners <= 1) throw invalidState("An organization needs at least one owner. Make someone else an owner first.");
    }
    await tx.membership.delete({ where: { id: target.id } });
    await audit(tx, { organizationId, actorId: actor.id, action: "member.removed", targetType: "User", targetId: userId });
  });
}

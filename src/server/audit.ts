import "server-only";
import type { DbLike } from "@/server/db";

/**
 * Administrative audit trail. Records who did what to which object and when.
 * It must never contain ballot selections, tokens, credentials or roster values, so metadata is
 * restricted to short primitive values under non-sensitive keys.
 */

export type AuditAction =
  | "org.created"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "election.created"
  | "election.updated"
  | "election.rescheduled"
  | "election.scheduled"
  | "election.unscheduled"
  | "election.opened"
  | "election.closed"
  | "election.extended"
  | "election.published"
  | "election.deleted"
  | "election.links_rotated"
  | "ballot.position_added"
  | "ballot.position_updated"
  | "ballot.position_removed"
  | "ballot.candidate_added"
  | "ballot.candidate_updated"
  | "ballot.candidate_removed"
  | "ballot.candidate_text_corrected"
  | "roster.upload_requested"
  | "roster.upload_finalized"
  | "roster.parse_started"
  | "roster.parse_completed"
  | "roster.parse_failed"
  | "roster.row_corrected"
  | "roster.row_resolved"
  | "roster.mapping_saved"
  | "roster.import_confirmed"
  | "roster.import_rejected"
  | "roster.voter_removed"
  | "roster.frozen"
  | "report.downloaded"
  | "system.sweep";

const BLOCKED_KEYS = /token|secret|password|selection|candidate_id|choice|vote|ballot|lookup|label|email|value|payload|credential|pin/i;

export type AuditMetadata = Record<string, string | number | boolean | null>;

export function sanitizeMetadata(meta: Record<string, unknown> | undefined): AuditMetadata | undefined {
  if (!meta) return undefined;
  const out: AuditMetadata = {};
  for (const [k, v] of Object.entries(meta).slice(0, 12)) {
    if (BLOCKED_KEYS.test(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 160);
  }
  return Object.keys(out).length ? out : undefined;
}

export async function audit(
  tx: DbLike,
  e: {
    organizationId: string;
    electionId?: string | null;
    actorId?: string | null;
    actorType?: "USER" | "SYSTEM";
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.auditEvent.create({
    data: {
      organizationId: e.organizationId,
      electionId: e.electionId ?? null,
      actorId: e.actorId ?? null,
      actorType: e.actorType ?? (e.actorId ? "USER" : "SYSTEM"),
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      metadata: sanitizeMetadata(e.metadata) ?? undefined,
    },
  });
}

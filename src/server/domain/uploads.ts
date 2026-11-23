import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Upload, UploadKind } from "@/generated/prisma/client";
import { db, type DbLike } from "@/server/db";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { AppError, notFound } from "@/server/errors";
import { now } from "@/server/clock";
import { randomToken } from "@/server/crypto/keys";
import { getStorage } from "@/server/adapters/storage";
import { logger } from "@/server/log";
import { loadElection, type Actor } from "@/server/domain/election";

/**
 * Upload hygiene shared by roster files and images. Treat every uploaded byte as hostile:
 * the claimed type, the file extension and the leading magic bytes must all agree, size is bounded
 * both when the target is issued (declared) and when the upload is finalized (actual), and the name
 * is sanitised before it is ever stored or displayed.
 */

export type SourceKind = "csv" | "pdf" | "docx" | "png" | "jpeg";

const TYPES: Record<SourceKind, { mimes: string[]; exts: string[]; mime: string }> = {
  csv: { mimes: ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"], exts: ["csv"], mime: "text/csv" },
  pdf: { mimes: ["application/pdf"], exts: ["pdf"], mime: "application/pdf" },
  docx: { mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], exts: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  png: { mimes: ["image/png"], exts: ["png"], mime: "image/png" },
  jpeg: { mimes: ["image/jpeg"], exts: ["jpg", "jpeg"], mime: "image/jpeg" },
};

export function classifyFile(filename: string, contentType: string): SourceKind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  for (const [kind, t] of Object.entries(TYPES) as [SourceKind, (typeof TYPES)[SourceKind]][]) {
    if (t.exts.includes(ext) && t.mimes.includes(mime)) return kind;
  }
  return null;
}
export const mimeFor = (kind: SourceKind) => TYPES[kind].mime;

const startsWith = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Content sniffing: does the data really look like what it claims to be? */
export function sniff(kind: SourceKind, bytes: Buffer): boolean {
  switch (kind) {
    case "pdf": return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "docx": return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "png": return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg": return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "csv": return decodeText(bytes) !== null;
  }
}

/** Strict UTF-8 text decode; rejects binary data and NUL bytes. Strips a BOM. */
export function decodeText(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKC").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 120);
}

export const uploadRequestInput = z.strictObject({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});
export const assetRequestInput = uploadRequestInput.extend({ kind: z.enum(["BANNER", "LOGO", "CANDIDATE_IMAGE"]) });

const PENDING_TTL_MS = 15 * 60_000;

export async function createUploadRecord(tx: DbLike, i: { organizationId: string; electionId: string | null; kind: UploadKind; filename: string; contentType: string; size: number; actorId: string }) {
  const key = `uploads/${i.organizationId}/${i.electionId ?? "org"}/${randomToken(18)}`;
  return tx.upload.create({
    data: {
      organizationId: i.organizationId, electionId: i.electionId, kind: i.kind, objectKey: key,
      filename: sanitizeFilename(i.filename), contentType: i.contentType, declaredSize: i.size,
      createdById: i.actorId, expiresAt: new Date(now().getTime() + PENDING_TTL_MS),
    },
  });
}

export async function issueUploadTarget(u: Upload) {
  return getStorage().createUploadTarget({ key: u.objectKey, contentType: u.contentType, size: u.declaredSize, expiresInSec: Math.max(60, Math.floor((u.expiresAt.getTime() - now().getTime()) / 1000)) });
}

/** Verifies the uploaded object (size + magic bytes), records its hash, and marks it UPLOADED or REJECTED. */
export async function finalizeUpload(upload: Upload, kind: SourceKind, maxBytes: number): Promise<Upload> {
  if (upload.status === "UPLOADED") return upload;
  if (upload.status !== "PENDING") throw new AppError("INVALID_STATE", "This upload can no longer be finalized. Start a new upload.");
  const storage = getStorage();
  const reject = async (message: string) => {
    await storage.delete(upload.objectKey).catch(() => {});
    await db.upload.update({ where: { id: upload.id }, data: { status: "REJECTED", deletedAt: now() } });
    throw new AppError("VALIDATION_FAILED", message);
  };
  if (upload.expiresAt <= now()) return reject("The upload window expired. Start again.");
  const s = await storage.stat(upload.objectKey);
  if (!s) throw new AppError("INVALID_STATE", "We haven't received the file yet. Upload it first, then finalize.");
  if (s.size > maxBytes || s.size > upload.declaredSize) return reject("That file is larger than allowed.");
  const bytes = await storage.read(upload.objectKey, maxBytes);
  if (!sniff(kind, bytes)) return reject("That file's contents don't match its type.");
  return db.upload.update({ where: { id: upload.id }, data: { status: "UPLOADED", actualSize: s.size, sha256: createHash("sha256").update(bytes).digest("hex") } });
}

export async function deleteUploadObject(uploadId: string) {
  const u = await db.upload.findUnique({ where: { id: uploadId } });
  if (!u || u.status === "DELETED") return;
  try {
    await getStorage().delete(u.objectKey);
    await db.upload.update({ where: { id: uploadId }, data: { status: "DELETED", deletedAt: now() } });
  } catch (e) {
    // Retried by the sweeper; never blocks the user-facing operation.
    logger.warn("upload.delete_failed", { uploadId, name: e instanceof Error ? e.name : "unknown" });
  }
}

// ───────────── images (banner, logo, candidate photos) ─────────────

export async function requestAssetUpload(actor: Actor, electionId: string, input: z.infer<typeof assetRequestInput>) {
  const { election } = await loadElection(actor, electionId);
  if (election.status !== "DRAFT" && election.status !== "SCHEDULED") throw new AppError("BALLOT_FROZEN", "Voting has started, so images can no longer be added.");
  const kind = classifyFile(input.filename, input.contentType);
  if (kind !== "png" && kind !== "jpeg") throw new AppError("VALIDATION_FAILED", "Images must be PNG or JPEG.", { fields: { contentType: "Use a PNG or JPEG image." } });
  if (input.size > env().MAX_IMAGE_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", `Images can be at most ${Math.floor(env().MAX_IMAGE_BYTES / 1_000_000)} MB.`);
  const upload = await createUploadRecord(db, { organizationId: election.organizationId, electionId, kind: input.kind, filename: input.filename, contentType: mimeFor(kind), size: input.size, actorId: actor.id });
  return { uploadId: upload.id, upload: await issueUploadTarget(upload) };
}

export async function finalizeAssetUpload(actor: Actor, electionId: string, uploadId: string) {
  const { election } = await loadElection(actor, electionId);
  const upload = await db.upload.findFirst({ where: { id: uploadId, electionId, organizationId: election.organizationId, kind: { in: ["BANNER", "LOGO", "CANDIDATE_IMAGE"] } } });
  if (!upload) throw notFound("That upload");
  const kind = classifyFile(upload.filename, upload.contentType)!;
  const done = await finalizeUpload(upload, kind, env().MAX_IMAGE_BYTES);
  return { uploadId: done.id, status: done.status };
}

/** Short-lived signed URL for rendering an image the election owns. Never a permanent public URL. */
export async function signedImageUrl(uploadId: string | null | undefined, electionId: string): Promise<string | null> {
  if (!uploadId) return null;
  const u = await db.upload.findFirst({ where: { id: uploadId, electionId, status: "UPLOADED", kind: { in: ["BANNER", "LOGO", "CANDIDATE_IMAGE"] } } });
  if (!u) return null;
  try { return await getStorage().createReadUrl({ key: u.objectKey, contentType: u.contentType, expiresInSec: 600 }); } catch { return null; }
}

export const newIdempotencyKey = () => randomUUID();
export { audit };

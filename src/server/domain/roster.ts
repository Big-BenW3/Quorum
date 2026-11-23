import "server-only";
import Papa from "papaparse";
import { z } from "zod";
import type { Election, Prisma as PrismaNS, RosterImport, RowStatus } from "@/generated/prisma/client";
import { db, Prisma, type Tx } from "@/server/db";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { AppError, invalidState, notFound } from "@/server/errors";
import { now } from "@/server/clock";
import { open, seal } from "@/server/crypto/keys";
import { requireImport } from "@/server/authz";
import { getStorage } from "@/server/adapters/storage";
import { getExtractor } from "@/server/adapters/ocr";
import { getJobQueue, registerJob } from "@/server/adapters/jobs";
import { loadElection, type Actor } from "@/server/domain/election";
import { isRosterFrozen } from "@/server/domain/rules";
import { checkAll, computeKeys, parseFields, type VerificationField } from "@/server/domain/verification";
import { classifyFile, createUploadRecord, decodeText, deleteUploadObject, finalizeUpload, issueUploadTarget, mimeFor, sanitizeFilename, type SourceKind } from "@/server/domain/uploads";
import { logger } from "@/server/log";

/**
 * Roster ingestion: upload → parse/OCR → map columns → review & correct → resolve duplicates → confirm.
 * See docs/roster-ingestion.md. Key properties enforced here:
 *   - nothing reaches the roster without an explicit administrator confirmation;
 *   - staged row values are AES-GCM sealed, never logged, and wiped on confirm/reject;
 *   - exact duplicates are skipped and listed; look-alike rows are flagged AMBIGUOUS and need a human
 *     decision. No fuzzy matching, no silent merging;
 *   - the freeze cutoff is enforced inside the same transaction as every roster write.
 */

type Cells = Record<string, string>;
export type Mapping = Record<string, string>;
const LABEL = "__label";
const GROUP = "__group";
const MAX_COLUMNS = 40;
const REVIEW_PAGE = 50;

export const mappingInput = z.strictObject({ mapping: z.record(z.string().max(40), z.string().max(120)).refine((m) => Object.keys(m).length <= 8, "Too many mappings.") });
export const rowCorrectionInput = z.strictObject({ cells: z.record(z.string().max(120), z.string().max(400)).refine((c) => Object.keys(c).length <= MAX_COLUMNS) });
export const rowResolveInput = z.strictObject({ action: z.enum(["KEEP", "SKIP", "CLEAR"]) });
export const manualImportInput = z.strictObject({ csv: z.string().min(1).max(1_000_000) });
export const addRowInput = z.strictObject({ cells: z.record(z.string().max(120), z.string().max(400)) });

// ───────────────────────── guards ─────────────────────────

function assertRestricted(e: Election) {
  if (e.eligibilityMode !== "RESTRICTED") throw invalidState("This election is open to anyone, so it has no roster.");
}
function assertNotFrozen(e: Election) {
  if (isRosterFrozen(e, now())) throw new AppError("ROSTER_FROZEN", "The roster is frozen (it locks 24 hours before voting starts), so voters can no longer be added or changed.");
}
/** Takes the compare-and-swap "lock" for roster writes: succeeds only while the roster is still editable. */
async function lockRoster(tx: Tx, electionId: string) {
  const at = now();
  const r = await tx.election.updateMany({
    where: { id: electionId, eligibilityMode: "RESTRICTED", status: { in: ["DRAFT", "SCHEDULED"] }, rosterFrozenAt: null, OR: [{ rosterFreezeAt: null }, { rosterFreezeAt: { gt: at } }] },
    data: { updatedAt: at },
  });
  if (r.count !== 1) throw new AppError("ROSTER_FROZEN", "The roster is frozen (it locks 24 hours before voting starts), so voters can no longer be added or changed.");
}

// ───────────────────────── mapping & evaluation ─────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const SYNONYMS: Record<string, string[]> = {
  email: ["email", "emailaddress", "mail", "emailid"],
  id: ["id", "regno", "registration", "registrationnumber", "matric", "matricno", "studentid", "studentno", "memberid", "number"],
  pin: ["pin", "code", "passcode", "accesscode"],
  name: ["name", "fullname", "membername", "studentname"],
  group: ["department", "dept", "faculty", "group", "class", "level", "unit", "team", "chapter", "year"],
};

export function suggestMapping(columns: string[], fields: VerificationField[]): Mapping {
  const used = new Set<string>();
  const find = (cands: string[]) => columns.find((c) => !used.has(c) && cands.includes(norm(c)));
  const out: Mapping = {};
  for (const f of fields) {
    const hit = find([norm(f.key), norm(f.label), ...(SYNONYMS[f.kind === "email" ? "email" : f.kind === "id" ? "id" : f.kind === "pin" ? "pin" : "name"] ?? [])]);
    if (hit) { out[f.key] = hit; used.add(hit); }
  }
  const label = columns.find((c) => SYNONYMS.name!.includes(norm(c)));
  if (label) out[LABEL] = label;
  const group = columns.find((c) => SYNONYMS.group!.includes(norm(c)));
  if (group) out[GROUP] = group;
  return out;
}

function validateMapping(mapping: Mapping, columns: string[], fields: VerificationField[]) {
  const targets = new Set([...fields.map((f) => f.key), LABEL, GROUP]);
  for (const [t, src] of Object.entries(mapping)) {
    if (!targets.has(t)) throw new AppError("VALIDATION_FAILED", "That mapping target doesn't exist.", { fields: { [t]: "Unknown field." } });
    if (!columns.includes(src)) throw new AppError("VALIDATION_FAILED", "That column isn't in the file.", { fields: { [t]: "Choose one of the file's columns." } });
  }
  const missing = fields.filter((f) => !mapping[f.key]);
  if (missing.length) throw new AppError("VALIDATION_FAILED", `Map a column for: ${missing.map((m) => m.label).join(", ")}.`, { fields: Object.fromEntries(missing.map((m) => [m.key, "Required."])) });
}

function maskLabel(first: string): string {
  const v = first.trim();
  if (!v) return "Voter";
  const at = v.indexOf("@");
  if (at > 0) return `${v[0]}***${v.slice(at)}`;
  return `${v.slice(0, 2)}***`;
}

type EvalInput = { id: string; rowIndex: number; cells: Cells; resolution: string | null; confidence: number | null };
type EvalOutput = { id: string; status: RowStatus; issues: string[]; lookupKey?: string; primaryKey?: string; label?: string; group?: string | null };

/** Pure: classify every staged row. `existing` are the lookup/primary keys already on the roster. */
export function evaluateRows(
  rows: EvalInput[], mapping: Mapping, fields: VerificationField[], electionId: string,
  existing: { lookupKeys: Set<string>; primary: Map<string, Set<string>> },
): EvalOutput[] {
  const outs = new Map<string, EvalOutput>();
  const valid: { row: EvalInput; lookupKey: string; primaryKey: string }[] = [];

  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const f of fields) values[f.key] = mapping[f.key] ? row.cells[mapping[f.key]!] ?? "" : "";
    const errs = checkAll(fields, values);
    const issues: string[] = [];
    if (Object.keys(errs).length) {
      for (const f of fields) if (errs[f.key]) issues.push(`${String(values[f.key] ?? "").trim() ? "invalid" : "missing"}:${f.key}`);
      outs.set(row.id, { id: row.id, status: "ERROR", issues });
      continue;
    }
    const keys = computeKeys(electionId, fields, values);
    const rawLabel = mapping[LABEL] ? (row.cells[mapping[LABEL]!] ?? "").trim() : "";
    if (!rawLabel) issues.push("label:missing");
    if (row.confidence !== null && row.confidence < 0.8) issues.push("confidence:low");
    const group = mapping[GROUP] ? (row.cells[mapping[GROUP]!] ?? "").trim().slice(0, 60) || null : null;
    outs.set(row.id, { id: row.id, status: issues.length ? "WARNING" : "OK", issues, ...keys, label: rawLabel || maskLabel(String(values[fields[0]!.key])), group });
    valid.push({ row, ...keys });
  }

  // Index valid rows (file) and the existing roster by primary key.
  const filePrimary = new Map<string, Set<string>>();
  const seenLookup = new Map<string, number>();
  for (const v of valid) {
    (filePrimary.get(v.primaryKey) ?? filePrimary.set(v.primaryKey, new Set()).get(v.primaryKey)!).add(v.lookupKey);
  }
  for (const v of valid) {
    const out = outs.get(v.row.id)!;
    let status: RowStatus = out.status;
    if (existing.lookupKeys.has(v.lookupKey)) { out.issues.push("duplicate:roster"); status = "DUPLICATE"; }
    else if (seenLookup.has(v.lookupKey)) { out.issues.push("duplicate:file"); status = "DUPLICATE"; }
    else {
      seenLookup.set(v.lookupKey, v.row.rowIndex);
      const all = new Set([...(filePrimary.get(v.primaryKey) ?? []), ...(existing.primary.get(v.primaryKey) ?? [])]);
      if (all.size > 1) {
        out.issues.push(existing.primary.has(v.primaryKey) && !existing.lookupKeys.has(v.lookupKey) ? "ambiguous:roster" : "ambiguous:file");
        status = "AMBIGUOUS";
      }
    }
    out.status = status;
  }
  // Explicit administrator decisions.
  for (const row of rows) {
    const out = outs.get(row.id)!;
    if (row.resolution === "SKIP") out.status = "SKIPPED";
  }
  return [...outs.values()];
}

const importable = (status: RowStatus, resolution: string | null) => status === "OK" || status === "WARNING" || (status === "AMBIGUOUS" && resolution === "KEEP");

async function existingKeys(tx: Tx, electionId: string) {
  const voters = await tx.eligibleVoter.findMany({ where: { electionId }, select: { lookupKey: true, primaryKey: true } });
  const primary = new Map<string, Set<string>>();
  for (const v of voters) (primary.get(v.primaryKey) ?? primary.set(v.primaryKey, new Set()).get(v.primaryKey)!).add(v.lookupKey);
  return { lookupKeys: new Set(voters.map((v) => v.lookupKey)), primary };
}

const sealCtx = (importId: string, rowIndex: number) => `roster-row:${importId}:${rowIndex}`;
const unsealCells = (importId: string, rowIndex: number, sealed: string | null): Cells => (sealed ? (JSON.parse(open(sealed, sealCtx(importId, rowIndex))) as Cells) : {});

/** Re-evaluates all staged rows of an import with its current mapping and persists changed statuses. */
async function reevaluate(tx: Tx, imp: RosterImport, election: Election) {
  const fields = parseFields(election.verificationFields);
  const mapping = (imp.mapping ?? {}) as Mapping;
  const stagedRows = await tx.rosterImportRow.findMany({ where: { importId: imp.id }, orderBy: { rowIndex: "asc" } });
  const rows: EvalInput[] = stagedRows.map((r) => ({ id: r.id, rowIndex: r.rowIndex, cells: unsealCells(imp.id, r.rowIndex, r.payloadSealed), resolution: r.resolution, confidence: r.confidence }));
  const results = evaluateRows(rows, mapping, fields, election.id, await existingKeys(tx, election.id));
  const byId = new Map(stagedRows.map((r) => [r.id, r]));
  const counts = { total: rows.length, ok: 0, warning: 0, error: 0, duplicate: 0, ambiguous: 0, skipped: 0 };
  for (const r of results) {
    const prev = byId.get(r.id)!;
    counts[r.status.toLowerCase() as keyof typeof counts]++;
    if (prev.status !== r.status || JSON.stringify(prev.issues) !== JSON.stringify(r.issues)) {
      await tx.rosterImportRow.update({ where: { id: r.id }, data: { status: r.status, issues: r.issues } });
    }
  }
  await tx.rosterImport.update({ where: { id: imp.id }, data: { stats: counts } });
  return { results, counts };
}

// ───────────────────────── upload → parse ─────────────────────────

export const rosterUploadInput = z.strictObject({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
});

export async function requestRosterUpload(actor: Actor, electionId: string, input: z.infer<typeof rosterUploadInput>) {
  const { election } = await loadElection(actor, electionId);
  assertRestricted(election);
  assertNotFrozen(election);
  const kind = classifyFile(input.filename, input.contentType);
  if (!kind) throw new AppError("VALIDATION_FAILED", "Upload a CSV, PDF, Word (.docx), PNG or JPEG file.", { fields: { contentType: "Unsupported file type." } });
  if (input.size > env().MAX_ROSTER_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", `Roster files can be at most ${Math.floor(env().MAX_ROSTER_BYTES / 1_000_000)} MB.`);
  if (kind !== "csv" && !getExtractor()) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Reading PDFs, Word documents and images needs a document-reading provider, which isn't configured here. Upload a CSV instead, or paste the voters in manually.");
  }

  if (input.idempotencyKey) {
    const prior = await db.rosterImport.findUnique({ where: { electionId_idempotencyKey: { electionId, idempotencyKey: input.idempotencyKey } }, include: { upload: true } });
    if (prior?.upload && prior.status === "AWAITING_UPLOAD") return { importId: prior.id, sourceKind: prior.sourceKind, upload: await issueUploadTarget(prior.upload), maxBytes: env().MAX_ROSTER_BYTES };
    if (prior) return { importId: prior.id, sourceKind: prior.sourceKind, upload: null, maxBytes: env().MAX_ROSTER_BYTES };
  }

  const result = await db.$transaction(async (tx) => {
    const upload = await createUploadRecord(tx, { organizationId: election.organizationId, electionId, kind: "ROSTER", filename: input.filename, contentType: mimeFor(kind), size: input.size, actorId: actor.id });
    const imp = await tx.rosterImport.create({
      data: { electionId, uploadId: upload.id, sourceKind: kind, originalName: sanitizeFilename(input.filename), columns: [], idempotencyKey: input.idempotencyKey ?? null, createdById: actor.id },
    });
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.upload_requested", targetType: "RosterImport", targetId: imp.id, metadata: { kind, bytes: input.size } });
    return { imp, upload };
  });
  return { importId: result.imp.id, sourceKind: kind, upload: await issueUploadTarget(result.upload), maxBytes: env().MAX_ROSTER_BYTES };
}

export async function finalizeRosterUpload(actor: Actor, electionId: string, importId: string) {
  const { import: imp, election } = await requireImport(actor.id, electionId, importId);
  const e = await loadElection(actor, electionId);
  assertNotFrozen(e.election);
  if (imp.status !== "AWAITING_UPLOAD") return summarize(imp);
  const upload = await db.upload.findUnique({ where: { id: imp.uploadId! } });
  if (!upload) throw notFound("That upload");
  try {
    await finalizeUpload(upload, imp.sourceKind as SourceKind, env().MAX_ROSTER_BYTES);
  } catch (err) {
    await db.rosterImport.updateMany({ where: { id: imp.id, status: "AWAITING_UPLOAD" }, data: { status: "REJECTED", errorCode: err instanceof AppError ? err.code : "UPLOAD_FAILED" } });
    throw err;
  }
  const done = await db.$transaction(async (tx) => {
    const r = await tx.rosterImport.updateMany({ where: { id: imp.id, status: "AWAITING_UPLOAD" }, data: { status: "UPLOADED" } });
    if (r.count) await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.upload_finalized", targetType: "RosterImport", targetId: imp.id });
    return tx.rosterImport.findUniqueOrThrow({ where: { id: imp.id } });
  });
  return summarize(done);
}

export function canRunInline(kind: SourceKind): boolean {
  if (kind === "csv") return true;
  return getJobQueue().durable || env().NODE_ENV !== "production";
}

/** Authorizes, then hands parsing to the job queue (inline for small CSVs, durable queue for the rest). */
export async function startParse(actor: Actor, electionId: string, importId: string) {
  const { import: imp, election } = await requireImport(actor.id, electionId, importId);
  const e = await loadElection(actor, electionId);
  assertNotFrozen(e.election);
  if (imp.status !== "UPLOADED" && imp.status !== "FAILED") throw invalidState("This file can't be parsed in its current state.");
  if (!canRunInline(imp.sourceKind as SourceKind)) {
    throw new AppError("PROVIDER_NOT_CONFIGURED", "Reading PDFs, Word documents and images runs in the background and needs a durable job queue (JOB_DRIVER=qstash). Upload a CSV instead, or configure the queue.");
  }
  await audit(db, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.parse_started", targetType: "RosterImport", targetId: imp.id });
  const r = await getJobQueue().enqueue("roster.parse", { importId: imp.id }, `parse:${imp.id}:${imp.status}:${imp.parsedAt?.getTime() ?? 0}`);
  const fresh = await db.rosterImport.findUniqueOrThrow({ where: { id: imp.id } });
  return { ...summarize(fresh), mode: r.mode };
}

function parseCsv(text: string): { columns: string[]; rows: Cells[] } {
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const columns = (res.meta.fields ?? []).filter((c) => c.length > 0);
  if (columns.length === 0) throw new AppError("VALIDATION_FAILED", "We couldn't find a header row. The first line must name each column.");
  if (columns.length > MAX_COLUMNS) throw new AppError("VALIDATION_FAILED", `That file has more than ${MAX_COLUMNS} columns.`);
  const max = env().MAX_ROSTER_ROWS;
  if (res.data.length > max) throw new AppError("VALIDATION_FAILED", `That file has more than ${max.toLocaleString()} rows.`);
  const clean = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 400);
  const rows = res.data.map((r) => Object.fromEntries(columns.map((c) => [c, clean(r[c])])));
  return { columns, rows };
}

/** The background job. Idempotent: guarded by a status compare-and-swap, rows replaced in one transaction. */
export async function runParseJob(importId: string): Promise<void> {
  const claimed = await db.rosterImport.updateMany({ where: { id: importId, status: { in: ["UPLOADED", "FAILED"] } }, data: { status: "PARSING", errorCode: null, parseStartedAt: now() } });
  if (claimed.count !== 1) return; // already running or done: a redelivered job is a no-op
  const imp = await db.rosterImport.findUniqueOrThrow({ where: { id: importId }, include: { election: true, upload: true } });
  const fail = async (code: string) => {
    await db.rosterImport.update({ where: { id: importId }, data: { status: "FAILED", errorCode: code } });
    await audit(db, { organizationId: imp.election.organizationId, electionId: imp.electionId, action: "roster.parse_failed", targetType: "RosterImport", targetId: importId, metadata: { code } });
  };
  try {
    if (isRosterFrozen(imp.election, now())) return fail("ROSTER_FROZEN");
    const fields = parseFields(imp.election.verificationFields);
    const bytes = await getStorage().read(imp.upload!.objectKey, env().MAX_ROSTER_BYTES);
    let columns: string[]; let rows: { cells: Cells; confidence: number | null }[]; let extractor: string;
    if (imp.sourceKind === "csv") {
      const text = decodeText(bytes);
      if (text === null) return fail("NOT_TEXT");
      const p = parseCsv(text);
      columns = p.columns; rows = p.rows.map((cells) => ({ cells, confidence: null })); extractor = "csv";
      if (!getJobQueue().durable && rows.length > env().INLINE_PARSE_MAX_ROWS) return fail("TOO_LARGE_FOR_INLINE");
    } else {
      const x = getExtractor();
      if (!x) return fail("PROVIDER_NOT_CONFIGURED");
      const t = await x.extract({ bytes, kind: imp.sourceKind as "pdf" | "docx" | "png" | "jpeg", idempotencyKey: importId });
      if (t.rows.length > env().MAX_ROSTER_ROWS) return fail("TOO_MANY_ROWS");
      columns = t.columns; rows = t.rows; extractor = x.name;
    }
    await db.$transaction(async (tx) => {
      await tx.rosterImportRow.deleteMany({ where: { importId } });
      for (let i = 0; i < rows.length; i += 500) {
        await tx.rosterImportRow.createMany({
          data: rows.slice(i, i + 500).map((r, j) => ({ importId, rowIndex: i + j, payloadSealed: seal(JSON.stringify(r.cells), sealCtx(importId, i + j)), status: "OK" as RowStatus, issues: [], confidence: r.confidence })),
        });
      }
      const mapping = suggestMapping(columns, fields);
      const updated = await tx.rosterImport.update({ where: { id: importId }, data: { status: "NEEDS_REVIEW", columns, mapping, extractor, parsedAt: now() }, include: { election: true } });
      await reevaluate(tx, updated, updated.election);
      await audit(tx, { organizationId: imp.election.organizationId, electionId: imp.electionId, action: "roster.parse_completed", targetType: "RosterImport", targetId: importId, metadata: { rows: rows.length, extractor } });
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    logger.error("roster.parse_error", { importId, name: e instanceof Error ? e.name : "unknown" });
    const code = e instanceof AppError ? e.code : "PARSE_FAILED";
    await db.rosterImport.updateMany({ where: { id: importId, status: "PARSING" }, data: { status: "FAILED", errorCode: code } });
    if (!(e instanceof AppError)) throw e;
  }
}
registerJob("roster.parse", async ({ importId }) => runParseJob(importId));

// ───────────────────────── manual / pasted roster ─────────────────────────

/** The manual review/correction path: paste CSV text (or start empty) and edit rows in the review screen. */
export async function createManualImport(actor: Actor, electionId: string, input: { csv?: string }) {
  const { election } = await loadElection(actor, electionId);
  assertRestricted(election);
  assertNotFrozen(election);
  const fields = parseFields(election.verificationFields);
  const parsed = input.csv ? parseCsv(input.csv) : { columns: [...fields.map((f) => f.key), "name", "group"], rows: [] as Cells[] };
  return db.$transaction(async (tx) => {
    await lockRoster(tx, electionId);
    const imp = await tx.rosterImport.create({
      data: { electionId, sourceKind: "manual", originalName: "Pasted or typed entries", status: "NEEDS_REVIEW", columns: parsed.columns, extractor: "manual", createdById: actor.id, parsedAt: now() },
    });
    for (let i = 0; i < parsed.rows.length; i += 500) {
      await tx.rosterImportRow.createMany({ data: parsed.rows.slice(i, i + 500).map((cells, j) => ({ importId: imp.id, rowIndex: i + j, payloadSealed: seal(JSON.stringify(cells), sealCtx(imp.id, i + j)), issues: [] })) });
    }
    const updated = await tx.rosterImport.update({ where: { id: imp.id }, data: { mapping: suggestMapping(parsed.columns, fields) } });
    await reevaluate(tx, updated, election);
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.upload_requested", targetType: "RosterImport", targetId: imp.id, metadata: { kind: "manual", rows: parsed.rows.length } });
    return summarize(await tx.rosterImport.findUniqueOrThrow({ where: { id: imp.id } }));
  }, { timeout: 60_000 });
}

export async function addRow(actor: Actor, electionId: string, importId: string, cells: Cells) {
  const { import: imp, election } = await requireImport(actor.id, electionId, importId);
  const e = (await loadElection(actor, electionId)).election;
  assertNotFrozen(e);
  if (imp.status !== "NEEDS_REVIEW") throw invalidState("This import isn't open for editing.");
  const columns = imp.columns as string[];
  const safe: Cells = Object.fromEntries(columns.map((c) => [c, String(cells[c] ?? "").trim().slice(0, 400)]));
  return db.$transaction(async (tx) => {
    const last = await tx.rosterImportRow.findFirst({ where: { importId }, orderBy: { rowIndex: "desc" }, select: { rowIndex: true } });
    const count = await tx.rosterImportRow.count({ where: { importId } });
    if (count >= env().MAX_ROSTER_ROWS) throw invalidState("This import has reached the row limit.");
    const idx = (last?.rowIndex ?? -1) + 1;
    await tx.rosterImportRow.create({ data: { importId, rowIndex: idx, payloadSealed: seal(JSON.stringify(safe), sealCtx(importId, idx)), issues: [] } });
    const result = await reevaluate(tx, imp, e);
    void election;
    return result.counts;
  }, { timeout: 60_000 });
}

// ───────────────────────── review ─────────────────────────

function summarize(imp: RosterImport) {
  return {
    id: imp.id, status: imp.status, sourceKind: imp.sourceKind, originalName: imp.originalName, extractor: imp.extractor,
    columns: imp.columns as string[], mapping: (imp.mapping ?? {}) as Mapping, stats: (imp.stats ?? null) as Record<string, number> | null,
    errorCode: imp.errorCode, createdAt: imp.createdAt, parsedAt: imp.parsedAt, confirmedAt: imp.confirmedAt, purgedAt: imp.purgedAt,
  };
}
export type ImportSummary = ReturnType<typeof summarize>;

export async function getImport(actor: Actor, electionId: string, importId: string) {
  const { import: imp } = await requireImport(actor.id, electionId, importId);
  return summarize(imp);
}

export async function listImports(actor: Actor, electionId: string) {
  await loadElection(actor, electionId);
  const rows = await db.rosterImport.findMany({ where: { electionId }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map(summarize);
}

export async function listImportRows(actor: Actor, electionId: string, importId: string, opts: { page: number; status?: RowStatus }) {
  const { import: imp, election } = await requireImport(actor.id, electionId, importId);
  const fields = parseFields(election.verificationFields);
  const mapping = (imp.mapping ?? {}) as Mapping;
  // Columns feeding secret (PIN) fields are masked in every listing.
  const secret = new Set(fields.filter((f) => f.kind === "pin").map((f) => mapping[f.key]).filter(Boolean) as string[]);
  const where: PrismaNS.RosterImportRowWhereInput = { importId, ...(opts.status ? { status: opts.status } : {}) };
  const [total, rows] = await Promise.all([
    db.rosterImportRow.count({ where }),
    db.rosterImportRow.findMany({ where, orderBy: { rowIndex: "asc" }, skip: (opts.page - 1) * REVIEW_PAGE, take: REVIEW_PAGE }),
  ]);
  return {
    page: opts.page, pageSize: REVIEW_PAGE, total,
    rows: rows.map((r) => {
      const cells = unsealCells(importId, r.rowIndex, r.payloadSealed);
      return { id: r.id, rowIndex: r.rowIndex, status: r.status, issues: r.issues as string[], confidence: r.confidence, resolution: r.resolution, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, secret.has(k) && v ? "••••" : v])) };
    }),
  };
}

async function editableImport(actor: Actor, electionId: string, importId: string) {
  const { import: imp } = await requireImport(actor.id, electionId, importId);
  const { election } = await loadElection(actor, electionId);
  assertRestricted(election);
  assertNotFrozen(election);
  if (imp.status !== "NEEDS_REVIEW") throw invalidState("This import isn't open for review.");
  return { imp, election };
}

export async function saveMapping(actor: Actor, electionId: string, importId: string, mapping: Mapping) {
  const { imp, election } = await editableImport(actor, electionId, importId);
  validateMapping(mapping, imp.columns as string[], parseFields(election.verificationFields));
  return db.$transaction(async (tx) => {
    const updated = await tx.rosterImport.update({ where: { id: importId }, data: { mapping } });
    const r = await reevaluate(tx, updated, election);
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.mapping_saved", targetType: "RosterImport", targetId: importId });
    return r.counts;
  }, { timeout: 60_000 });
}

export async function correctRow(actor: Actor, electionId: string, importId: string, rowId: string, patch: Cells) {
  const { imp, election } = await editableImport(actor, electionId, importId);
  const columns = new Set(imp.columns as string[]);
  return db.$transaction(async (tx) => {
    const row = await tx.rosterImportRow.findFirst({ where: { id: rowId, importId } });
    if (!row) throw notFound("That row");
    const cells = { ...unsealCells(importId, row.rowIndex, row.payloadSealed) };
    for (const [k, v] of Object.entries(patch)) if (columns.has(k)) cells[k] = v.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 400);
    // A correction invalidates any earlier decision about this row.
    await tx.rosterImportRow.update({ where: { id: rowId }, data: { payloadSealed: seal(JSON.stringify(cells), sealCtx(importId, row.rowIndex)), resolution: null, confidence: null } });
    const r = await reevaluate(tx, imp, election);
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.row_corrected", targetType: "RosterImport", targetId: importId, metadata: { rowIndex: row.rowIndex } });
    return r.counts;
  }, { timeout: 60_000 });
}

export async function resolveRow(actor: Actor, electionId: string, importId: string, rowId: string, action: "KEEP" | "SKIP" | "CLEAR") {
  const { imp, election } = await editableImport(actor, electionId, importId);
  return db.$transaction(async (tx) => {
    const row = await tx.rosterImportRow.findFirst({ where: { id: rowId, importId } });
    if (!row) throw notFound("That row");
    if (action === "KEEP" && row.status !== "AMBIGUOUS") throw invalidState("Only look-alike (ambiguous) rows can be kept explicitly. Fix errors by editing the row, or skip it.");
    await tx.rosterImportRow.update({ where: { id: rowId }, data: { resolution: action === "CLEAR" ? null : action } });
    const r = await reevaluate(tx, imp, election);
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.row_resolved", targetType: "RosterImport", targetId: importId, metadata: { rowIndex: row.rowIndex, decision: action } });
    return r.counts;
  }, { timeout: 60_000 });
}

// ───────────────────────── confirm / reject ─────────────────────────

export async function confirmImport(actor: Actor, electionId: string, importId: string) {
  const { import: imp0 } = await requireImport(actor.id, electionId, importId);
  const { election } = await loadElection(actor, electionId);
  assertRestricted(election);
  if (imp0.status === "IMPORTED") return summarize(imp0); // idempotent: confirming twice changes nothing
  assertNotFrozen(election);

  const result = await db.$transaction(async (tx) => {
    await lockRoster(tx, electionId); // freeze enforced here, atomically with the writes below
    const claim = await tx.rosterImport.updateMany({ where: { id: importId, status: "NEEDS_REVIEW" }, data: { status: "CONFIRMING" } });
    if (claim.count !== 1) throw invalidState("This import isn't ready to confirm.");
    const imp = await tx.rosterImport.findUniqueOrThrow({ where: { id: importId } });
    const fields = parseFields(election.verificationFields);
    validateMapping((imp.mapping ?? {}) as Mapping, imp.columns as string[], fields);

    // Re-evaluate against the roster as it is *now*, inside the transaction.
    const { results } = await reevaluate(tx, imp, election);
    const staged = await tx.rosterImportRow.findMany({ where: { importId } });
    const resolution = new Map(staged.map((r) => [r.id, r.resolution]));
    const blocking = results.filter((r) => r.status === "ERROR" || (r.status === "AMBIGUOUS" && resolution.get(r.id) !== "KEEP"));
    if (blocking.length) {
      throw new AppError("INVALID_STATE", `${blocking.length} row${blocking.length === 1 ? " needs" : "s need"} attention before you can import: fix errors, or skip/keep look-alike rows.`, { blocking: blocking.length });
    }
    const toImport = results.filter((r) => importable(r.status, resolution.get(r.id) ?? null));
    if (toImport.length === 0) throw invalidState("There are no valid rows to import.");

    const data = toImport.map((r) => ({
      electionId, lookupKey: r.lookupKey!, primaryKey: r.primaryKey!, labelSealed: seal(r.label!, `voter-label:${electionId}`), groupLabel: r.group ?? null, importId,
    }));
    for (let i = 0; i < data.length; i += 500) await tx.eligibleVoter.createMany({ data: data.slice(i, i + 500) });

    const stats = { ...(imp.stats as Record<string, number>), imported: data.length };
    await tx.rosterImportRow.updateMany({ where: { importId }, data: { payloadSealed: null } });
    const done = await tx.rosterImport.update({ where: { id: importId }, data: { status: "IMPORTED", confirmedById: actor.id, confirmedAt: now(), purgedAt: now(), stats } });
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.import_confirmed", targetType: "RosterImport", targetId: importId, metadata: { imported: data.length, skipped: results.length - data.length } });
    return done;
  }, { timeout: 120_000, maxWait: 10_000 });

  if (result.uploadId) await deleteUploadObject(result.uploadId); // raw file is deleted as soon as it is no longer needed
  return summarize(result);
}

export async function rejectImport(actor: Actor, electionId: string, importId: string) {
  const { import: imp, election } = await requireImport(actor.id, electionId, importId);
  if (!["UPLOADED", "NEEDS_REVIEW", "FAILED", "AWAITING_UPLOAD"].includes(imp.status)) throw invalidState("This import can't be rejected in its current state.");
  const done = await db.$transaction(async (tx) => {
    const r = await tx.rosterImport.updateMany({ where: { id: importId, status: imp.status }, data: { status: "REJECTED", purgedAt: now() } });
    if (r.count !== 1) throw invalidState("This import changed while you were reviewing it.");
    await tx.rosterImportRow.updateMany({ where: { importId }, data: { payloadSealed: null } });
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.import_rejected", targetType: "RosterImport", targetId: importId });
    return tx.rosterImport.findUniqueOrThrow({ where: { id: importId } });
  });
  if (done.uploadId) await deleteUploadObject(done.uploadId);
  return summarize(done);
}

// ───────────────────────── the roster itself ─────────────────────────

export async function listVoters(actor: Actor, electionId: string, opts: { page: number; q?: string }) {
  const { election } = await loadElection(actor, electionId);
  const pageSize = 50;
  const all = await db.eligibleVoter.findMany({ where: { electionId }, orderBy: { createdAt: "asc" }, select: { id: true, labelSealed: true, groupLabel: true, createdAt: true } });
  let rows = all.map((v) => ({ id: v.id, label: open(v.labelSealed, `voter-label:${election.id}`), group: v.groupLabel, addedAt: v.createdAt }));
  const q = opts.q?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q) || (r.group ?? "").toLowerCase().includes(q));
  return { total: rows.length, page: opts.page, pageSize, frozen: isRosterFrozen(election, now()), rows: rows.slice((opts.page - 1) * pageSize, opts.page * pageSize) };
}

export async function removeVoter(actor: Actor, electionId: string, voterId: string) {
  const { election } = await loadElection(actor, electionId);
  assertRestricted(election);
  assertNotFrozen(election);
  await db.$transaction(async (tx) => {
    await lockRoster(tx, electionId);
    const r = await tx.eligibleVoter.deleteMany({ where: { id: voterId, electionId, attendance: null } });
    if (r.count !== 1) throw notFound("That voter");
    await audit(tx, { organizationId: election.organizationId, electionId, actorId: actor.id, action: "roster.voter_removed", targetType: "EligibleVoter", targetId: voterId });
  });
}

/** Retention: scrub staged rows and raw files of finished/abandoned imports. Run by the sweeper. */
export async function purgeStaleImports(): Promise<number> {
  const cutoff = new Date(now().getTime() - env().RAW_UPLOAD_RETENTION_HOURS * 3_600_000);
  const stale = await db.rosterImport.findMany({ where: { createdAt: { lt: cutoff }, OR: [{ purgedAt: null, status: { in: ["NEEDS_REVIEW", "UPLOADED", "FAILED", "AWAITING_UPLOAD", "REJECTED", "PARSING"] } }, { status: "IMPORTED", upload: { status: "UPLOADED" } }] }, select: { id: true, uploadId: true, status: true } });
  for (const s of stale) {
    await db.$transaction(async (tx) => {
      await tx.rosterImportRow.updateMany({ where: { importId: s.id }, data: { payloadSealed: null } });
      await tx.rosterImport.updateMany({ where: { id: s.id, purgedAt: null }, data: { purgedAt: now(), ...(["NEEDS_REVIEW", "UPLOADED", "AWAITING_UPLOAD", "PARSING"].includes(s.status) ? { status: "REJECTED" as const, errorCode: "EXPIRED" } : {}) } });
    });
    if (s.uploadId) await deleteUploadObject(s.uploadId);
  }
  return stale.length;
}

export { Prisma };

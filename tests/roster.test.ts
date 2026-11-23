import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { createElection, deleteDraftElection, transitionElection, updateElection } from "@/server/domain/election";
import { addPosition, addCandidate } from "@/server/domain/ballot-config";
import { addRow, confirmImport, correctRow, createManualImport, finalizeRosterUpload, listImportRows, listVoters, removeVoter, requestRosterUpload, resolveRow, rejectImport, startParse, saveMapping } from "@/server/domain/roster";
import { getLocalStorage } from "@/server/adapters/storage";
import { runSweep } from "@/server/domain/sweep";
import { deleteUploadObject } from "@/server/domain/uploads";
import { freezeClock, hours, makeOrg, makeUser, T0 } from "./helpers/factory";

afterEach(() => setClockForTests(null));

async function draft(fields?: { key: string; label: string; kind: "text" | "email" | "id" | "pin" }[]) {
  const { org, user } = await makeOrg();
  const actor = { id: user.id };
  const e = await createElection(actor, org.id, { title: "Roster test", timezone: "UTC", eligibilityMode: "RESTRICTED", verificationFields: fields });
  return { actor, e, org };
}
const codeOf = async (p: Promise<unknown>) => (await p.then(() => null, (x) => x))?.code;

describe("roster import", () => {
  it("never stores identifiers in the clear and wipes staged rows on confirm", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email,name\nsecret.person@example.org,Secret Person" });
    const staged = await db.rosterImportRow.findMany({ where: { importId: imp.id } });
    expect(JSON.stringify(staged)).not.toContain("secret.person");
    await confirmImport(actor, e.id, imp.id);
    const voters = await db.eligibleVoter.findMany({ where: { electionId: e.id } });
    expect(JSON.stringify(voters)).not.toMatch(/secret|example\.org/i);
    expect((await db.rosterImportRow.findMany({ where: { importId: imp.id } })).every((r) => r.payloadSealed === null)).toBe(true);
    const list = await listVoters(actor, e.id, { page: 1 });
    expect(list.rows[0]!.label).toBe("Secret Person");
  });

  it("flags missing, invalid and duplicate rows and blocks confirmation until errors are fixed", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email,name\nok@x.test,Ok\nok@x.test,Ok Again\nnot-an-email,Bad\n,Empty" });
    const rows = await listImportRows(actor, e.id, imp.id, { page: 1 });
    const by = Object.fromEntries(rows.rows.map((r) => [r.rowIndex, r]));
    expect(by[0]!.status).toBe("OK");
    expect(by[1]!.status).toBe("DUPLICATE");
    expect(by[2]).toMatchObject({ status: "ERROR", issues: ["invalid:email"] });
    expect(by[3]).toMatchObject({ status: "ERROR", issues: ["missing:email"] });
    expect(await codeOf(confirmImport(actor, e.id, imp.id))).toBe("INVALID_STATE");

    await correctRow(actor, e.id, imp.id, by[2]!.id, { email: "fixed@x.test" });
    await resolveRow(actor, e.id, imp.id, by[3]!.id, "SKIP");
    const done = await confirmImport(actor, e.id, imp.id);
    expect(done.status).toBe("IMPORTED");
    expect((await listVoters(actor, e.id, { page: 1 })).total).toBe(2); // ok@ + fixed@; duplicate and skipped rows left out
  });

  it("treats look-alike rows as ambiguous and requires an explicit decision", async () => {
    freezeClock();
    const { actor, e } = await draft([{ key: "email", label: "Email", kind: "email" }, { key: "regno", label: "Registration number", kind: "id" }]);
    const imp = await createManualImport(actor, e.id, { csv: "email,regno,name\njo@x.test,A100,Jo\njo@x.test,A101,Jo (typo?)" });
    const rows = (await listImportRows(actor, e.id, imp.id, { page: 1 })).rows;
    expect(rows.map((r) => r.status)).toEqual(["AMBIGUOUS", "AMBIGUOUS"]);
    expect(await codeOf(confirmImport(actor, e.id, imp.id))).toBe("INVALID_STATE");
    await resolveRow(actor, e.id, imp.id, rows[0]!.id, "KEEP");
    await resolveRow(actor, e.id, imp.id, rows[1]!.id, "SKIP");
    await confirmImport(actor, e.id, imp.id);
    expect((await listVoters(actor, e.id, { page: 1 })).total).toBe(1);
  });

  it("is idempotent when confirmed twice", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email\na@x.test\nb@x.test" });
    await confirmImport(actor, e.id, imp.id);
    await confirmImport(actor, e.id, imp.id);
    expect(await db.eligibleVoter.count({ where: { electionId: e.id } })).toBe(2);
  });

  it("skips voters that are already on the roster in a later import", async () => {
    freezeClock();
    const { actor, e } = await draft();
    await confirmImport(actor, e.id, (await createManualImport(actor, e.id, { csv: "email\na@x.test" })).id);
    const second = await createManualImport(actor, e.id, { csv: "email\na@x.test\nb@x.test" });
    expect((await listImportRows(actor, e.id, second.id, { page: 1 })).rows.map((r) => r.status)).toEqual(["DUPLICATE", "WARNING"]) // no name column, so the label falls back to a masked identifier;
    await confirmImport(actor, e.id, second.id);
    expect(await db.eligibleVoter.count({ where: { electionId: e.id } })).toBe(2);
  });

  it("masks PIN columns in review listings", async () => {
    freezeClock();
    const { actor, e } = await draft([{ key: "email", label: "Email", kind: "email" }, { key: "pin", label: "PIN", kind: "pin" }]);
    const imp = await createManualImport(actor, e.id, { csv: "email,pin\na@x.test,481516" });
    const row = (await listImportRows(actor, e.id, imp.id, { page: 1 })).rows[0]!;
    expect(row.cells.pin).toBe("••••");
    expect(JSON.stringify(row)).not.toContain("481516");
  });

  it("supports adding a row and changing the column mapping in review", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "Mail,Full name\na@x.test,Ann" });
    await saveMapping(actor, e.id, imp.id, { email: "Mail", __label: "Full name" });
    await addRow(actor, e.id, imp.id, { Mail: "b@x.test", "Full name": "Ben" });
    await confirmImport(actor, e.id, imp.id);
    expect((await listVoters(actor, e.id, { page: 1 })).rows.map((r) => r.label).sort()).toEqual(["Ann", "Ben"]);
  });

  it("rejects a mapping to a column that does not exist", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email\na@x.test" });
    expect(await codeOf(saveMapping(actor, e.id, imp.id, { email: "nope" }))).toBe("VALIDATION_FAILED");
    await rejectImport(actor, e.id, imp.id);
    expect(await codeOf(confirmImport(actor, e.id, imp.id))).toBe("INVALID_STATE");
  });
});

describe("file upload and parsing", () => {
  it("rejects an upload that is larger than the size that was declared", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const req = await requestRosterUpload(actor, e.id, { filename: "voters.csv", contentType: "text/csv", size: 10 });
    const up = await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId }, include: { upload: true } });
    await getLocalStorage().write(up.upload!.objectKey, Buffer.from("email,name\nq@x.test,Quinn\n\n"));
    expect(await codeOf(finalizeRosterUpload(actor, e.id, req.importId))).toBe("VALIDATION_FAILED");
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId } })).status).toBe("REJECTED");
  });

  it("accepts a matching upload and parses it", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const body = Buffer.from("email,name\nq@x.test,Quinn\nr@x.test,Rae\n");
    const req = await requestRosterUpload(actor, e.id, { filename: "voters.csv", contentType: "text/csv", size: body.length });
    const rec = await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId }, include: { upload: true } });
    await getLocalStorage().write(rec.upload!.objectKey, body);
    expect((await finalizeRosterUpload(actor, e.id, req.importId)).status).toBe("UPLOADED");
    expect((await startParse(actor, e.id, req.importId)).status).toBe("NEEDS_REVIEW");
    await confirmImport(actor, e.id, req.importId);
    expect((await listVoters(actor, e.id, { page: 1 })).total).toBe(2);
    // the raw file is deleted once the roster is confirmed
    expect((await db.upload.findUniqueOrThrow({ where: { id: rec.uploadId! } })).status).toBe("DELETED");
  });

  it("hands back every stored object when a draft election is deleted, so none is orphaned", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const body = Buffer.from("email,name\nq@x.test,Quinn\n");
    const req = await requestRosterUpload(actor, e.id, { filename: "voters.csv", contentType: "text/csv", size: body.length });
    const rec = await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId }, include: { upload: true } });
    await getLocalStorage().write(rec.upload!.objectKey, body);
    await finalizeRosterUpload(actor, e.id, req.importId);

    const { uploadIds } = await deleteDraftElection(actor, e.id);
    expect(uploadIds).toEqual([rec.uploadId]);
    for (const id of uploadIds) await deleteUploadObject(id);
    expect((await db.upload.findUniqueOrThrow({ where: { id: rec.uploadId! } })).status).toBe("DELETED");
    expect(await getLocalStorage().stat(rec.upload!.objectKey)).toBeNull();
    expect(await db.election.findUnique({ where: { id: e.id } })).toBeNull();
  });

  it("rejects files whose bytes do not match their declared type", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const body = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x01]);
    const req = await requestRosterUpload(actor, e.id, { filename: "voters.csv", contentType: "text/csv", size: body.length });
    const rec = await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId }, include: { upload: true } });
    await getLocalStorage().write(rec.upload!.objectKey, body);
    expect(await codeOf(finalizeRosterUpload(actor, e.id, req.importId))).toBeTruthy();
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: req.importId } })).status).toBe("REJECTED");
  });

  it("refuses unsupported types, oversize files, and PDFs when no document reader is configured", async () => {
    freezeClock();
    const { actor, e } = await draft();
    expect(await codeOf(requestRosterUpload(actor, e.id, { filename: "x.exe", contentType: "application/octet-stream", size: 100 }))).toBe("VALIDATION_FAILED");
    expect(await codeOf(requestRosterUpload(actor, e.id, { filename: "x.csv", contentType: "text/csv", size: 50_000_000 }))).toBe("PAYLOAD_TOO_LARGE");
    expect(await codeOf(requestRosterUpload(actor, e.id, { filename: "x.pdf", contentType: "application/pdf", size: 1000 }))).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("is idempotent on the upload request key", async () => {
    freezeClock();
    const { actor, e } = await draft();
    const a = await requestRosterUpload(actor, e.id, { filename: "v.csv", contentType: "text/csv", size: 10, idempotencyKey: "same-key-123" });
    const b = await requestRosterUpload(actor, e.id, { filename: "v.csv", contentType: "text/csv", size: 10, idempotencyKey: "same-key-123" });
    expect(b.importId).toBe(a.importId);
    expect(await db.rosterImport.count({ where: { electionId: e.id } })).toBe(1);
  });
});

describe("24-hour roster freeze", () => {
  const schedule = async (actor: { id: string }, id: string, startsAt: Date) =>
    updateElection(actor, id, { startsAt, endsAt: new Date(startsAt.getTime() + hours(8)) });

  it("allows edits until exactly 24 hours before the start, then rejects every roster write", async () => {
    const clock = freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email\na@x.test" });
    await confirmImport(actor, e.id, imp.id);
    await addPosition(actor, e.id, { title: "Chair" }).then(async (p) => { await addCandidate(actor, p.id, { name: "A" }); await addCandidate(actor, p.id, { name: "B" }); });

    await schedule(actor, e.id, new Date(T0.getTime() + hours(24) + 5_000)); // freeze instant = T0 + 5s
    const open = await createManualImport(actor, e.id, { csv: "email\nb@x.test" });
    clock.set(new Date(T0.getTime() + 4_999));
    await addRow(actor, e.id, open.id, { email: "c@x.test" }); // 1ms before the freeze: still editable
    clock.set(new Date(T0.getTime() + 5_000)); // at the freeze instant
    expect(await codeOf(confirmImport(actor, e.id, open.id))).toBe("ROSTER_FROZEN");
    expect(await codeOf(addRow(actor, e.id, open.id, { email: "d@x.test" }))).toBe("ROSTER_FROZEN");
    expect(await codeOf(createManualImport(actor, e.id, { csv: "email\nz@x.test" }))).toBe("ROSTER_FROZEN");
    const voter = await db.eligibleVoter.findFirstOrThrow({ where: { electionId: e.id } });
    expect(await codeOf(removeVoter(actor, e.id, voter.id))).toBe("ROSTER_FROZEN");
    expect(await db.eligibleVoter.count({ where: { electionId: e.id } })).toBe(1);
  });

  it("freezes immediately when the start is less than 24 hours away, and never unfreezes on reschedule", async () => {
    const clock = freezeClock();
    const { actor, e } = await draft();
    await confirmImport(actor, e.id, (await createManualImport(actor, e.id, { csv: "email\na@x.test" })).id);
    await addPosition(actor, e.id, { title: "Chair" }).then(async (p) => { await addCandidate(actor, p.id, { name: "A" }); await addCandidate(actor, p.id, { name: "B" }); });
    await schedule(actor, e.id, new Date(T0.getTime() + hours(2)));
    expect(await codeOf(createManualImport(actor, e.id, { csv: "email\nb@x.test" }))).toBe("ROSTER_FROZEN");
    // Moving the start far into the future does not reopen the roster.
    await schedule(actor, e.id, new Date(T0.getTime() + hours(200)));
    clock.advance(1000);
    expect(await codeOf(createManualImport(actor, e.id, { csv: "email\nb@x.test" }))).toBe("ROSTER_FROZEN");
    expect((await db.election.findUniqueOrThrow({ where: { id: e.id } })).rosterFrozenAt).not.toBeNull();
  });

  it("refuses to schedule an empty restricted roster inside the freeze window", async () => {
    freezeClock();
    const { actor, e } = await draft();
    await addPosition(actor, e.id, { title: "Chair" }).then(async (p) => { await addCandidate(actor, p.id, { name: "A" }); await addCandidate(actor, p.id, { name: "B" }); });
    const err = await updateElection(actor, e.id, { startsAt: new Date(T0.getTime() + hours(3)), endsAt: new Date(T0.getTime() + hours(9)) }).then(() => null, (x) => x);
    expect(err?.code).toBe("VALIDATION_FAILED");
    expect(String(err.message)).toMatch(/24 hours/i);
    const fresh = await db.election.findUniqueOrThrow({ where: { id: e.id } });
    expect(fresh.status).toBe("DRAFT");
    expect(fresh.startsAt).toBeNull(); // the schedule was not saved
    void transitionElection;
  });
});

describe("sweeper", () => {
  it("recovers stuck parse jobs and expires abandoned imports", async () => {
    const clock = freezeClock();
    const { actor, e } = await draft();
    const imp = await createManualImport(actor, e.id, { csv: "email\na@x.test" });
    await db.rosterImport.update({ where: { id: imp.id }, data: { status: "PARSING", parseStartedAt: new Date(T0.getTime() - 3_600_000) } });
    const r1 = await runSweep();
    expect(r1.recoveredParseJobs).toBeGreaterThanOrEqual(1);
    expect((await db.rosterImport.findUniqueOrThrow({ where: { id: imp.id } })).errorCode).toBe("STUCK");
    const stale = await createManualImport(actor, e.id, { csv: "email\nz@x.test" });
    await db.rosterImport.update({ where: { id: stale.id }, data: { createdAt: new Date(T0.getTime() - 3 * 86_400_000) } });
    await runSweep();
    clock.advance(1);
    const after = await db.rosterImport.findUniqueOrThrow({ where: { id: stale.id } });
    expect(after.status).toBe("REJECTED");
    expect((await db.rosterImportRow.findMany({ where: { importId: stale.id } })).every((r) => r.payloadSealed === null)).toBe(true);
  });

  it("removes expired sessions and tokens but keeps live ones", async () => {
    freezeClock();
    const user = await makeUser("Sweep Test");
    const day = 86_400_000;
    await db.session.createMany({ data: [
      { id: "s-old", token: "tok-old", userId: user.id, expiresAt: new Date(T0.getTime() - day) },
      { id: "s-live", token: "tok-live", userId: user.id, expiresAt: new Date(T0.getTime() + day) },
    ] });
    await db.verification.createMany({ data: [
      { id: "v-old", identifier: "a", value: "x", expiresAt: new Date(T0.getTime() - day) },
      { id: "v-live", identifier: "b", value: "y", expiresAt: new Date(T0.getTime() + day) },
    ] });
    const report = await runSweep();
    expect(report.expiredAuthRowsDeleted).toBe(2);
    expect((await db.session.findMany({ where: { userId: user.id } })).map((x) => x.id)).toEqual(["s-live"]);
    expect((await db.verification.findMany({ where: { id: { in: ["v-old", "v-live"] } } })).map((x) => x.id)).toEqual(["v-live"]);
  });
});

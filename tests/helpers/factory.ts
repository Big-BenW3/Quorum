import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { setClockForTests } from "@/server/clock";
import { createElection, transitionElection, updateElection } from "@/server/domain/election";
import { addCandidate, addPosition } from "@/server/domain/ballot-config";
import { confirmImport, createManualImport } from "@/server/domain/roster";

export const uid = () => randomUUID().slice(0, 8);

export async function makeUser(name = "Test User") {
  const id = randomUUID();
  return db.user.create({ data: { id, name, email: `${id}@example.test` } });
}

export async function makeOrg(owner?: { id: string }) {
  const user = owner ?? (await makeUser("Owner"));
  const org = await db.organization.create({ data: { name: `Org ${uid()}`, slug: `org-${uid()}` } });
  await db.membership.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
  return { org, user };
}

export const T0 = new Date("2026-11-09T12:00:00.000Z");
export const hours = (n: number) => n * 3_600_000;
export const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

/** Freeze the application clock. Returns a setter to move it. */
export function freezeClock(start = T0) {
  let t = start.getTime();
  setClockForTests(() => new Date(t));
  return { set: (d: Date) => { t = d.getTime(); }, advance: (ms: number) => { t += ms; } };
}

export type Fixture = Awaited<ReturnType<typeof makeElection>>;

/**
 * A restricted election with one single-seat position (Alice, Bob), a roster, and voting open.
 * `voters` are emails; the default verification field is the email address.
 */
export async function makeElection(opts: { voters?: string[]; mode?: "OPEN" | "RESTRICTED"; disclosure?: "LIVE" | "AFTER_CLOSE"; groups?: Record<string, string>; open?: boolean } = {}) {
  const { org, user } = await makeOrg();
  const actor = { id: user.id };
  const mode = opts.mode ?? "RESTRICTED";
  const e0 = await createElection(actor, org.id, { title: "Board election", timezone: "UTC", eligibilityMode: mode });
  await updateElection(actor, e0.id, { resultsDisclosure: opts.disclosure ?? "AFTER_CLOSE" });
  const pos = await addPosition(actor, e0.id, { title: "Chair", seats: 1, maxSelections: 1, allowAbstain: true });
  const alice = await addCandidate(actor, pos.id, { name: "Alice" });
  const bob = await addCandidate(actor, pos.id, { name: "Bob" });

  const voters = opts.voters ?? (mode === "RESTRICTED" ? ["a@x.test", "b@x.test", "c@x.test"] : []);
  if (mode === "RESTRICTED") {
    const header = "email,name,group";
    const lines = voters.map((v) => `${v},${v.split("@")[0]},${opts.groups?.[v] ?? ""}`);
    const imp = await createManualImport(actor, e0.id, { csv: [header, ...lines].join("\n") });
    await confirmImport(actor, e0.id, imp.id);
  }
  const startsAt = new Date(T0.getTime() + hours(48));
  await updateElection(actor, e0.id, { startsAt, endsAt: new Date(startsAt.getTime() + hours(24)) });
  let election = await db.election.findUniqueOrThrow({ where: { id: e0.id } });
  if (opts.open !== false) {
    await transitionElection(actor, e0.id, "open");
    election = await db.election.findUniqueOrThrow({ where: { id: e0.id } });
  }
  return { org, user, actor, election, position: pos, alice, bob, voters };
}

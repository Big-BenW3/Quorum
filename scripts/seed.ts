/**
 * Demo data for local development: one organizer, four elections in different states, with enough
 * ballots over time that the results and analytics screens have something real to draw.
 *
 *   npm run db:reset && npm run db:seed
 *
 * It refuses to run in production. It uses the same domain functions as the app (no direct inserts of
 * ballots), and moves the application clock to place votes in the past, exactly as the tests do.
 */
import { randomUUID } from "node:crypto";

try { process.loadEnvFile(".env.local"); } catch { /* env may already be set */ }
if (process.env.NODE_ENV === "production") { console.error("Refusing to seed a production environment."); process.exit(1); }

const DEMO = { name: "Maya Okafor", email: "demo@example.org", password: "quorum-demo-1234" };
const HOUR = 3_600_000;

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function main() {
  const { db } = await import("@/server/db");
  const { setClockForTests } = await import("@/server/clock");
  const { getAuth } = await import("@/server/auth");
  const { createOrganization } = await import("@/server/domain/org");
  const { createElection, updateElection, transitionElection, syncElection } = await import("@/server/domain/election");
  const { addPosition, addCandidate } = await import("@/server/domain/ballot-config");
  const { createManualImport, confirmImport } = await import("@/server/domain/roster");
  const { verifyVoter, submitBallot } = await import("@/server/domain/voting");

  let user = await db.user.findUnique({ where: { email: DEMO.email } });
  if (!user) {
    await getAuth().api.signUpEmail({ body: DEMO });
    user = await db.user.findUniqueOrThrow({ where: { email: DEMO.email } });
  }
  if (await db.membership.findFirst({ where: { userId: user.id } })) { console.log("Demo data already exists. Run `npm run db:reset` first to start clean."); return; }
  const actor = { id: user.id };
  const org = await createOrganization(actor, { name: "Riverside Rowing Club" });

  const FIRST = ["Ada", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hugo", "Isla", "Jamal", "Kira", "Leo", "Mina", "Noah", "Olu", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Victor", "Wen", "Yara"];
  const LAST = ["Adeyemi", "Brooks", "Chen", "Dubois", "Evans", "Fischer", "Gupta", "Hansen"];
  const GROUPS = ["Seniors", "Seniors", "Juniors", "Masters"];
  const people = FIRST.flatMap((f, i) => [0, 1].map((k) => ({ name: `${f} ${LAST[(i * 3 + k * 5) % LAST.length]}`, group: GROUPS[(i + k) % GROUPS.length]! })));
  const emails = people.map((p, i) => `${p.name.toLowerCase().replace(/\s+/g, ".")}${i}@example.org`);

  async function importRoster(electionId: string, count: number) {
    const csv = ["email,name,group", ...people.slice(0, count).map((p, i) => `${emails[i]},${p.name},${p.group}`)].join("\n");
    const imp = await createManualImport(actor, electionId, { csv });
    await confirmImport(actor, electionId, imp.id);
  }

  type Pos = { title: string; description?: string; max: number; seats: number; names: string[]; weights: number[] };
  async function buildBallot(electionId: string, positions: Pos[]) {
    for (const p of positions) {
      const pos = await addPosition(actor, electionId, { title: p.title, description: p.description ?? null, maxSelections: p.max, seats: p.seats, allowAbstain: true });
      for (const n of p.names) await addCandidate(actor, pos.id, { name: n });
    }
  }

  function choose(r: () => number, ballot: { id: string; maxSelections: number; allowAbstain: boolean; candidates: { id: string; name: string }[] }[], pos: Pos[]) {
    return ballot.map((bp, i) => {
      const spec = pos[i]!;
      if (bp.allowAbstain && r() < 0.06) return { positionId: bp.id, candidateIds: [] as string[] };
      const pool = bp.candidates.map((c, j) => ({ id: c.id, w: spec.weights[j] ?? 1 }));
      const want = bp.maxSelections === 1 ? 1 : 1 + Math.floor(r() * bp.maxSelections);
      const picked: string[] = [];
      while (picked.length < Math.min(want, pool.length)) {
        const total = pool.filter((x) => !picked.includes(x.id)).reduce((s, x) => s + x.w, 0);
        let roll = r() * total;
        for (const x of pool) { if (picked.includes(x.id)) continue; roll -= x.w; if (roll <= 0) { picked.push(x.id); break; } }
      }
      return { positionId: bp.id, candidateIds: picked };
    });
  }

  async function castVotes(electionId: string, slug: string, restricted: boolean, plan: { at: Date; voter: number }[], pos: Pos[], r: () => number) {
    for (const v of plan) {
      setClockForTests(() => v.at);
      const issued = await verifyVoter({ slug, values: restricted ? { email: emails[v.voter]! } : {}, deviceId: restricted ? null : randomUUID() });
      // Each call below needs the same device id for open elections, so it is recreated from the issued credential's election only.
      void electionId;
      await submitBallot({ slug, credential: issued.credential, selections: choose(r, issued.ballot, pos), deviceId: null }).catch(() => {});
    }
  }

  const real = Date.now();

  // ── A. A finished, published election with a full turnout curve ─────────────────────────────
  {
    const r = rng(7);
    const positions: Pos[] = [
      { title: "President", description: "Chairs the committee and represents the club.", max: 1, seats: 1, names: ["Amara Nwosu", "Tomás Herrera", "Priya Raman"], weights: [5, 4, 2] },
      { title: "Committee members", description: "Choose up to three. The three with the most votes are elected.", max: 3, seats: 3, names: ["Jonas Berg", "Lena Fischer", "Kofi Mensah", "Isabel Cruz", "Ravi Shah"], weights: [4, 3, 3, 2, 1] },
      { title: "Approve the 2027 budget?", max: 1, seats: 1, names: ["Yes", "No"], weights: [7, 2] },
    ];
    setClockForTests(() => new Date(real - 6 * 24 * HOUR));
    const e = await createElection(actor, org.id, { title: "2027 committee elections", description: "Elect the president and three committee members, and approve next year’s budget.", timezone: "Europe/London", eligibilityMode: "RESTRICTED" });
    await updateElection(actor, e.id, { resultsDisclosure: "AFTER_CLOSE", autoPublish: false });
    await buildBallot(e.id, positions); await importRoster(e.id, 48);
    const open = new Date(real - 5 * 24 * HOUR); const end = new Date(open.getTime() + 48 * HOUR);
    setClockForTests(() => open);
    await transitionElection(actor, e.id, "open", { endsAt: end });
    const slug = (await db.election.findUniqueOrThrow({ where: { id: e.id } })).voterSlug;
    const weights = Array.from({ length: 48 }, (_, h) => (h < 4 ? 3 : h < 10 ? 1.4 : h < 24 ? 0.6 : h < 40 ? 0.5 : 1.8));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const order = emails.slice(0, 48).map((_, i) => i).sort(() => r() - 0.5).slice(0, 31);
    const plan = order.map((voter) => { let roll = r() * wsum, h = 0; for (; h < 47; h++) { roll -= weights[h]!; if (roll <= 0) break; } return { voter, at: new Date(open.getTime() + h * HOUR + Math.floor(r() * 3_000_000)) }; }).sort((a, b) => a.at.getTime() - b.at.getTime());
    await castVotes(e.id, slug, true, plan, positions, r);
    setClockForTests(() => new Date(end.getTime() + 60_000));
    await syncElection(e.id);
    await transitionElection(actor, e.id, "publish");
  }

  // ── B. Open and in progress ────────────────────────────────────────────────────────────────
  {
    const r = rng(11);
    const positions: Pos[] = [
      { title: "Clubhouse refit", description: "Which option should the committee pursue?", max: 1, seats: 1, names: ["Replace the changing rooms", "New boat storage", "Solar roof"], weights: [3, 4, 2] },
    ];
    setClockForTests(() => new Date(real - 7 * HOUR));
    const e = await createElection(actor, org.id, { title: "Clubhouse refit poll", description: "We have budget for one project this year.", timezone: "Europe/London", eligibilityMode: "RESTRICTED" });
    await buildBallot(e.id, positions); await importRoster(e.id, 24);
    const open = new Date(real - 6 * HOUR);
    setClockForTests(() => open);
    await transitionElection(actor, e.id, "open", { endsAt: new Date(real + 30 * HOUR) });
    const slug = (await db.election.findUniqueOrThrow({ where: { id: e.id } })).voterSlug;
    const plan = Array.from({ length: 9 }, (_, i) => ({ voter: i, at: new Date(open.getTime() + Math.floor((i / 9) * 6 * HOUR) + Math.floor(r() * 1_200_000)) }));
    await castVotes(e.id, slug, true, plan, positions, r);
  }

  // ── C. A draft that still needs voters ─────────────────────────────────────────────────────
  {
    setClockForTests(() => new Date(real));
    const e = await createElection(actor, org.id, { title: "Spring social venue", timezone: "Europe/London", eligibilityMode: "RESTRICTED" });
    await buildBallot(e.id, [{ title: "Venue", max: 1, seats: 1, names: ["The Boathouse", "Kew Gardens picnic", "Riverside pub"], weights: [1, 1, 1] }]);
  }

  // ── D. An open-access poll ─────────────────────────────────────────────────────────────────
  {
    const r = rng(3);
    const positions: Pos[] = [{ title: "Favourite session time", max: 1, seats: 1, names: ["Early morning", "Lunchtime", "Evening"], weights: [3, 1, 2] }];
    setClockForTests(() => new Date(real - 3 * HOUR));
    const e = await createElection(actor, org.id, { title: "Quick poll: session times", timezone: "Europe/London", eligibilityMode: "OPEN" });
    await buildBallot(e.id, positions);
    const open = new Date(real - 2 * HOUR);
    setClockForTests(() => open);
    await transitionElection(actor, e.id, "open", { endsAt: new Date(real + 70 * HOUR) });
    const slug = (await db.election.findUniqueOrThrow({ where: { id: e.id } })).voterSlug;
    for (let i = 0; i < 6; i++) {
      const at = new Date(open.getTime() + i * 15 * 60_000);
      setClockForTests(() => at);
      const device = randomUUID();
      const issued = await verifyVoter({ slug, values: {}, deviceId: device });
      await submitBallot({ slug, credential: issued.credential, selections: choose(r, issued.ballot, positions), deviceId: device });
    }
  }

  setClockForTests(null);
  console.log(`\nSeeded. Sign in at /sign-in with:\n  email:    ${DEMO.email}\n  password: ${DEMO.password}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { const { db } = await import("@/server/db"); await db.$disconnect(); });

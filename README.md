# Quorum

A multi-tenant, self-service election platform. Organizations create elections, import a voter list, share a
private voting link, watch live turnout, and publish results and analytics when the vote has ended.

Built with Next.js (App Router), TypeScript, Prisma, Zod, Better Auth, and Tailwind. Runs on a local SQLite file
today and is written to move to Neon (PostgreSQL) without changing application code. Deploys to Vercel with no
Redis and no long-running server.

> **Not certified for regulated elections.** Quorum is built for clubs, societies, student bodies, co-ops and
> similar communities where an administrator is trusted to run a fair vote. It is not a verifiable voting system.
> It does not provide end-to-end verifiability, coercion resistance, or protection from a malicious operator with
> database access. Read [docs/threat-model.md](docs/threat-model.md) before using it for anything contested.

## Quick start

```bash
npm install        # also runs `prisma generate` (needs network access to Prisma's binary host the first time)
npm run setup        # writes .env.local with fresh random secrets (never overwrites)
npm run db:migrate   # creates .data/dev.db from prisma/migrations
npm run db:seed      # optional demo data: a user, an organization, four elections
npm run dev          # http://localhost:3000
```

Demo sign-in after seeding: `demo@example.org` / `quorum-demo-1234` (the seed script refuses to run in production).
`npm run db:reset && npm run db:seed` starts over.

Requires Node 22 or newer. SQLite uses `better-sqlite3`, which downloads a prebuilt binary on install; if that is blocked
in your environment you need a C++ toolchain so it can compile.

### Checks

```bash
npm run typecheck
npm test             # 105 tests: voting races, privacy boundary, freeze, gating, lifecycle, tenant isolation, config
npm run build
```

## What is in the box

| Area | What it does |
| --- | --- |
| Tenancy | Organizations with owner and admin roles, expiring invite links, tenant checks inside every query |
| Elections | Draft → Scheduled → Open → Closed → Published, with server-side deadlines that never depend on a cron |
| Ballot | Positions, candidates, banner/logo/candidate images (private storage, signed URLs), seats, max selections, abstain |
| Voter list | CSV, pasted text, or (with a provider) PDF/DOCX/images; review screen with errors, duplicates and look-alikes; 24-hour freeze |
| Voting | Verify against the list, receive a single-use credential, review, submit. Open-access mode for polls |
| Turnout | Live counts, hourly series, roll call (who voted, never what or when), group turnout with small-group protection |
| Results | Tallies gated by the election's disclosure policy, ties reported not broken, CSV/JSON export |
| Analytics | After voting ends: turnout over time, cumulative curve, margins, abstentions, group turnout (admin only) |
| Audit | Append-only record of administrative actions; voting writes none |
| Public pages | `/v/:slug` voting link, `/r/:slug` results link, both unguessable and `noindex` |

Every screen exists in light and dark, on mobile and desktop. See [docs/design-system.md](docs/design-system.md).

## Project layout

```
prisma/                 schema, migrations, Postgres append-only SQL
scripts/                setup-env, migrate, seed, offline SQL generator
src/app/                pages and Route Handlers (49 handlers under /api)
src/components/         UI kit, charts, results/analytics views, voter flow
src/server/             everything that touches data or secrets (import "server-only")
  domain/               election, ballot, roster, voting, results, turnout, sweep, rules (pure)
  adapters/             storage, ocr, jobs, ratelimit, realtime, mailer (swap points)
  crypto/keys.ts        HKDF / HMAC / AES-GCM helpers, node:crypto only
  http.ts               the one wrapper every Route Handler uses
src/proxy.ts            per-request nonce Content-Security-Policy
tests/                  vitest: domain + HTTP-handler level, real SQLite
docs/                   see below
```

## Documentation

| Document | Read it for |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Request flow, modules, adapters, data model (ER diagram), concurrency |
| [docs/api.md](docs/api.md) | Every endpoint, auth, limits, error format |
| [docs/roster-ingestion.md](docs/roster-ingestion.md) | How a voter list becomes an eligibility roster |
| [docs/threat-model.md](docs/threat-model.md) | What is protected, from whom, and what is not |
| [docs/data-and-retention.md](docs/data-and-retention.md) | What is stored, in what form, for how long |
| [docs/deployment.md](docs/deployment.md) | Vercel + Neon + S3 + QStash setup, the SQLite → Postgres switch |
| [docs/design-system.md](docs/design-system.md) | Tokens, chart palette and its validation, motion, accessibility |
| [docs/status.md](docs/status.md) | What is finished, what is not, and which accounts you need |
| `.env.example` | Every setting, with safe defaults |

## Principles the code holds itself to

- **Fail closed.** Missing secrets, an unconfigured rate limiter, or a missing storage provider stop the feature
  and say why. Nothing silently degrades to something weaker.
- **No claim without code.** Where a protection is partial, the interface and the docs say so.
- **Hidden means never sent.** Results that are not yet visible are not computed for, or sent to, the browser.
- **No voter → ballot link.** Ballots carry no voter, credential, or timestamp reference.
- **Tenant isolation by query.** Access is derived from memberships in the same query that loads the object.
  Anything outside your tenant answers 404.

## Known limits

The short version; the honest long version is in [docs/threat-model.md](docs/threat-model.md).

- Concurrency tests run against SQLite (a single synchronous writer). They prove the ordering of the checks, not
  behavior under real PostgreSQL contention. Run a load test against Neon before a large election.
- The Postgres path (adapter swap, append-only grants, pooled vs direct URL) is written but has not been exercised
  against a live database in this build. QStash, S3 and the OCR adapter were not exercised against live services.
- The migration SQL was generated offline. Verify it on a networked machine:
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`.
- Open-access elections allow one ballot per browser cookie. That is a speed bump, not one-person-one-vote.
- The roll call shows who voted. If that is too revealing for your community, do not share it.
- Password reset and email verification need a mail provider (`MAIL_DRIVER=resend`).

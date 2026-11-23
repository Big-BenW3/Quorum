# Deployment

Two modes: local development on SQLite (works today, nothing to sign up for), and production on Vercel with Neon
(PostgreSQL), an S3-compatible bucket, and optional QStash, Resend and OCR. The Postgres path is written and
documented here but has **not been run against a live database in this build**; follow the verification steps at the end.

## Services

| Concern | Local development | Production |
| --- | --- | --- |
| Hosting | `next dev` | Vercel (serverless functions, no long-running process) |
| Database | SQLite file `.data/dev.db` | Neon PostgreSQL (or any PostgreSQL) |
| Object storage | Local directory, signed URLs | S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage S3, MinIO), private |
| Background jobs | Inline | QStash (optional; required for PDF/Word/image rosters) |
| Rate limiting | Database counters | Database counters (no Redis required) |
| Mail | Console | Resend (needed for password reset and email verification) |
| Document extraction | Off | Your own HTTP endpoint (optional) |
| Scheduling | Call the sweeper by hand | Vercel Cron (`vercel.json`, daily) |

## Local development

```bash
npm install
npm run setup && npm run db:migrate && npm run db:seed && npm run dev
```

`npm run setup` writes `.env.local` (mode 600) with freshly generated secrets and never overwrites an existing file.
The database lives under `.data/` and is git-ignored. `npm run db:reset` deletes and recreates it.

Local mode cannot run in production: the app refuses SQLite, local-disk storage and the in-memory limiter unless you
explicitly opt in (`ALLOW_SQLITE_IN_PRODUCTION`, `ALLOW_LOCAL_STORAGE_IN_PRODUCTION`), which only makes sense on a
single long-lived machine with a persistent disk.

## Switching from SQLite to Neon (PostgreSQL)

The schema is portable on purpose (no native column types, no scalar lists, no `@map`), and every correctness-critical
write is an atomic conditional `UPDATE` plus a unique constraint, which behave the same on both engines. The switch is
four small source edits and a fresh migration baseline. Do it on a branch and run the checks at the end.

1. **Install the Postgres driver adapter.**
   ```bash
   npm install @prisma/adapter-pg
   ```
2. **Change the provider** in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
   }
   ```
3. **Swap the adapter** in `src/server/db.ts`:
   ```ts
   import { PrismaPg } from "@prisma/adapter-pg";

   function create(): PrismaClient {
     const url = env().DATABASE_URL;
     return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: ["warn", "error"] });
   }
   ```
   (Delete the SQLite branch and the `@prisma/adapter-better-sqlite3` import. Better Auth's provider is already chosen
   from the URL: `file:` is SQLite, anything else is PostgreSQL.)
4. **Regenerate the migration baseline.** The checked-in SQL is SQLite-specific.
   ```bash
   rm -rf prisma/migrations
   # against an empty scratch Postgres database (a local container or a Neon branch):
   DATABASE_URL="postgresql://…" npx prisma migrate dev --name init
   DATABASE_URL="postgresql://…" npx prisma migrate dev --create-only --name append_only_guards
   ```
   Paste the **trigger** section of `prisma/postgres/append-only.sql` into the second migration's `migration.sql`.
5. **Keep SQLite for tests, if you like.** The test suite builds a throw-away SQLite file from `prisma/migrations`,
   so after step 4 it needs its own SQLite migration copy or an adapted `tests/helpers/setup.ts`. Move
   `better-sqlite3` to `devDependencies`, and remove `@prisma/adapter-better-sqlite3` and the
   `serverExternalPackages` entries once nothing at runtime uses them.

### Connection strings on Neon

| Variable | Value | Used for |
| --- | --- | --- |
| `DATABASE_URL` | The **pooled** connection string (host contains `-pooler`) | The running app. Serverless functions open many short connections; the pooler absorbs them |
| `DIRECT_URL` | The **direct** connection string | `prisma migrate deploy` only. `prisma.config.ts` prefers it when set. Migrations and advisory locks do not work through a transaction pooler |

Use a **non-owner role** for `DATABASE_URL` (see below) and the owner role for `DIRECT_URL`. Always include
`?sslmode=require`.

### Append-only guards on PostgreSQL

`AuditEvent`, `Ballot` and `BallotSelection` should never be updated or deleted by application code. On SQLite this is
done with triggers. On PostgreSQL, `prisma/postgres/append-only.sql` gives you two layers:

1. **Role grants (preferred).** The app connects as a role that has `SELECT, INSERT, UPDATE, DELETE` on everything
   *except* `UPDATE`/`DELETE` on those three tables. Migrations run as a separate owner role. Run this part by hand once,
   with your own role name and password; it is not in a migration because role names are environment-specific.
2. **Triggers (defence in depth).** They also stop the table owner by accident. These belong in the migration (step 4).

Neither is tamper-proof against an operator with owner access; see [threat-model.md](threat-model.md).

### Portability notes

- `RateLimitBucket.windowStart` stores epoch seconds in an `Int` (32-bit). That is fine until January 2038; widen it to
  `BigInt` (and adjust the one raw SQL statement's result handling) well before then.
- The one hand-written SQL statement is the rate-limit upsert; it is valid on SQLite 3.35+ and PostgreSQL.
- The election row is a deliberate hot row (every ballot submission proves the election is open). On PostgreSQL it
  serializes concurrent submissions per election on a row lock. Fine for clubs and societies; load test before a very
  large election.

## Production on Vercel

### 1. Create the services

- **Neon:** one project, a database, an owner role (migrations) and an app role (runtime). Note both connection strings.
- **Bucket:** private; block all public access. Create an access key limited to that bucket. Add a CORS rule so
  browsers can `PUT` directly from your app's origin:
  ```json
  [{ "AllowedOrigins": ["https://vote.your-domain.org"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 600 }]
  ```
  (Syntax differs slightly between S3 and R2; the content is the same.)
- **Optional:** Upstash QStash (durable jobs), Resend with a verified sending domain (mail), an OCR service that
  implements the contract in `src/server/adapters/ocr.ts`.

### 2. Environment variables

Set these in the Vercel project (Production, and Preview if you use it). See `.env.example` for every option.

| Variable | Notes |
| --- | --- |
| `APP_URL` | Exact public origin, `https://…`, no trailing slash. Better Auth, signed URLs, the origin check and emailed links all derive from it |
| `DATABASE_URL`, `DIRECT_URL` | As above |
| `BETTER_AUTH_SECRET`, `APP_SECRET` | `openssl rand -base64 48` each; different values. The app refuses placeholders |
| `CRON_SECRET` | `openssl rand -base64 24`. Vercel Cron sends it as `Authorization: Bearer …` automatically when set |
| `STORAGE_DRIVER=s3` + `S3_*` | `S3_ENDPOINT` for R2/MinIO/Supabase; omit for AWS. `S3_FORCE_PATH_STYLE=true` for MinIO |
| `MAIL_DRIVER=resend`, `RESEND_API_KEY`, `MAIL_FROM` | Turns on email verification and password reset |
| `JOB_DRIVER=qstash` + three `QSTASH_*` | Needed for PDF/DOCX/image rosters |
| `OCR_DRIVER=http` + `OCR_*` | Optional; shares voter data with a third party |
| `RATE_LIMIT_DRIVER` | Leave as `database` |

Preview deployments get a different URL each time, and the origin check is strict by design. Either set `APP_URL` per
environment, or add the preview origin to `ALLOWED_ORIGINS`, and point previews at a separate Neon branch, never the
production database.

### 3. Build and migrate

- Build command: `npm run build` (runs `prisma generate` then `next build`). Node 22. Prisma downloads its schema engine
  from `binaries.prisma.sh` during install/generate, so the build environment must be able to reach it.
- Apply migrations from your machine or CI, **not** from the serverless runtime:
  ```bash
  DIRECT_URL="postgresql://owner…" npx prisma migrate deploy
  ```
  Then run the role-grant part of `prisma/postgres/append-only.sql` once.
- Verify the migration SQL matches the schema (this build generated the SQLite SQL offline, so this check matters):
  ```bash
  npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
  ```

### 4. Scheduling

`vercel.json` registers `/api/jobs/sweep` daily at 03:00 UTC, which fits the Hobby plan's once-a-day limit. The sweeper is
housekeeping only (credential and file retention, stuck-job recovery, auth row cleanup); elections open, close and
freeze on time without it. Run it by hand any time:

```bash
curl -fsS -X POST https://vote.your-domain.org/api/jobs/sweep -H "Authorization: Bearer $CRON_SECRET"
```

### 5. QStash (optional)

Set `JOB_DRIVER=qstash` and the three keys. QStash publishes to `https://<APP_URL>/api/jobs/run`; the app verifies the
vendor signature over the exact body and URL, and rejects anything else with 401. Function duration limits depend on
your Vercel plan: check that `maxDuration` (set to 300 for `/api/jobs/run`) is allowed on yours.

### 6. Custom domain and headers

Add your domain in Vercel and set `APP_URL` to it. The app already sends HSTS, a nonce CSP (from `src/proxy.ts`), and
the other headers listed in the threat model. If you serve images from a CDN or another origin, add it to `img-src` in
`src/proxy.ts` deliberately; the defaults allow only self and your storage endpoint (and its subdomains, to cover
virtual-hosted-style signed URLs).

## Post-deploy checklist

1. `GET /api/health` returns `{"ok":true}`.
2. `GET /api/jobs/sweep` without the secret returns 401; with it, a JSON report.
3. Response headers on `/` include `Content-Security-Policy` with a nonce, `Strict-Transport-Security`, and
   `X-Frame-Options: DENY`; `/api/*` responses carry `Cache-Control: no-store`.
4. Create an account; with `MAIL_DRIVER=resend`, confirm the verification email arrives.
5. Create an organization and a **restricted** test election with a CSV roster of your own addresses; confirm the
   import, schedule it more than 24 hours ahead, then confirm roster edits are refused inside the 24-hour window using a
   second election scheduled sooner.
6. Open the test election, verify and vote from a private window, and confirm the roll call updates and the ballot count
   goes up.
7. Upload a banner image; confirm it displays on the voting page (this proves the bucket CORS and the CSP together).
8. Close and publish; confirm results and analytics render, and that the public results link shows nothing before publish
   under `AFTER_CLOSE`.
9. In the database, confirm `UPDATE "Ballot" …` fails for the app role.
10. **Load test** the verify and submit endpoints against your expected peak with the production database before a large
    election. This build's concurrency tests cannot tell you how PostgreSQL behaves under contention.

## Operations

- **Backups.** Use your database provider's point-in-time recovery. A restored backup can contain ballots that were later
  "deleted" out-of-band; treat restores as sensitive operations and record them.
- **Secrets.** Rotate `BETTER_AUTH_SECRET` freely (signs everyone out). Do not rotate `APP_SECRET` while an election is
  scheduled or open: roster lookups and sealed labels depend on it. Rotating it between elections means re-importing the
  next roster, which you would do anyway.
- **Logs.** The app writes one-line JSON for errors only, with sensitive keys redacted, and never logs request bodies.
  Your host still records request lines (path, IP, time). Voting links are in those paths; restrict who can read host logs
  and shorten their retention.
- **Monitoring.** Watch for 5xx rates, 429 spikes on `/verify`, and sweeper failures (a failed step reports `"failed"`
  in the response and logs `sweep.step_failed`).
- **Upgrades.** After any Prisma schema change on SQLite, run the test suite: Prisma redefines tables on some changes and
  that silently drops triggers. `npm run db:migrate` and the tests check the append-only guards still exist.

## What this build could not verify

- Running against a live PostgreSQL or Neon, including the pooled connection and the role grants.
- Live S3/R2 presigned `PUT`s from a browser (CORS), QStash deliveries, an OCR endpoint, and Resend.
- That the offline-generated SQLite migration matches what Prisma would generate (run the `migrate diff` command above).
- Vercel build and runtime behavior; the app was built with `next build` in a sandbox and exercised with `next dev`.

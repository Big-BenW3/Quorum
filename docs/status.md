# Status

## Done

- Multi-tenant organizations with owner and admin roles, invite links, tenant checks inside every query.
- Elections with a server-enforced lifecycle (draft, scheduled, open, closed, published), extension of an open election,
  link rotation, and deadlines that apply on any read or write.
- Ballot editor (positions, candidates, seats, max selections, abstain, images) with a lock at the start time and audited
  text corrections after it.
- Voter list: CSV, pasted text, and a provider-neutral path for PDF, DOCX and images; mapping, validation, duplicate and
  look-alike resolution, review and confirm; sealed staging and deletion of raw data; 24-hour freeze enforced in
  transactions.
- Voting: verify against the list, single-use short-lived credential, review, submit. Open-access mode. Race-safe by
  compare-and-swap and unique constraints. No voter-to-ballot reference.
- Turnout board with hourly series, roll call, and group turnout; results and post-election analytics (charts with table
  views) gated by the disclosure policy on the server; CSV and JSON export.
- Append-only audit log, rate limiting without Redis, per-request nonce CSP and security headers, strict request
  validation, structured redacted logging, fail-closed configuration.
- Every screen in light and dark, desktop and mobile; seed script; 105 tests; documentation set.

## Not done, by choice or by limit

| Item | Why |
| --- | --- |
| PostgreSQL / Neon wiring | The code and schema are portable and the switch is documented step by step, but the runtime is wired to SQLite as requested. Not run against a live Postgres |
| Live S3/R2, QStash, OCR and Resend integrations | Adapters are written and unit-tested where possible; none were exercised against live services |
| Multi-factor authentication | Better Auth supports it; not enabled in this build |
| Real-time updates | Bounded polling is used; the `Realtime` adapter is the plug-in point for a managed provider |
| System dark-mode detection | Theme is an explicit toggle stored in a cookie |
| Subject-access and erasure tooling, retention-period configuration for ballots | Out of scope; see [data-and-retention.md](data-and-retention.md) |
| Independent security review, load test, accessibility audit with automated tools | Not performed |
| Ranked-choice or other counting methods | Plurality only, with ties reported |

## Accounts you will need for production

| Service | Needed for | Required? |
| --- | --- | --- |
| Vercel | Hosting and the daily cron | Yes (or any Node host; adjust scheduling) |
| Neon (or another PostgreSQL) | Durable database | Yes |
| S3-compatible bucket (AWS S3, Cloudflare R2, Supabase) | Roster files and images | Only if you use uploads or images |
| Resend (or another mail provider via a small adapter) | Password reset, email verification | Strongly recommended |
| Upstash QStash | Durable background parsing | Only for PDF/DOCX/image rosters |
| An OCR / document-extraction service | Reading PDFs, Word files and images | Optional, and shares voter data with that provider |

## First things to do on your side

1. Run `npm install`, `npm run setup`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, and click through it.
2. Run the migration drift check in [deployment.md](deployment.md#3-build-and-migrate).
3. Read [threat-model.md](threat-model.md) and decide whether your community's elections fit within it.
4. When ready for Neon, follow [deployment.md](deployment.md#switching-from-sqlite-to-neon-postgresql) on a branch and run
   the post-deploy checklist, including a load test.

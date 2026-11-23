# API reference

The browser app and any other client use the same JSON API under `/api`. There is no separate public API product:
the endpoints are the app's own, documented so you can script against them and review them.

## Conventions

- **Format.** JSON in, JSON out. State-changing requests need `Content-Type: application/json`.
- **Authentication.** Admin endpoints use the Better Auth session cookie (`quorum.session_token`, prefixed `__Secure-` in production;
  HttpOnly, SameSite=Lax, Secure in production, seven-day expiry). Sign-in and sign-up are Better Auth's own endpoints under `/api/auth/*`.
  Public endpoints (`/api/public/*`) need no session; they are capability links plus rate limits.
- **CSRF.** Every state-changing request must carry a trusted `Origin` header (or `Sec-Fetch-Site: same-origin`).
  Other origins get `403 BAD_ORIGIN`, even with a valid session. Cookies alone are never enough.
- **Tenancy.** Objects outside your organizations answer `404 NOT_FOUND`, never `403`, so ids cannot be probed.
- **Caching.** Every `/api` response is `Cache-Control: no-store`.
- **Request id.** Every response carries `X-Request-Id`; quote it when reporting a problem.
- **Dates.** ISO 8601 with an offset (`2026-12-01T09:00:00+01:00`). Stored in UTC; `timezone` on an election is
  display and scheduling context only.
- **Unknown fields are rejected.** Bodies are validated with strict schemas.

### Errors

One shape for every failure:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields need attention.", "requestId": "…", "fields": { "title": "Give the election a title of at least 3 characters." } } }
```

`fields` appears only for validation failures. `RATE_LIMITED` also sets `Retry-After`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No valid session, or a bad cron/queue secret or signature |
| `FORBIDDEN` | 403 | Signed in, but the role is too low (for example, admin attempting an owner-only action) |
| `NOT_FOUND` | 404 | Missing, or not in one of your organizations |
| `VALIDATION_FAILED` | 422 | Body or query rejected; see `fields` |
| `BAD_ORIGIN` | 403 | State-changing request from an untrusted origin |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body was not `application/json` |
| `PAYLOAD_TOO_LARGE` | 413 | Over the endpoint's size cap |
| `RATE_LIMITED` | 429 | Over a limit; wait `Retry-After` seconds |
| `CONFLICT`, `INVALID_STATE` | 409 | The object is not in a state that allows this |
| `ROSTER_FROZEN`, `BALLOT_FROZEN` | 409 | Frozen by the 24-hour rule or by locking |
| `ELECTION_NOT_OPEN` | 409 | Voting has not started or has ended |
| `VERIFICATION_FAILED` | 403 | Details did not match the roster (deliberately generic) |
| `ALREADY_VOTED` | 409 | A ballot was already submitted for this voter or browser |
| `CREDENTIAL_INVALID` | 403 | Voting session expired, spent, or revoked |
| `BALLOT_INVALID` | 422 | Selections do not satisfy the ballot rules |
| `RESULTS_NOT_AVAILABLE` | 403 | The disclosure policy hides this right now |
| `PROVIDER_NOT_CONFIGURED` | 501 | For example, reading a PDF with `OCR_DRIVER=none` |
| `PROVIDER_FAILED` | 502 | Storage, queue, or OCR provider failed |
| `CONFIG_ERROR` | 503 | Feature disabled by configuration (storage, rate limiter) |
| `INTERNAL` | 500 | Unexpected; logged by type only |

### Rate limits

| Preset | Limit | Scope |
| --- | --- | --- |
| Admin read | 300 / minute | per user |
| Admin write | 120 / minute | per user |
| Admin heavy (parse, confirm, export) | 20 / minute | per user |
| Public read | 120 / minute | per client (keyed hash of IP, rotated daily) |
| Verify | `VERIFY_PER_IP_PER_10MIN` (30) / 10 min | per client |
| Verify failures | `VERIFY_FAILS_PER_IDENTITY_PER_15MIN` (6) / 15 min | per claimed identity, whether or not it exists |
| Submit | `SUBMIT_PER_IP_PER_10MIN` (30) / 10 min | per client |
| Open-access credential | `OPEN_ISSUE_PER_IP_PER_HOUR` (10) / hour | per device |
| Auth endpoints | 20 / 10 min | per client |
| Invite accept | 20 / 10 min | per client |

Client identity is the first trusted proxy header only when `TRUST_PROXY_HEADERS` is true (default on Vercel);
otherwise all callers share one bucket (`direct`), which fails safe but is coarse.

---

## Public (no session)

### `GET /api/public/v/:slug`
What anyone with the voting link may see: title, description, organization name, status, window, whether it is
restricted, the verification fields to ask for, banner/logo URLs (short-lived signed), and the results link when it is
public. No ballot, no counts, no roster information. `404` for an unknown or malformed slug.

### `POST /api/public/v/:slug/verify`
```json
{ "values": { "email": "amara@example.org", "member_no": "R-1042" } }
```
Restricted elections: checks the values against the roster, marks the voter checked in, and returns
```json
{ "credential": "…43 chars…", "expiresAt": "…", "ballot": [ { "id", "title", "description", "maxSelections", "allowAbstain", "candidates": [ { "id", "name", "bio", "imageUrl" } ] } ] }
```
A wrong guess always returns the same `VERIFICATION_FAILED` message. Open-access elections ignore `values`, require the
`quorum_device` cookie (set on first contact), and issue a credential if that browser has not voted. A new verification
revokes any earlier unused credential for the same voter.

### `POST /api/public/v/:slug/submit`
```json
{ "credential": "…", "selections": [ { "positionId": "…", "candidateIds": ["…"] } ] }
```
Every position must be present; an empty `candidateIds` means abstain and is allowed only where the position allows it.
Validated before the credential is spent. Returns `{ "ok": true }`. Idempotent in effect: a second submit with the same
credential fails with `CREDENTIAL_INVALID` or `ALREADY_VOTED` and records nothing.

### `GET /api/public/r/:slug/results`
Tallies, or `{ "available": false, "reason": "not_started" | "voting_open" | "awaiting_publication", "election": {…} }`.
Status is `200` in both cases; clients branch on `available`.

### `GET /api/public/r/:slug/analytics`
Post-election analytics under the same gate. `groups` is always `null` here.

### `GET /api/health`
`{ "ok": true }`. Reveals nothing about configuration.

---

## Organizations and members

| Method and path | Role | Body | Notes |
| --- | --- | --- | --- |
| `GET /api/orgs` | any member | | Your organizations |
| `POST /api/orgs` | signed in | `{ name, description? }` | Creator becomes owner |
| `GET /api/orgs/:orgId` | member | | Members, elections, pending invites (owners only) |
| `POST /api/orgs/:orgId/invites` | owner | `{ email?, role }` | Returns the invite link **once**; only a keyed hash is stored. Valid for 7 days |
| `DELETE /api/orgs/:orgId/invites/:inviteId` | owner | | Revoke |
| `POST /api/invites/accept` | signed in | `{ token }` | Joins the organization with the invited role |
| `DELETE /api/orgs/:orgId/members/:userId` | owner, or yourself | | The last owner cannot be removed |

## Elections

| Method and path | Role | Body | Notes |
| --- | --- | --- | --- |
| `POST /api/orgs/:orgId/elections` | admin | `{ title, description?, timezone?, eligibilityMode?, verificationFields? }` | Creates a draft |
| `GET /api/elections/:id` | admin | | Election, ballot, readiness problems, links, roster stats |
| `PATCH /api/elections/:id` | admin (owner for `resultsDisclosure`, `autoPublish`, `tieRule`) | any of: `title`, `description`, `timezone`, `startsAt`, `endsAt`, `eligibilityMode`, `verificationFields`, `credentialTtlSeconds`, `bannerUploadId`, `logoUploadId` | Mode and fields cannot change once voters are imported or the roster is frozen |
| `DELETE /api/elections/:id` | admin | | Drafts only |
| `POST /api/elections/:id/transition` | admin (owner for `publish`) | `{ action: "schedule" \| "unschedule" \| "open" \| "close" \| "publish", endsAt? }` | Server checks readiness: ballot valid, window sane, roster present and frozen correctly |
| `POST /api/elections/:id/extend` | admin | `{ endsAt }` | Open elections only; can only move the end later |
| `POST /api/elections/:id/rotate-links` | owner | `{ which: "voter" \| "results" \| "both" }` | Old links stop working immediately; not allowed after voting has closed |

## Ballot

| Method and path | Body |
| --- | --- |
| `POST /api/elections/:id/positions` | `{ title, description?, maxSelections?, seats?, allowAbstain? }` |
| `PATCH` / `DELETE /api/positions/:positionId` | same fields, optional |
| `POST /api/elections/:id/positions/reorder` | `{ ids: [positionId…] }` |
| `POST /api/positions/:positionId/candidates` | `{ name, bio?, imageUploadId? }` |
| `PATCH` / `DELETE /api/candidates/:candidateId` | same fields, optional |
| `POST /api/positions/:positionId/candidates/reorder` | `{ ids: [candidateId…] }` |
| `POST /api/candidates/:candidateId/correct` | `{ name?, bio?, reason }`: audited text correction after the ballot is locked |

Ballot structure (positions, candidates, seats, selections) is editable only before the start time. After that, only
text corrections with a stated reason, each recorded in the audit log.

## Images

1. `POST /api/elections/:id/assets` with `{ kind: "BANNER" | "LOGO" | "CANDIDATE_IMAGE", filename, contentType, size, idempotencyKey? }`
   returns `{ uploadId, target: { url, method: "PUT", headers, expiresAt } }`.
2. `PUT` the bytes to `target.url` with `target.headers`.
3. `POST /api/elections/:id/assets/:uploadId/finalize` verifies size and magic bytes and marks the upload usable.
   Then attach it: pass the `uploadId` as `imageUploadId` on a candidate, or as `bannerUploadId` / `logoUploadId` in
   `PATCH /api/elections/:id`.

PNG or JPEG, up to `MAX_IMAGE_BYTES`. A file whose bytes do not match its claimed type is rejected and deleted.

## Voter list

See [roster-ingestion.md](roster-ingestion.md) for the workflow. Endpoints:

| Method and path | Notes |
| --- | --- |
| `GET /api/elections/:id/voters?page=&q=` | Roster page; labels only, never identifiers |
| `DELETE /api/elections/:id/voters/:voterId` | Rejected once frozen |
| `GET /api/elections/:id/imports` | Import history (counts only) |
| `POST /api/elections/:id/imports` | `{ filename, contentType, size, idempotencyKey? }` → upload target (same three-step flow as images) |
| `POST /api/elections/:id/imports/manual` | `{ csv }` pasted text; no upload needed |
| `POST /api/elections/:id/imports/:importId/finalize` | Verify the upload |
| `POST /api/elections/:id/imports/:importId/parse` | Inline, or queued when `JOB_DRIVER=qstash` |
| `GET /api/elections/:id/imports/:importId` | Status, detected columns, mapping, stats |
| `PUT /api/elections/:id/imports/:importId/mapping` | `{ mapping: { email: "Email address", __label: "Name", __group: "Class" } }` |
| `GET` / `POST /api/elections/:id/imports/:importId/rows` | List (`?page=&status=`) or add a row (`{ cells }`) |
| `PATCH /api/elections/:id/imports/:importId/rows/:rowId` | `{ cells }` correct a staged row |
| `POST /api/elections/:id/imports/:importId/rows/:rowId/resolve` | `{ action: "KEEP" \| "SKIP" \| "CLEAR" }` |
| `POST /api/elections/:id/imports/:importId/confirm` | Writes the roster; idempotent; blocked while errors remain |
| `POST /api/elections/:id/imports/:importId/reject` | Discards staged rows |

All roster writes return `409 ROSTER_FROZEN` from 24 hours before the start time (or once voting is open).

## Turnout, results, analytics, export, audit

| Method and path | Available when |
| --- | --- |
| `GET /api/elections/:id/turnout` | Always (participation only, never choices) |
| `GET /api/elections/:id/roll-call?page=&q=&state=` | Restricted elections; `state` is `NOT_VOTED`, `VERIFIED` or `VOTED` |
| `GET /api/elections/:id/results` | Per the disclosure rules; otherwise `{ available: false, reason }` |
| `GET /api/elections/:id/analytics` | Closed or published, under the same gate; includes group turnout |
| `GET /api/elections/:id/report?format=csv\|json` | Results visible; audited; spreadsheet formulas neutralized |
| `GET /api/elections/:id/audit?cursor=` | Administrative events, newest first |

## Infrastructure endpoints

| Path | Auth | Purpose |
| --- | --- | --- |
| `GET`/`POST /api/jobs/sweep` | `Authorization: Bearer $CRON_SECRET` | Daily housekeeping; safe to call any time |
| `POST /api/jobs/run` | QStash signature | Delivers `roster.parse` jobs; idempotent |
| `GET`/`PUT /api/storage/local` | HMAC-signed, expiring URL | Development storage only; refused in production |
| `ALL /api/auth/*` | Better Auth | Sign-up, sign-in, sign-out, password reset |

## Audit events

Administrative actions only. Voting writes no audit rows, and audit metadata never contains selections, tokens,
credentials or roster values (the writer drops any key that looks like one).

`org.created`, `member.invited`, `member.joined`, `member.removed`, `election.created`, `election.updated`,
`election.rescheduled`, `election.scheduled`, `election.unscheduled`, `election.opened`, `election.closed`,
`election.extended`, `election.published`, `election.deleted`, `election.links_rotated`, `ballot.position_added`,
`ballot.position_updated`, `ballot.position_removed`, `ballot.candidate_added`, `ballot.candidate_updated`,
`ballot.candidate_removed`, `ballot.candidate_text_corrected`, `roster.upload_requested`, `roster.upload_finalized`,
`roster.parse_started`, `roster.parse_completed`, `roster.parse_failed`, `roster.row_corrected`, `roster.row_resolved`,
`roster.mapping_saved`, `roster.import_confirmed`, `roster.import_rejected`, `roster.voter_removed`, `roster.frozen`,
`report.downloaded`, `system.sweep`.

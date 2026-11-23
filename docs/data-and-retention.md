# Data and retention

What Quorum stores, in what form, who can read it, and when it goes away. "Retention" below means what the
application does by itself. Backups and logs kept by your database or hosting provider follow their own rules.

## Inventory

| Data | Table | Form at rest | Readable by | Removed |
| --- | --- | --- | --- | --- |
| Account (name, email, password hash) | `User`, `Account` | Password hashed with scrypt by Better Auth | The account holder | Not automatically |
| Sessions | `Session` | Opaque token, IP and user agent as reported | Account holder (via the app) | Expired rows swept daily |
| Reset / verification tokens | `Verification` | Opaque | Nobody via the app | Expired rows swept daily |
| Organization, memberships | `Organization`, `Membership` | Plain | Members | With the organization |
| Invitations | `Invitation` | Keyed hash of the token; optional email | Owners (pending list) | Expire after 7 days; rows remain |
| Election settings, ballot structure | `Election`, `Position`, `Candidate` | Plain | Admins; voters see the ballot when voting | With the election (drafts only can be deleted) |
| Images (banner, logo, candidate) | `Upload` + object storage | Private objects; signed URLs | Admins; voters via short-lived URLs | Deleted with a draft election; an image you replace stays in storage, unreferenced |
| Voter eligibility | `EligibleVoter` | HMAC lookup keys; label sealed (AES-GCM); group label plain | Admins see labels and groups (roll call) | Life of the election |
| Raw roster file | Object storage | As uploaded | Server only | At confirm or reject; 24 h at the latest |
| Staged roster rows | `RosterImportRow` | AES-GCM sealed per row | Server only; admins see them in review (PIN masked) | At confirm or reject; 24 h at the latest |
| Import metadata | `RosterImport` | Counts, column names, file name | Admins | Life of the election |
| Attendance | `Attendance` | State plus hour-truncated times | Admins (as the roll-call state) | Life of the election |
| Voting credentials | `VotingCredential` | Keyed hash only; hour-truncated consumption | Nobody via the app | See below |
| Open-access device marks | `OpenAccessMark` | Keyed hash of a random cookie value, per election | Nobody via the app | Life of the election |
| Ballots | `Ballot`, `BallotSelection` | Plain, random ids, no time or voter reference | Aggregates only, per the disclosure policy | Never by the app |
| Audit events | `AuditEvent` | Plain, restricted metadata keys | Admins | Never by the app |
| Rate-limit counters | `RateLimitBucket` | Keyed hash of IP (rotated daily) or identity, counts | Nobody | After two days |

## Retention rules

| Rule | Default | Setting |
| --- | --- | --- |
| Unused or expired voting credentials, revoked credentials | Deleted 24 h after expiry or revocation | `CREDENTIAL_RETENTION_HOURS` |
| Consumed credentials, **restricted** elections | Deleted 24 h after consumption (the same hour is kept on the attendance row) | same |
| Consumed credentials, **open-access** elections | **Kept**: they are the only source of the turnout-over-time chart and carry no identity | not configurable |
| Raw roster files and staged rows of abandoned imports | Scrubbed after 24 h | `RAW_UPLOAD_RETENTION_HOURS` |
| Stuck parse jobs | Marked failed after 15 minutes | fixed |
| Expired upload slots | Deleted by the sweeper | fixed |
| Rate-limit counters | Deleted after 2 days | fixed |
| Expired sessions and tokens | Deleted by the sweeper | fixed |

The sweeper runs daily (`vercel.json` cron → `/api/jobs/sweep`) and can be called at any time with the cron secret. It
is idempotent, each step is isolated, and **correctness never depends on it**: election deadlines, the roster freeze,
credential expiry and import limits are enforced at request time.

## What is kept after an election, and why

- **Ballots and selections** stay so results and analytics remain reproducible. They hold no voter identity or time.
- **Audit events** stay as the administrative record. They hold no choices, tokens or roster values.
- **The roster and attendance** stay so the roll call and group turnout remain available after the vote. If you do not
  want a permanent "who voted" record, export what you need and delete the election's roster out-of-band (see below).

## What the application does not do

There is no in-app "delete this finished election" and no subject-access or erasure tooling. Ballots and audit events
are append-only at the database (triggers on SQLite, role grants and triggers on PostgreSQL), so deleting them is a
deliberate out-of-band operation that a database owner performs on purpose:

1. Take a backup and note who authorized the deletion.
2. Drop the append-only trigger for the table, delete, recreate the trigger (SQLite), or run the delete as the table
   owner role rather than the application role (PostgreSQL).
3. Record what was deleted and why, outside the system being modified.

If you must support erasure requests or fixed retention periods, plan that process before the first election, and
tell voters what will and will not be deleted.

## Exports

`GET /api/elections/:id/report?format=csv|json` produces per-candidate and per-position totals, abstentions, turnout
and the counting method. It contains **no voter information and no per-ballot rows**, neutralizes spreadsheet
formulas, and records a `report.downloaded` audit event. It is available only when results are visible to the caller.

## Where data travels

| To | What | When |
| --- | --- | --- |
| Your database | Everything above | Always |
| Object storage (S3-compatible) | Raw roster files and images | Only with `STORAGE_DRIVER=s3` |
| OCR endpoint | Whole roster documents | Only with `OCR_DRIVER=http` |
| QStash | An import id | Only with `JOB_DRIVER=qstash` |
| Resend | Invite, reset and verification emails (recipient addresses) | Only with `MAIL_DRIVER=resend` |
| Browser | The ballot (no counts), signed image URLs, results per the disclosure policy | On request |

Nothing is sent to analytics, advertising, or tracking services. The app sets only functional cookies: the session
cookie, the `theme` cookie, and (open-access elections only) the `quorum_device` cookie.

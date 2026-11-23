# Threat model and privacy limits

This document says what Quorum protects, from whom, and just as importantly what it does not. If a sentence here
conflicts with a marketing claim anywhere else, this document is the one that is meant to be accurate.

## Scope and honest positioning

**Intended use:** elections inside a community that trusts its administrators to run a fair process: clubs,
societies, student unions, co-ops, associations, internal polls.

**Not intended for:** public-office elections, anything regulated by election law, or any vote where participants
must be able to *prove* the outcome to a hostile audience. Quorum is **not certified**, has had **no independent
security audit**, and is **not an end-to-end verifiable system**. The trust model is closer to a well-run paper ballot
box than to a cryptographic voting protocol: you trust the people running the box and the room it sits in.

## What is being protected

| Asset | Why it matters |
| --- | --- |
| Ballot contents | Choices must not be linkable to voters |
| Participation records | Who voted is sensitive (and visible to admins by design; see below) |
| Roster identity data | Emails, member numbers and PINs are the keys to voting |
| Eligibility | Only listed people vote, once each |
| Result integrity | Counted ballots equal cast ballots; nobody can quietly edit history |
| Admin accounts | An admin can open, close and publish an election |
| Availability | Voting must work inside the window |

## Actors

| Actor | Assumed capability |
| --- | --- |
| Anonymous internet user | Can reach public pages and endpoints, guess links, script requests |
| Voter | Holds roster details; may try to vote twice or probe the roster |
| Link holder who is not on the roster | Has the voting link but no valid details |
| Admin (organization member) | Can run elections in their organization, see turnout and roll call, see results when allowed |
| Owner | Admin plus publish, disclosure policy, link rotation, members |
| Other tenant's admin | Authenticated, hostile to your data |
| Platform operator | Whoever deploys and hosts it: access to the database, logs, secrets, and the ability to change code |
| Third-party processors | Host, database, object storage, queue, OCR, mail provider |

## What is implemented, by threat

### Ballot linkage (who voted for what)

- `Ballot` and `BallotSelection` carry **no** voter, roster, attendance, credential or token reference, and **no
  timestamp**. Their ids are random UUIDs, not time-ordered. A test inspects the stored columns of both tables for anything resembling a voter, credential, user or time reference, and checks that ids are random UUIDs.
- Attendance and credential times are **truncated to the hour**. Replay prevention needs "consumed", not "when".
- Casting is one transaction: the credential is spent, attendance is marked, and the ballot is inserted together or
  not at all. Nothing is written in between that could pair them.
- Voting writes **no audit rows** and no per-request application logs. Audit events cover administrative actions only
  and never contain selections, tokens, credentials or roster values.
- Application logs are structured and redact by key (token, email, label, credential, selection, and more). Request
  bodies are never logged.
- Public pages send `no-referrer`, `noindex`, and `Cache-Control: no-store` on every API response.

### Eligibility and double voting

- Verification identifiers are never stored. The roster holds HMAC-SHA256 keys under a key derived from `APP_SECRET`.
- A failed verification always returns the same message, and the failure budget is per claimed identity, counted
  whether or not that identity exists, so the throttle does not reveal who is on the roster.
- One credential per voter at a time; a new verification revokes the previous one. Credentials are random 256-bit
  values, stored only as HMACs, single-use, short-lived (default 15 minutes, configurable 2 to 60).
- Double submission is prevented by compare-and-swap writes and unique constraints, not by checking first (see
  [architecture.md](architecture.md#concurrency)). Twenty simultaneous submits of one credential record one ballot.

### Roster handling

- Staged rows are sealed with AES-256-GCM, bound to their import and row index, and wiped at confirm or reject; the
  raw file is deleted at the same moment. A daily sweep removes anything abandoned after 24 hours.
- The 24-hour freeze is enforced inside the write transaction, so a request racing the freeze instant cannot slip in.
- Look-alike and duplicate rows need a human decision; they are never merged or dropped silently.

### Tenancy and access control

- Access to organizations, elections, positions, candidates and imports is derived from the caller's memberships in
  the same query that loads the object. A client-supplied id is never proof of access. Cross-tenant ids answer 404.
- A test walks every admin read and write route against another tenant's ids.
- Owner-only actions (publish, disclosure, tie rule, auto-publish, link rotation, members, invites) are enforced on
  the server.
- Invite links are random, shown once, stored as keyed hashes, expire after seven days, and (when addressed to an
  email) only that signed-in email can accept them.

### Web application

- **CSRF.** State-changing requests require a trusted `Origin` (or same-origin fetch metadata); session cookies are
  `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- **XSS.** React escapes all output; the codebase contains no `dangerouslySetInnerHTML`. A per-request nonce
  Content-Security-Policy allows scripts only with that nonce (`strict-dynamic`), no inline script, no `eval` in
  production, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, and `img-src`/`connect-src`
  restricted to self (plus your storage origin when `STORAGE_DRIVER=s3`).
- **Other headers.** HSTS (two years, includeSubDomains), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  strict `Referrer-Policy`, `Permissions-Policy` disabling camera, microphone, geolocation, payment and USB,
  `Cross-Origin-Opener-Policy: same-origin`.
- **Injection.** Prisma parameterizes all queries. The single raw SQL statement (rate-limit upsert) uses tagged-template
  parameters. Every request body and query is validated with strict Zod schemas.
- **Uploads.** Private storage only. Uploads go to short-lived signed `PUT` targets. After upload the server checks
  size against what was declared and the leading magic bytes against the claimed type, and deletes mismatches.
  Roster files are parsed as data, never executed or rendered.
- **Spreadsheet injection.** CSV and JSON exports neutralize cells that would be read as formulas.
- **Errors.** One response shape; unexpected errors return a generic message plus a request id; stack traces and driver
  messages are never returned.
- **Configuration.** Fails closed. In production the app refuses to start with missing or placeholder secrets, SQLite
  on a serverless host, local-disk storage, or a memory rate limiter. With the rate limiter disabled, limited
  endpoints answer 503 instead of running unprotected.
- **Authentication** is delegated to Better Auth (scrypt password hashing, session handling). Minimum password length
  is 10. Sign-in endpoints are rate limited.

### Cryptography

Only `node:crypto`, used in standard ways: HKDF-SHA256 for subkeys per purpose, HMAC-SHA256 for lookups and token
hashes (length-prefixed encoding so field boundaries cannot collide), AES-256-GCM with random 96-bit IVs and
context-bound AAD, and constant-time comparison for secrets. There is no custom cipher, MAC, or voting protocol.

## What is NOT protected (read this part)

1. **A malicious operator can defeat ballot secrecy and result integrity.** Anyone with database access, hosting
   access, or the ability to deploy code can read ballots, read the roll call, modify rows, drop the append-only
   triggers, restore an altered backup, or ship altered code. Append-only guards stop bugs and injected queries, not
   a privileged insider. There is no signed or hash-chained audit log and no external anchor, so tampering is not
   *detectable* after the fact either.

2. **Residual ballot-to-voter correlation exists.** The design removes every deliberate link, but an operator who can
   see more than the application exposes can try to rebuild one from:
   - physical row order (insertion order in table files, write-ahead logs, replicas, or backups) compared with the
     order in which attendance rows were updated;
   - hour-level `votedHour` / `consumedAt` against low turnout (if one person voted in an hour, the hour is theirs);
   - platform request logs and database query logs, which record the verify and submit calls with IP and timestamp;
   - very small electorates, where the tally itself can be revealing (a 3-person election with a unanimous result).
   These are reduced by truncation, random ids and no timestamps on ballots. They are not eliminated.

3. **No verifiability.** A voter cannot check that their ballot was counted or counted as cast, and an observer cannot
   check the tally. Voters must trust the administrators and the operator.

4. **No coercion or vote-buying resistance.** Voting happens on the voter's own device. A voter can show their screen
   to someone, and the review step displays their choices.

5. **Administrators can see who voted.** The roll call lists each roster entry as not voted, verified (checked in but
   not yet submitted), or voted. It never shows choices or per-person times. The interface says so. If your community
   expects a fully secret *participation* record, do not share roll-call access beyond the people who need it.

6. **An administrator who supplied the roster can impersonate a voter who has not yet voted.** They know each voter's
   verification values because they imported them. They cannot be *prevented* from using them. What exists: the real
   voter later sees "already voted", the roll call and turnout counts would not match expectations, and the freeze
   stops late additions. For higher assurance, distribute secrets to voters out-of-band so admins do not hold them
   (for example, a PIN column generated and mailed by a third party and imported by hash, which needs a custom step this
   build does not provide).

7. **Weak verification fields are weak.** Anyone who knows a voter's email and member number can vote as them until
   that voter does. Pick fields that are not guessable by other people in your community. The per-identity throttle
   limits guessing; it also means an attacker who knows only someone's email can burn that person's failure budget
   (6 failed tries per 15 minutes) and briefly stop them from verifying. That is a deliberate tradeoff, and it stays
   in effect only while the attacker keeps trying.

8. **Roster membership can be probed through timing.** Failure responses are identical, but a successful lookup does
   more database work than a failed one, so response time may differ slightly. Rate limits make large-scale probing
   expensive; they do not make it impossible.

9. **Open-access elections are not one-person-one-vote.** The guard is a random browser cookie (hashed per election).
   Clearing cookies or switching browsers gets another ballot, limited only by the submit rate limit per client. Use
   open access for informal polls, never for anything where the count matters.

10. **Leaked links.** The voting link is a capability: anyone holding it can attempt verification. Links are random,
    unlisted, `noindex`, and can be rotated by an owner before voting closes; they are not secret in the way a password
    is. The results link is gated by the disclosure policy, not by secrecy.

11. **No multi-factor authentication** for admin accounts in this build, and no device/session management screen.
    Better Auth supports two-factor authentication; enabling it is a recommended next step. Without a mail provider
    there is no password reset and no email verification, so anyone can register with any address (they still see
    nothing outside organizations they are invited to).

12. **Aggregate privacy at small scale.** Group turnout hides groups smaller than five (they are combined) and is
    admin-only. There is no per-group result breakdown. Tallies themselves are not noised or suppressed.

13. **Denial of service.** Rate limits and `no-store` protect against casual abuse. A determined flood is a hosting
    problem (use your host's DDoS protection). The election row is a hot row on PostgreSQL; run a load test.

14. **Third parties see data.** The host and database see everything the app does. Object storage holds raw roster
    files for up to 24 hours. If `OCR_DRIVER=http`, the OCR provider receives whole roster documents. QStash receives
    only an import id. Resend receives invite and reset emails. Check each provider's retention and location terms and
    tell your voters which ones are in use.

15. **Secret loss or leak.** Anyone who gets both a database copy and `APP_SECRET` can test guesses against roster
    lookup keys and decrypt sealed labels. Rotating `APP_SECRET` invalidates roster lookups and labels; do it only
    between elections.

16. **Supply chain.** Dependencies are pinned by lockfile, and the app uses well-known maintained libraries for
    authentication, ORM, validation and parsing. No dependency audit, SBOM, or provenance check was performed as part
    of this build; run `npm audit` and your own review before production.

17. **Data protection law.** Quorum stores personal data. It has retention rules (see
    [data-and-retention.md](data-and-retention.md)) but no built-in subject-access, erasure or consent tooling.
    Compliance is the deploying organization's responsibility.

## Verification status of this build

| Claim | Evidence | Gap |
| --- | --- | --- |
| Credential cannot be spent twice, and one voter cannot vote twice, under concurrent requests | Tests with 20 parallel submits and racing verifications | Run on SQLite (one synchronous writer); PostgreSQL contention not tested |
| Ballots carry no voter/time link | Test inspects the table columns of `Ballot` and `BallotSelection` and the id format | Does not cover physical storage order, write-ahead logs or backups |
| Append-only audit and ballots | Test proves UPDATE/DELETE are rejected | Postgres grants and triggers are written but were not run against a live Postgres |
| Tenant isolation | Test across every admin route | Authorization logic in pages relies on the same domain functions; no fuzzing |
| Results gated by disclosure policy | Tests walk both policies through the lifecycle for admin and public audiences, including that hidden payloads carry no counts | None known |
| Fails closed on bad configuration | Tests on `loadEnv` and the limiter | None known |
| Storage, queue, OCR, mail adapters | Local storage (signed URLs, size and type limits, no overwrite) and job-signature rejection are tested | S3, QStash delivery, OCR and Resend were not exercised against live services |

## Reporting a vulnerability

Add your own contact and disclosure policy to the deployment (for example a `security.txt`). This repository does not
ship one because it cannot know who operates your instance.

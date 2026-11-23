-- Append-only guards (SQLite).
--
-- Ordinary application code only INSERTs into these tables. These triggers make UPDATE and DELETE
-- fail at the database too, so a bug or injected query in the app cannot rewrite audit history or
-- submitted ballots. This is the SQLite counterpart of `REVOKE UPDATE, DELETE` on Postgres
-- (see prisma/postgres/append-only.sql).
--
-- They are NOT tamper-proof: anyone with write access to the database file can DROP a trigger.
-- Retention purges are deliberate out-of-band operations (see docs/threat-model.md).
--
-- NOTE: Prisma redefines tables on some SQLite schema changes, which silently drops triggers.
-- `npm run db:migrate` and the test-suite verify these guards exist after every migration.

CREATE TRIGGER "AuditEvent_append_only_update" BEFORE UPDATE ON "AuditEvent"
BEGIN SELECT RAISE(ABORT, 'AuditEvent is append-only'); END;

CREATE TRIGGER "AuditEvent_append_only_delete" BEFORE DELETE ON "AuditEvent"
BEGIN SELECT RAISE(ABORT, 'AuditEvent is append-only'); END;

CREATE TRIGGER "Ballot_append_only_update" BEFORE UPDATE ON "Ballot"
BEGIN SELECT RAISE(ABORT, 'Ballot is append-only'); END;

CREATE TRIGGER "Ballot_append_only_delete" BEFORE DELETE ON "Ballot"
BEGIN SELECT RAISE(ABORT, 'Ballot is append-only'); END;

CREATE TRIGGER "BallotSelection_append_only_update" BEFORE UPDATE ON "BallotSelection"
BEGIN SELECT RAISE(ABORT, 'BallotSelection is append-only'); END;

CREATE TRIGGER "BallotSelection_append_only_delete" BEFORE DELETE ON "BallotSelection"
BEGIN SELECT RAISE(ABORT, 'BallotSelection is append-only'); END;

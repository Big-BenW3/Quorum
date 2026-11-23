-- Append-only guards for PostgreSQL / Neon. Apply ONCE after `prisma migrate deploy`.
--
-- 1) Preferred: run the app as a role that cannot UPDATE/DELETE these tables.
--      CREATE ROLE quorum_app LOGIN PASSWORD '...';          -- use the pooled connection string for this role
--      GRANT USAGE ON SCHEMA public TO quorum_app;
--      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quorum_app;
--      REVOKE UPDATE, DELETE ON "AuditEvent", "Ballot", "BallotSelection" FROM quorum_app;
--    Run migrations with a separate owner role (DIRECT_URL), never with quorum_app.
--
-- 2) Defence in depth: triggers that also stop the table owner by accident.
CREATE OR REPLACE FUNCTION quorum_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuditEvent_append_only" ON "AuditEvent";
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

DROP TRIGGER IF EXISTS "Ballot_append_only" ON "Ballot";
CREATE TRIGGER "Ballot_append_only" BEFORE UPDATE OR DELETE ON "Ballot"
  FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

DROP TRIGGER IF EXISTS "BallotSelection_append_only" ON "BallotSelection";
CREATE TRIGGER "BallotSelection_append_only" BEFORE UPDATE OR DELETE ON "BallotSelection"
  FOR EACH ROW EXECUTE FUNCTION quorum_append_only();

-- Tamper-evidence note: neither measure makes rows cryptographically immutable. A privileged
-- operator can drop triggers or restore a modified backup. See docs/threat-model.md.

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "refreshTokenExpiresAt" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Election" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "bannerUploadId" TEXT,
    "logoUploadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "eligibilityMode" TEXT NOT NULL DEFAULT 'RESTRICTED',
    "verificationFields" JSONB NOT NULL,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "rosterFreezeAt" DATETIME,
    "rosterFrozenAt" DATETIME,
    "resultsDisclosure" TEXT NOT NULL DEFAULT 'AFTER_CLOSE',
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "tieRule" TEXT NOT NULL DEFAULT 'REPORT_TIE',
    "credentialTtlSeconds" INTEGER NOT NULL DEFAULT 900,
    "voterSlug" TEXT NOT NULL,
    "resultsSlug" TEXT NOT NULL,
    "openedAt" DATETIME,
    "closedAt" DATETIME,
    "publishedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Election_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "allowAbstain" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Position_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "imageUploadId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Candidate_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "actualSize" INTEGER,
    "sha256" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Upload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosterImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "uploadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "sourceKind" TEXT NOT NULL,
    "originalName" TEXT,
    "extractor" TEXT,
    "columns" JSONB NOT NULL,
    "mapping" JSONB,
    "stats" JSONB,
    "errorCode" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parseStartedAt" DATETIME,
    "parsedAt" DATETIME,
    "confirmedAt" DATETIME,
    "purgedAt" DATETIME,
    CONSTRAINT "RosterImport_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RosterImport_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RosterImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "payloadSealed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "issues" JSONB NOT NULL,
    "confidence" REAL,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RosterImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EligibleVoter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "primaryKey" TEXT NOT NULL,
    "labelSealed" TEXT NOT NULL,
    "groupLabel" TEXT,
    "importId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EligibleVoter_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "eligibleVoterId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CHECKED_IN',
    "checkedInHour" DATETIME NOT NULL,
    "votedHour" DATETIME,
    CONSTRAINT "Attendance_eligibleVoterId_fkey" FOREIGN KEY ("eligibleVoterId") REFERENCES "EligibleVoter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VotingCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    "attendanceId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VotingCredential_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VotingCredential_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OpenAccessMark" (
    "electionId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("electionId", "deviceHash"),
    CONSTRAINT "OpenAccessMark_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "electionId" TEXT NOT NULL,
    CONSTRAINT "Ballot_electionId_fkey" FOREIGN KEY ("electionId") REFERENCES "Election" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BallotSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ballotId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "candidateId" TEXT,
    CONSTRAINT "BallotSelection_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BallotSelection_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "electionId" TEXT,
    "actorId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    PRIMARY KEY ("key", "windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Election_organizationId_status_idx" ON "Election"("organizationId", "status");
CREATE INDEX "Election_status_startsAt_idx" ON "Election"("status", "startsAt");
CREATE INDEX "Election_status_endsAt_idx" ON "Election"("status", "endsAt");
CREATE UNIQUE INDEX "Election_voterSlug_key" ON "Election"("voterSlug");
CREATE UNIQUE INDEX "Election_resultsSlug_key" ON "Election"("resultsSlug");
CREATE INDEX "Position_electionId_sortOrder_idx" ON "Position"("electionId", "sortOrder");
CREATE INDEX "Candidate_positionId_sortOrder_idx" ON "Candidate"("positionId", "sortOrder");
CREATE INDEX "Upload_organizationId_idx" ON "Upload"("organizationId");
CREATE INDEX "Upload_electionId_kind_idx" ON "Upload"("electionId", "kind");
CREATE INDEX "Upload_status_expiresAt_idx" ON "Upload"("status", "expiresAt");
CREATE UNIQUE INDEX "Upload_objectKey_key" ON "Upload"("objectKey");
CREATE UNIQUE INDEX "RosterImport_electionId_idempotencyKey_key" ON "RosterImport"("electionId", "idempotencyKey");
CREATE INDEX "RosterImport_electionId_status_idx" ON "RosterImport"("electionId", "status");
CREATE UNIQUE INDEX "RosterImportRow_importId_rowIndex_key" ON "RosterImportRow"("importId", "rowIndex");
CREATE INDEX "RosterImportRow_importId_status_idx" ON "RosterImportRow"("importId", "status");
CREATE UNIQUE INDEX "EligibleVoter_electionId_lookupKey_key" ON "EligibleVoter"("electionId", "lookupKey");
CREATE INDEX "EligibleVoter_electionId_primaryKey_idx" ON "EligibleVoter"("electionId", "primaryKey");
CREATE INDEX "Attendance_electionId_state_idx" ON "Attendance"("electionId", "state");
CREATE UNIQUE INDEX "Attendance_eligibleVoterId_key" ON "Attendance"("eligibleVoterId");
CREATE INDEX "VotingCredential_electionId_expiresAt_idx" ON "VotingCredential"("electionId", "expiresAt");
CREATE INDEX "VotingCredential_attendanceId_idx" ON "VotingCredential"("attendanceId");
CREATE UNIQUE INDEX "VotingCredential_tokenHash_key" ON "VotingCredential"("tokenHash");
CREATE INDEX "Ballot_electionId_idx" ON "Ballot"("electionId");
CREATE UNIQUE INDEX "BallotSelection_ballotId_positionId_candidateId_key" ON "BallotSelection"("ballotId", "positionId", "candidateId");
CREATE INDEX "BallotSelection_positionId_candidateId_idx" ON "BallotSelection"("positionId", "candidateId");
CREATE INDEX "AuditEvent_electionId_createdAt_idx" ON "AuditEvent"("electionId", "createdAt");
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

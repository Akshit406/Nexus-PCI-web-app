-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "dbaName" TEXT,
    "businessType" TEXT NOT NULL,
    "website" TEXT,
    "taxId" TEXT,
    "postalAddress" TEXT,
    "fiscalAddress" TEXT,
    "primaryContactName" TEXT,
    "primaryContactTitle" TEXT,
    "primaryContactEmail" TEXT,
    "primaryContactPhone" TEXT,
    "adminContactName" TEXT,
    "adminContactEmail" TEXT,
    "adminContactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SAQ_ASSIGNMENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ClientUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutiveClientAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executiveUserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ExecutiveClientAssignment_executiveUserId_fkey" FOREIGN KEY ("executiveUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ExecutiveClientAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaqType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "templateVersion" TEXT,
    "effectiveDate" DATETIME,
    "sourceDocument" TEXT,
    "supportsNotTested" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "PciTopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "PciRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requirementCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "testingProcedures" TEXT,
    "topicId" TEXT NOT NULL,
    "requirementVersion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PciRequirement_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "PciTopic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaqRequirementMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saqTypeId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "requiresCcwJustification" BOOLEAN NOT NULL DEFAULT true,
    "requiresNaJustification" BOOLEAN NOT NULL DEFAULT true,
    "allowNotTested" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mappingVersion" TEXT NOT NULL DEFAULT 'phase1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SaqRequirementMap_saqTypeId_fkey" FOREIGN KEY ("saqTypeId") REFERENCES "SaqType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaqRequirementMap_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PciRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "saqTypeId" TEXT NOT NULL,
    "cycleYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startedAt" DATETIME,
    "finalizedAt" DATETIME,
    "issuedAt" DATETIME,
    "validUntil" DATETIME,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lastViewedTopicCode" TEXT,
    "preloadedFromCertificationId" TEXT,
    "templateVersionSnapshot" TEXT,
    "mappingVersionSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Certification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Certification_saqTypeId_fkey" FOREIGN KEY ("saqTypeId") REFERENCES "SaqType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Certification_preloadedFromCertificationId_fkey" FOREIGN KEY ("preloadedFromCertificationId") REFERENCES "Certification" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CertificationAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "certificationId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "answerValue" TEXT NOT NULL,
    "isPreloaded" BOOLEAN NOT NULL DEFAULT false,
    "preloadedFromAnswerId" TEXT,
    "explanation" TEXT,
    "resolutionDate" DATETIME,
    "answeredByUserId" TEXT,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CertificationAnswer_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CertificationAnswer_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "PciRequirement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CertificationAnswer_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerJustification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "certificationAnswerId" TEXT NOT NULL,
    "justificationType" TEXT NOT NULL,
    "title" TEXT,
    "details" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnswerJustification_certificationAnswerId_fkey" FOREIGN KEY ("certificationAnswerId") REFERENCES "CertificationAnswer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "imageDataUrl" TEXT NOT NULL,
    "signatureType" TEXT NOT NULL DEFAULT 'upload',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Signature_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Signature_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentStatus_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentStatus_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentStatus_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DashboardMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "certificationId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'INFO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DashboardMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DashboardMessage_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "roleCode" TEXT,
    "actionType" TEXT NOT NULL,
    "targetTable" TEXT,
    "targetId" TEXT,
    "clientId" TEXT,
    "certificationId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ClientUser_clientId_userId_key" ON "ClientUser"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutiveClientAssignment_executiveUserId_clientId_isActive_key" ON "ExecutiveClientAssignment"("executiveUserId", "clientId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SaqType_code_key" ON "SaqType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PciTopic_code_key" ON "PciTopic"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PciRequirement_requirementCode_key" ON "PciRequirement"("requirementCode");

-- CreateIndex
CREATE UNIQUE INDEX "SaqRequirementMap_saqTypeId_requirementId_key" ON "SaqRequirementMap"("saqTypeId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "CertificationAnswer_certificationId_requirementId_key" ON "CertificationAnswer"("certificationId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerJustification_certificationAnswerId_key" ON "AnswerJustification"("certificationAnswerId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_certificationId_key" ON "Signature"("certificationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentStatus_certificationId_key" ON "PaymentStatus"("certificationId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");


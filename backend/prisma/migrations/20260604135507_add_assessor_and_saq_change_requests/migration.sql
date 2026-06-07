-- AlterTable
ALTER TABLE "Certification" ADD COLUMN "assessorIsaName" TEXT;
ALTER TABLE "Certification" ADD COLUMN "assessorQsaCompany" TEXT;
ALTER TABLE "Certification" ADD COLUMN "assessorQsaLeadName" TEXT;

-- CreateTable
CREATE TABLE "SaqChangeRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "certificationId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "currentSaqTypeId" TEXT,
    "requestedSaqTypeId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" DATETIME,
    "appliedSaqTypeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SaqChangeRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaqChangeRequest_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "Certification" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SaqChangeRequest_status_idx" ON "SaqChangeRequest"("status");

-- CreateIndex
CREATE INDEX "SaqChangeRequest_clientId_idx" ON "SaqChangeRequest"("clientId");

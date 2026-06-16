-- CreateTable
CREATE TABLE "OfficialDocumentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saqTypeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT,
    "bundledTemplatePath" TEXT,
    "sha256" TEXT NOT NULL,
    "textFieldCount" INTEGER NOT NULL,
    "checkboxCount" INTEGER NOT NULL,
    "parsedSectionsJson" TEXT NOT NULL,
    "parsedRequirementsJson" TEXT NOT NULL,
    "validationJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByUserId" TEXT,
    "appliedByUserId" TEXT,
    "appliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OfficialDocumentVersion_saqTypeId_fkey" FOREIGN KEY ("saqTypeId") REFERENCES "SaqType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OfficialDocumentVersion_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OfficialDocumentVersion_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OfficialDocumentVersion_saqTypeId_kind_isActive_idx" ON "OfficialDocumentVersion"("saqTypeId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "OfficialDocumentVersion_sha256_idx" ON "OfficialDocumentVersion"("sha256");

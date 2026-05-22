# PCI Nexus — Data dictionary

The canonical schema lives in `backend/prisma/schema.prisma`. This document
explains the intent of each table and the most useful relationships.

## Enums

| Enum | Values |
| --- | --- |
| `UserRoleCode` | `ADMIN`, `EXECUTIVE`, `CLIENT` |
| `ClientStatus` | `PENDING_SAQ_ASSIGNMENT`, `ASSIGNED_SAQ`, `IN_PROGRESS`, `FINALIZED`, `SUSPENDED` |
| `CertificationStatus` | `DRAFT`, `IN_PROGRESS`, `READY_TO_GENERATE`, `GENERATED`, `FINALIZED`, `ARCHIVED` |
| `AnswerValue` | `IMPLEMENTED`, `CCW`, `NOT_APPLICABLE`, `NOT_IMPLEMENTED`, `NOT_TESTED` |
| `PaymentState` | `UNPAID`, `PENDING`, `PAID`, `OVERDUE` |
| `MessageType` | `INFO`, `WARNING`, `SUCCESS` |
| `JustificationType` | `CCW_ANNEX_B`, `NA_ANNEX_C`, `NOT_TESTED_ANNEX_D` |
| `AsvScanStatus` | `REQUESTED`, `IN_PROGRESS`, `PASSED`, `FAILED`, `NEEDS_REMEDIATION`, `CANCELLED` |
| `AsvScanSeverity` | `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |

## Core tables

### `Role`

Lookup table for the three role codes. Seeded by `prisma/seed.ts`.

### `User`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | cuid | PK |
| `roleId` | FK → Role | Role assignment |
| `email`, `username` | unique strings | Login identifiers |
| `passwordHash` | bcrypt hash | |
| `firstName`, `lastName`, `phone` | strings | |
| `isActive` | boolean | Logical delete |
| `mustChangePassword` | boolean | Forces /change-password on first login |
| `mfaEnabled` | boolean | TOTP active |
| `mfaSecret` | string? | Base32-encoded TOTP secret (only present after enroll) |
| `mfaRecoveryCodesJson` | string? | JSON array of sha256 hashes of unused recovery codes |
| `mfaEnrolledAt` | datetime? | Last enroll timestamp |
| `lastLoginAt` | datetime? | Updated on successful login |

### `Client`

Single organization. Logical deactivation is now supported.

| Column | Notes |
| --- | --- |
| `companyName`, `dbaName`, `businessType`, `website`, `taxId` | Business identity |
| `postalAddress`, `fiscalAddress` | |
| `primaryContact*`, `adminContact*` | Contact dictionary |
| `status` | `ClientStatus` |
| `isActive` | False after deactivation |
| `deactivationReason`, `deactivatedAt`, `deactivatedByUserId` | Soft-deactivation metadata |

### `ClientUser`

Many-to-many between Client and User with `isPrimary` flag. Exactly one
primary user is enforced application-side.

### `ExecutiveClientAssignment`

Active assignment of an EXECUTIVE user to a client. Inactive rows are kept
for audit trail.

### `SaqType`

Catalog of SAQ variants (A, A_EP, B, B_IP, C, C_VT, D_MERCHANT, D_P2PE).
B_IP shares mappings with B (cloned at import time).

### `PciTopic`

The 12 PCI DSS top-level requirement topics, with displayOrder.

### `PciRequirement`

Individual requirement (e.g. `1.2.3`). Belongs to one topic. `testingProcedures`
is reserved for a future load from the SSC reporting template.

### `SaqRequirementMap`

Many-to-many between `SaqType` and `PciRequirement`. Per-mapping flags drive
the SAQ engine:

- `displayOrder`
- `requiresEvidence` (mandatory file upload)
- `requiresCcwJustification` (Annex B when answer = CCW)
- `requiresNaJustification` (Annex C when answer = NOT_APPLICABLE)
- `allowNotTested` (Annex D when answer = NOT_TESTED, only valid on D variants)
- `mappingVersion` (snapshot string for catalog versioning)

### `Certification`

| Column | Notes |
| --- | --- |
| `clientId`, `saqTypeId`, `cycleYear` | What is being certified |
| `status` | `CertificationStatus` |
| `isLocked` | True after final generation; admin can flip back via `POST /admin/clients/:clientId/certifications/:certificationId/reopen` |
| `templateVersionSnapshot`, `mappingVersionSnapshot` | Frozen at finalization |
| `preloadedFromCertificationId` | Pointer to the previous cycle when answers were preloaded |
| `lastViewedTopicCode` | Used to restore questionnaire navigation |

### `CertificationAnswer`

One row per (certification, requirement). Has `answerValue`, optional
`explanation`, and a 1:1 `AnswerJustification` for CCW/NA/NOT_TESTED.

### `AnswerJustification`

Justification text + Annex bucket for the answer. 1:1 with
`CertificationAnswer`.

### `CertificationSectionInput`

Per-section freeform payload (JSON). Used by the questionnaire's capture
sections (intro form, generation readiness checkpoints, etc).

### `Signature`

Single signature per certification — drawn or uploaded.

### `ClientDocument`

Holds every file: uploaded evidence, generated outputs, templates returned by
the client, etc. Key fields:

- `category` — `EDITED_TEMPLATE`, `EVIDENCE`, `GENERATED_OUTPUT`, etc.
- `version`, `parentDocumentId` — supports versioning
- `isArchived`, `archivedAt`, `archivedByUserId` — used by the retention job
- `storagePath` — relative to `UPLOADS_DIR`

### `DocumentTemplate`

Editable PDF/Word/Excel templates surfaced under the client repository.

### `PaymentStatus`

Per-certification payment state plus an audit trail of updates.

### `DashboardMessage`

In-app notifications shown to clients (renewal reminders, executive nudges).

### `NotificationLog`

Dedup ledger for reminders (`certificationId`, `notificationKey`, `channel`).

### `PasswordResetToken`

Single-use tokens with `expiresAt` (60 min) and `usedAt`.

### `AuditLog`

Append-only ledger. `actionType` examples:

```
AUTH_LOGIN_SUCCESS / AUTH_LOGIN_FAILED / AUTH_LOGIN_BLOCKED
AUTH_PASSWORD_RESET_EMAIL_SENT / AUTH_PASSWORD_RESET_COMPLETED
AUTH_MFA_CHALLENGE_ISSUED / AUTH_MFA_SUCCESS / AUTH_MFA_FAILED
AUTH_MFA_ENROLLED / AUTH_MFA_DISABLED / AUTH_MFA_RECOVERY_CODE_USED
ADMIN_CLIENT_CREATED / ADMIN_CLIENT_UPDATED / ADMIN_CERTIFICATION_REOPENED
ADMIN_AUDIT_LOGS_EXPORTED / ADMIN_REMINDER_SCAN_RUN / ADMIN_RETENTION_RUN
EXECUTIVE_CLIENT_CREATED / EXECUTIVE_CLIENT_UPDATED / EXECUTIVE_CLIENT_DEACTIVATED
EXECUTIVE_CLIENT_SAQ_ASSIGNED
EVIDENCE_UPLOADED / EVIDENCE_DOWNLOADED
SAQ_ANSWER_UPSERTED / SAQ_FINALIZED
ASV_SCAN_REQUESTED / ASV_SCAN_SIMULATED / ASV_FINDING_RESOLVED / ASV_FINDING_REOPENED
RETENTION_JOB_RUN
```

### `AsvScan`

Simulated ASV scan request.

| Column | Notes |
| --- | --- |
| `scanReference` | Human-readable identifier (`ASV-YYYYMMDDHHMMSS-XXXX`) |
| `targetScope` | Free-text list of hosts / CIDRs |
| `status` | `AsvScanStatus` |
| `requestedAt`, `startedAt`, `completedAt` | Lifecycle timestamps |
| `summary`, `externalVendorRef` | Optional metadata |
| `findings` | 1:N `AsvScanFinding` |

### `AsvScanFinding`

| Column | Notes |
| --- | --- |
| `cve` | Optional CVE identifier |
| `hostTarget` | Affected host |
| `severity` | `AsvScanSeverity` |
| `title`, `description`, `remediation` | Display fields |
| `isResolved`, `resolvedAt` | Closed-out tracking |

## Soft-deletion conventions

- `Client.isActive` — false implies the org is suspended; users get
  `isActive = false` cascaded.
- `User.isActive` — false blocks login.
- `ClientDocument.isArchived` — true hides from operational UIs; retention
  job purges rows older than `RETENTION_PURGE_ARCHIVED_AFTER_DAYS`.
- `Certification.status = ARCHIVED` — used as the terminal "out of operational
  scope" state set by the retention job.
- No hard delete is exposed for ClientDocument/Certification except through
  the retention job, which only purges already-archived documents.

# PCI Nexus — Architecture overview

## 1. Goal

PCI Nexus is a single-tenant web application for delivering, tracking and
storing PCI DSS v4.0.1 self-assessment questionnaires (SAQ) and the related
attestations (AOC, diploma) on behalf of merchants. It supports three roles —
**ADMIN**, **EXECUTIVE**, **CLIENT** — and the lifecycle of a yearly
certification cycle.

## 2. Runtime topology

```
                ┌──────────────────────────┐
                │  Caddy (TLS terminator)  │
                │   nexuspci.com :443      │
                └────────────┬─────────────┘
                             │
              ┌──────────────┴────────────────┐
              │                               │
   ┌───────────────────┐            ┌─────────────────────┐
   │  frontend (Nginx) │            │  backend (Express)  │
   │  SPA build        │            │  Node 20 + Prisma   │
   │  /usr/share/...   │            │  /uploads (volume)  │
   └───────────────────┘            │  /data (SQLite)     │
                                    └──────────┬──────────┘
                                               │
                                  ┌────────────┴────────────┐
                                  │   SQLite (better-sqlite3)│
                                  │   prisma/dev.db / prod.db│
                                  └─────────────────────────┘
```

- **Caddy** terminates TLS (Let's Encrypt) and proxies API paths to the backend
  and everything else to the frontend Nginx container.
- **Frontend** is a Vite-built React SPA served by Nginx with SPA fallback.
  `VITE_API_URL` is baked into the bundle at build time.
- **Backend** is an Express app written in TypeScript, executed as plain
  Node.js after `tsc` build. Prisma Client (SQLite engine) talks to the
  database mounted at `/data`. File uploads land in `/uploads`.
- **Database**: SQLite stored in a Docker named volume. Prisma migrations live
  under `backend/prisma/migrations`.

## 3. Module map (backend)

```
backend/src/
├── server.ts                  Express bootstrap, maintenance gate, shutdown
├── config.ts                  Reads .env, exports the runtime config
├── lib/
│   ├── auth.ts                bcrypt, JWT, password helpers
│   ├── mfa.ts                 TOTP enrollment, verification, recovery codes
│   ├── email.ts               nodemailer transport with dev-mode fallback
│   ├── email-templates.ts     Welcome / reset / reopen email bodies
│   ├── prisma.ts              Singleton PrismaClient
│   ├── audit.ts               writeAuditLog helper (used everywhere)
│   ├── login-throttle.ts      In-memory IP+username throttling
│   ├── pdf-generators.ts      SAQ / AOC / diploma PDF rendering (pdfkit)
│   ├── saq-status.ts          Validation status derivation
│   ├── saq-sections.ts        Auto-section rendering for the SAQ PDF
│   ├── reminders.ts           Reminder pipeline (60/30/15/14/30 windows)
│   ├── reminder-scheduler.ts  Cron-like scheduler for reminders
│   └── retention-job.ts       Cron-like scheduler for retention + purges
├── middleware/
│   ├── auth.ts                requireAuth / requireRole
│   └── error.ts               Centralised error + 404 handlers
└── routes/
    ├── auth.ts                Login, MFA, password reset, /me
    ├── admin-clients.ts       Admin client CRUD + reopen
    ├── admin-executives.ts    Admin executive CRUD
    ├── admin-operations.ts    Reports, audit logs, CSV export, scheduler triggers
    ├── admin-saq.ts           SAQ mapping maintenance
    ├── client.ts              Client dashboard, evidence, documents, generation
    ├── executive-clients.ts   Executive client lifecycle (create/edit/SAQ/deactivate)
    ├── saq.ts                 SAQ load/save, auto-sections, signature
    ├── templates.ts           Document templates CRUD
    └── asv-scans.ts           ASV mock module (scan request / simulate / findings)
```

## 4. Module map (frontend)

```
frontend/src/
├── App.tsx                    Router, role-aware redirects
├── components/
│   ├── AppShell.tsx           Sidebar, navigation per role
│   ├── ProtectedRoute.tsx     Auth guard
│   ├── RequirementCard.tsx    Per-requirement editor (autosave)
│   ├── SignaturePad.tsx       Canvas-based signature capture
│   └── AsvScansWidget.tsx     Dashboard widget for ASV scans
├── pages/                     1 file per screen (LoginPage, DashboardPage…)
├── lib/api.ts                 Fetch wrapper that injects Authorization header
└── context/session-context.tsx  Session/MFA state, idle logout, refreshUser
```

## 5. Authentication / authorisation

- bcrypt (cost 10) for password hashing.
- JWT (HS256) signed with `JWT_SECRET`; 8 h expiry.
- Idle logout after 30 min of UI inactivity.
- Login throttle: 5 failures per IP+username in 15 min.
- MFA (TOTP) optional for ADMIN/EXECUTIVE. Enrollment goes through
  `/auth/mfa/enroll/start` → `/auth/mfa/enroll/confirm` and yields 8 single-use
  recovery codes. Login returns an MFA challenge token if MFA is enabled; the
  client then exchanges it via `/auth/mfa/verify`.
- Role guards via `requireRole([UserRoleCode.X, ...])` middleware on each route.

## 6. SAQ lifecycle (Certification states)

```
DRAFT → IN_PROGRESS → READY_TO_GENERATE → FINALIZED (isLocked = true)
                                       ↘ ARCHIVED (by retention job)
                                       ↘ IN_PROGRESS (by admin reopen)
```

The admin `POST /admin/clients/:clientId/certifications/:certificationId/reopen`
endpoint flips `isLocked` back and (optionally) archives previously generated
documents.

## 7. Background jobs

| Job | File | Schedule | Notes |
| --- | --- | --- | --- |
| Reminder scan | `reminder-scheduler.ts` | every 24 h (default) | 60/30/15 day expiration, 14 day abandoned, 30 day document refresh |
| Retention purge | `retention-job.ts` | every 24 h (default) | Archives finalized certifications older than `RETENTION_KEEP_FINALIZED_YEARS`; deletes archived `ClientDocument` rows older than `RETENTION_PURGE_ARCHIVED_AFTER_DAYS` |

Both jobs are toggled by env flags (`REMINDER_SCHEDULER_ENABLED`,
`RETENTION_JOB_ENABLED`). Both also expose an admin-only "run now" endpoint
under `/admin/operations/...`.

## 8. Audit logging

Every state-changing endpoint calls `writeAuditLog`. Action names follow
SHOUTY_SNAKE_CASE such as `AUTH_LOGIN_SUCCESS`, `ADMIN_CLIENT_CREATED`,
`ASV_SCAN_SIMULATED`. Admins can filter (action, client, user, date range) and
export to CSV from `GET /admin/operations/audit-logs.csv`.

## 9. Reverse proxy split

The frontend SPA and backend API share the same hostname. `/admin/executives*`
is a collision (the SPA also routes that path). Caddy disambiguates by header:

```caddy
@adminExecutivesApi {
    path /admin/executives*
    header Authorization Bearer*
}
handle @adminExecutivesApi { reverse_proxy backend:4000 }
handle /admin/executives*  { reverse_proxy frontend:80 }
```

All other backend prefixes (`/auth`, `/client`, `/saq`, `/admin/clients`,
`/admin/operations`, `/admin/saq`, `/executive`, `/templates`, `/asv`,
`/health`) have no SPA counterpart and route directly to the backend.

## 10. External integrations and roadmap

- **Email**: nodemailer SMTP. Dev mode falls back to console logging.
- **ASV**: simulated module under `/asv`. Replace `sampleFindings` /
  `decideFinalStatus` in `routes/asv-scans.ts` with a real ASV vendor API
  client when one is contracted.
- **Payment gateway**: not integrated; payment state is managed manually by
  executives/admins.

## 11. Future hardening

- Move JWT secret rotation to KMS-backed storage.
- Migrate SQLite to PostgreSQL for higher concurrency (`provider = "postgresql"`
  switch in `schema.prisma`).
- Validate uploaded file content with magic-byte sniffing in addition to the
  current extension whitelist.
- Replace the in-memory login throttle with a Redis-backed store when running
  more than one backend instance.

# PCI Nexus — Release checklist

Use this checklist before promoting a build to production. The expected sign-off
is the operations admin (admin role).

## 1. Code quality

- [ ] `cd backend && npm run build` succeeds (Prisma generate + TypeScript).
- [ ] `cd frontend && npm run build` succeeds (TypeScript + Vite).
- [ ] `cd backend && npm run phase2:verify` passes.
- [ ] `git status` is clean; new files committed.

## 2. Schema & migrations

- [ ] `prisma/schema.prisma` and `prisma/migrations/` are committed together.
- [ ] No `prisma db push` was used to apply pending changes.
- [ ] `npx prisma migrate status` reports no drift in dev and staging.
- [ ] Existing migrations renamed only when in early development (do not rename
      after the migration is in production history).

## 3. Configuration

- [ ] Production `.env` provides a strong `JWT_SECRET` (≥32 chars, random).
- [ ] `PUBLIC_APP_URL` matches the public hostname.
- [ ] SMTP credentials valid (or explicitly disabled in dev mode).
- [ ] Reminder / retention schedulers configured per environment intent.

## 4. Security

- [ ] All admin accounts have MFA enabled (`/account/mfa`).
- [ ] Default seed passwords for `farenas_admin`, `VFlores`, `AArenas` have
      been rotated.
- [ ] HTTPS reachable; HSTS, TLS 1.2+ verified via the ASV mock scan.
- [ ] Login throttle settings match policy (5 failures / 15 min by default).
- [ ] `JWT_SECRET` does not appear in logs.

## 5. Data

- [ ] Roles, SAQ types and mappings present:

  ```
  docker compose exec backend npx tsx prisma/import-saq-data.ts
  ```

- [ ] Document templates present:

  ```
  docker compose exec backend npm run templates:seed
  ```

- [ ] At least one ASV scan executed and the dashboard widget renders.

## 6. Backups

- [ ] Backup cron is running on the host (`systemctl list-timers` shows the
      backup unit).
- [ ] Last 7 backups exist in remote storage.
- [ ] A documented restore drill was executed within the last quarter.

## 7. Documentation

- [ ] `docs/architecture.md` reflects the deployed services.
- [ ] `docs/data-dictionary.md` reflects the current schema.
- [ ] `docs/deployment-guide.md` env table reflects the current `.env.example`.
- [ ] Release notes drafted with user-visible changes.

## 8. Smoke tests (manual)

Run after deploy, while still in maintenance mode where possible.

- [ ] `curl -sf https://<host>/health` returns 200.
- [ ] Log in as ADMIN → confirm operations dashboard loads.
- [ ] Log in as EXECUTIVE → confirm portfolio loads.
- [ ] Log in as CLIENT → confirm SAQ questionnaire loads with answers preserved.
- [ ] Trigger reminder scan from admin operations.
- [ ] Trigger retention scan from admin operations (dry-run with a low cutoff
      if needed).
- [ ] Request and simulate an ASV scan; dashboard shows the result.
- [ ] Export audit logs CSV with a date filter applied.
- [ ] Re-enable maintenance mode toggles, confirm clients are blocked from
      write actions.

## 9. Communication

- [ ] Customer-facing release note posted via dashboard message.
- [ ] Operations rotation informed of any new env vars or schema-level steps.
- [ ] Support team updated with anything new in the audit log vocabulary.

## 10. Post-release

- [ ] First 24 h of audit logs reviewed for anomalies (`AUTH_LOGIN_FAILED`
      spikes, `RETENTION_JOB_RUN` errors, etc).
- [ ] Reminder scan runs once and `NotificationLog` rows look sensible.
- [ ] Issue list opened for any noticed paper cuts (do NOT fix them in
      the same release).

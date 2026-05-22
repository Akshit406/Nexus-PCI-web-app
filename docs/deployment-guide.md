# PCI Nexus — Deployment guide

This guide covers a single-host Docker Compose deployment. The same images
also run in any container platform (ECS, Cloud Run, Fly.io, etc) provided the
`/uploads` and `/data` volumes are persistent.

## 1. Prerequisites

- Linux VPS (Ubuntu 22.04+ or Debian 12+ recommended).
- Docker Engine 24+ with Docker Compose plugin.
- DNS `A` record pointing `nexuspci.com` to the VPS IP (replace with your
  domain).
- Port 80/443 open inbound; outbound 25/587/465 if SMTP is used.

## 2. Files you need on the host

```
deploy/
├── docker-compose.yml        (from web-app/)
├── Caddyfile                 (from web-app/)
├── backend.env               (see "Environment variables" below)
└── frontend.env              (optional, only if VITE_API_URL differs)
```

Clone the repository or copy these files; the backend image is built from
`backend/`, frontend from `frontend/`.

## 3. Environment variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `file:/data/prod.db` for SQLite, or PostgreSQL URL |
| `JWT_SECRET` | yes (prod) | 32+ random characters; the server refuses to start with the placeholder in `NODE_ENV=production` |
| `FRONTEND_ORIGIN` | yes | e.g. `https://nexuspci.com` |
| `PUBLIC_APP_URL` | recommended | Used in welcome / reset / reopen emails |
| `PORT` | optional | Defaults to 4000 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | optional | Required if you want real emails. Otherwise the system logs them to stdout |
| `UPLOADS_DIR` | optional | Defaults to `./storage`; in Docker the entrypoint mounts `/uploads` and `UPLOADS_DIR=/uploads` should be set |
| `REMINDER_SCHEDULER_ENABLED`, `REMINDER_SCHEDULER_INTERVAL_MINUTES`, `REMINDER_SCHEDULER_RUN_ON_START` | optional | Default off |
| `RETENTION_JOB_ENABLED`, `RETENTION_JOB_INTERVAL_MINUTES`, `RETENTION_KEEP_FINALIZED_YEARS`, `RETENTION_PURGE_ARCHIVED_AFTER_DAYS` | optional | Default off / 2 years / 365 days |
| `MAINTENANCE_MODE_ENABLED`, `MAINTENANCE_MESSAGE` | optional | Read-only mode for non-admins |

Frontend `VITE_API_URL` is baked into the bundle by the Dockerfile. Change
the `args.VITE_API_URL` value in `docker-compose.yml` if you deploy under a
different hostname.

## 4. First deploy

```bash
# 1. Build images
docker compose build

# 2. Bring up the stack
docker compose up -d

# 3. Confirm migrations applied (entrypoint runs `prisma migrate deploy`)
docker compose exec backend npx prisma migrate status

# 4. Seed core data (roles, default admin/exec users, base templates, SAQ map)
docker compose exec backend npm run db:seed
docker compose exec backend npm run saq:import
docker compose exec backend npm run templates:seed

# 5. Verify
curl -sf https://nexuspci.com/health | jq
```

The default seed creates users:

- `farenas_admin` / `Cambiar123` (ADMIN)
- `VFlores` / `Cambiar123` (EXECUTIVE)
- `AArenas` / `Cambiar123` (EXECUTIVE)

Both passwords must be rotated at first login (`mustChangePassword=true`).

## 5. TLS

Caddy obtains a Let's Encrypt cert automatically on first request to
`nexuspci.com`. The mounted volumes `caddy_data` and `caddy_config` persist
the issued certificates.

## 6. Subsequent deploys

Use the shipped script — it validates the Caddyfile **before** touching the
stack, waits for the backend's healthcheck to actually report `healthy`,
hot-reloads Caddy so the new routing rules take effect (the classic gotcha:
bind-mounted Caddyfiles never auto-reload), and finally smoke-tests the public
`/health` endpoint:

```bash
cd ~/apps/Nexus-PCI-web-app/web-app
./deploy.sh                  # full deploy: pull, build, up, reload, smoke test
./deploy.sh --no-pull        # deploy local changes (e.g. hotfix on the host)
./deploy.sh --no-build       # config-only redeploy (just up + caddy reload)
./deploy.sh --skip-smoke     # skip the public curl test
```

The entrypoint inside the backend container runs `prisma migrate deploy` and
self-heals two known scenarios: an existing database with no migration history
(P3005 → baseline + retry) and additive schema drift (`prisma db push
--skip-generate` after the baseline). It never accepts data loss.

Adding new schema changes requires:

```bash
cd backend
npx prisma migrate dev --name your_change
git add prisma/migrations
```

## 7. Backups

```bash
mkdir -p /var/backups/pcinexus

# Database (SQLite)
docker cp $(docker compose ps -q backend):/data/prod.db /var/backups/pcinexus/prod-$(date +%F).db

# Uploads
docker run --rm --volumes-from $(docker compose ps -q backend) \
  -v /var/backups/pcinexus:/backup alpine \
  sh -lc 'tar czf /backup/uploads-$(date +%F).tgz /uploads'

# Caddy (certificates)
docker run --rm --volumes-from $(docker compose ps -q caddy) \
  -v /var/backups/pcinexus:/backup alpine \
  sh -lc 'tar czf /backup/caddy-$(date +%F).tgz /data /config'
```

Schedule the above with `cron`/`systemd timers` and ship to remote storage.

## 8. Restore

1. Put the application in maintenance mode by exporting
   `MAINTENANCE_MODE_ENABLED=true` and restarting the backend container.
2. Stop the backend container (`docker compose stop backend`).
3. Replace `/data/prod.db` and the uploads volume contents from the chosen
   backup. Verify checksums.
4. Restart (`docker compose up -d backend`) and confirm
   `npx prisma migrate status` reports no pending migrations.
5. Disable maintenance mode and announce.

## 9. Monitoring

- `GET /health` returns 200 plus `{ ok, service, maintenanceMode }`.
- The reminder / retention job statuses are visible at
  `GET /admin/operations/summary` (admin only) and include last-run / next-run
  timestamps.
- Audit logs are exportable as CSV from the admin operations page.

## 10. Common operational tasks

| Task | Command |
| --- | --- |
| Tail backend logs | `docker compose logs -f backend` |
| Trigger reminder scan now | `POST /admin/operations/reminders/run-now` |
| Trigger retention purge now | `POST /admin/operations/retention/run-now` |
| Reopen a finalized certification | `POST /admin/clients/:clientId/certifications/:certificationId/reopen` |
| Enrol MFA (admin/exec) | `/account/mfa` in the SPA |
| Reset a user password | Admin client page or `POST /auth/request-password-reset` |

## 11. Known footguns

- **JWT secret must be persistent**. Rotating it invalidates all sessions.
- **SQLite is single-writer**. Concurrency is fine for the expected workload
  (dozens of merchants) but switching to PostgreSQL only requires updating
  `provider` in `schema.prisma`, running `prisma migrate dev`, and pointing
  `DATABASE_URL` at the Postgres instance.
- **Uploads volume is the source of truth**. Lose it and the documents are
  gone. Always include it in the backup plan.
- **Cron-free hosts**: the reminder and retention jobs are in-process; if you
  scale to multiple replicas, only enable the scheduler on one (or move it to
  a dedicated worker).

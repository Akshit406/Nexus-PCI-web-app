import path from "path";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const unsafeDefault = "change-me-for-production";
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && (!secret || secret === unsafeDefault || secret.length < 32)) {
    throw new Error("JWT_SECRET debe configurarse en produccion con un valor privado de al menos 32 caracteres.");
  }

  return secret ?? unsafeDefault;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: resolveJwtSecret(),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`,
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(process.cwd(), "storage"),
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  mailFrom: process.env.MAIL_FROM ?? "PCI Nexus <no-reply@pcinexus.local>",
  publicAppUrl: process.env.PUBLIC_APP_URL ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  reminderSchedulerEnabled: parseBoolean(process.env.REMINDER_SCHEDULER_ENABLED, false),
  reminderSchedulerIntervalMinutes: Math.max(1, Number(process.env.REMINDER_SCHEDULER_INTERVAL_MINUTES ?? 1440)),
  reminderSchedulerRunOnStart: parseBoolean(process.env.REMINDER_SCHEDULER_RUN_ON_START, false),
  retentionJobEnabled: parseBoolean(process.env.RETENTION_JOB_ENABLED, false),
  retentionJobIntervalMinutes: Math.max(60, Number(process.env.RETENTION_JOB_INTERVAL_MINUTES ?? 1440)),
  retentionKeepFinalizedYears: Math.max(1, Number(process.env.RETENTION_KEEP_FINALIZED_YEARS ?? 2)),
  retentionPurgeArchivedAfterDays: Math.max(7, Number(process.env.RETENTION_PURGE_ARCHIVED_AFTER_DAYS ?? 365)),
  maintenanceModeEnabled: parseBoolean(process.env.MAINTENANCE_MODE_ENABLED, false),
  maintenanceMessage:
    process.env.MAINTENANCE_MESSAGE ??
    "La plataforma esta en mantenimiento operativo. El acceso de administracion permanece disponible.",
};

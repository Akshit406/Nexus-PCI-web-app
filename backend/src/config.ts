import path from "path";

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "change-me-for-production",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`,
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(process.cwd(), "storage"),
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  mailFrom: process.env.MAIL_FROM ?? "PCI Nexus <no-reply@pcinexus.local>",
  reminderSchedulerEnabled: parseBoolean(process.env.REMINDER_SCHEDULER_ENABLED, false),
  reminderSchedulerIntervalMinutes: Math.max(1, Number(process.env.REMINDER_SCHEDULER_INTERVAL_MINUTES ?? 1440)),
  reminderSchedulerRunOnStart: parseBoolean(process.env.REMINDER_SCHEDULER_RUN_ON_START, false),
};

import path from "path";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "change-me-for-production",
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? process.env.CORS_ORIGIN ?? "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`,
  uploadsDir: process.env.UPLOADS_DIR ?? path.join(process.cwd(), "storage"),
};

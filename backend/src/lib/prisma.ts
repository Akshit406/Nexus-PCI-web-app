import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __phase1Prisma: PrismaClient | undefined;
}

export const prisma =
  global.__phase1Prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__phase1Prisma = prisma;
}

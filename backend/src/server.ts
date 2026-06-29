import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config";
import authRoutes from "./routes/auth";
import adminClientRoutes from "./routes/admin-clients";
import adminExecutiveRoutes from "./routes/admin-executives";
import adminOperationsRoutes from "./routes/admin-operations";
import adminSaqRoutes from "./routes/admin-saq";
import asvScanRoutes from "./routes/asv-scans";
import clientRoutes from "./routes/client";
import executiveClientRoutes from "./routes/executive-clients";
import saqRoutes from "./routes/saq";
import saqChangeRequestRoutes from "./routes/saq-change-requests";
import templateRoutes from "./routes/templates";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { verifyAuthToken } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { startReminderScheduler, stopReminderScheduler } from "./lib/reminder-scheduler";
import { startRetentionScheduler, stopRetentionScheduler } from "./lib/retention-job";

const app = express();

app.use(
  cors({
    origin: config.frontendOrigin,
  }),
);
// Base64 adds roughly 33% overhead, so a 50 MB evidence file needs a larger JSON body allowance.
app.use(express.json({ limit: "70mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "pci-nexus-phase1-backend",
    maintenanceMode: config.maintenanceModeEnabled,
  });
});

app.use(async (req, res, next) => {
  if (!config.maintenanceModeEnabled || req.method === "GET" || req.path === "/health" || req.path.startsWith("/auth")) {
    return next();
  }

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = verifyAuthToken(header.slice("Bearer ".length));
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, include: { role: true } });
      if (user?.isActive && user.role.code === "ADMIN") {
        return next();
      }
    } catch {
      // Fall through to the maintenance response.
    }
  }

  return res.status(503).json({
    message: config.maintenanceMessage,
    maintenanceMode: true,
  });
});

app.use("/auth", authRoutes);
app.use("/admin/clients", adminClientRoutes);
app.use("/admin/executives", adminExecutiveRoutes);
app.use("/admin/operations", adminOperationsRoutes);
app.use("/admin/saq", adminSaqRoutes);
app.use("/asv", asvScanRoutes);
app.use("/client", clientRoutes);
app.use("/executive", executiveClientRoutes);
app.use("/saq", saqRoutes);
app.use("/saq-change-requests", saqChangeRequestRoutes);
app.use("/templates", templateRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`PCI Nexus backend listening on http://localhost:${config.port}`);
  startReminderScheduler();
  startRetentionScheduler();
});

function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down PCI Nexus backend.`);
  stopReminderScheduler();
  stopRetentionScheduler();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

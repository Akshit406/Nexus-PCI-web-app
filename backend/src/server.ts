import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config";
import authRoutes from "./routes/auth";
import clientRoutes from "./routes/client";
import saqRoutes from "./routes/saq";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { startReminderScheduler, stopReminderScheduler } from "./lib/reminder-scheduler";

const app = express();

app.use(
  cors({
    origin: config.frontendOrigin,
  }),
);
app.use(express.json({ limit: "15mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "pci-nexus-phase1-backend" });
});

app.use("/auth", authRoutes);
app.use("/client", clientRoutes);
app.use("/saq", saqRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`PCI Nexus backend listening on http://localhost:${config.port}`);
  startReminderScheduler();
});

function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down PCI Nexus backend.`);
  stopReminderScheduler();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

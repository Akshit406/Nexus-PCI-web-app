import "dotenv/config";
import cors from "cors";
import express from "express";
import { config } from "./config";
import authRoutes from "./routes/auth";
import clientRoutes from "./routes/client";
import saqRoutes from "./routes/saq";
import { errorHandler, notFoundHandler } from "./middleware/error";

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

app.listen(config.port, () => {
  console.log(`PCI Nexus backend listening on http://localhost:${config.port}`);
});

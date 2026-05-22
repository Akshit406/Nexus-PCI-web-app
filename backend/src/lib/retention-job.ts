import { CertificationStatus } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import { writeAuditLog } from "./audit";
import { prisma } from "./prisma";

export type RetentionRunResult = {
  archivedCertifications: number;
  purgedDocumentRecords: number;
  purgedDocumentFiles: number;
  scanWindow: { keepFinalizedYears: number; purgeArchivedAfterDays: number };
};

type RetentionRunMeta =
  | ({ success: true; source: string } & RetentionRunResult)
  | { success: false; source: string; reason: string };

let timer: NodeJS.Timeout | null = null;
let runInProgress = false;
let lastStartedAt: Date | null = null;
let lastFinishedAt: Date | null = null;
let lastResult: RetentionRunMeta | null = null;
let lastError: string | null = null;
let nextRunAt: Date | null = null;

function intervalMs() {
  return config.retentionJobIntervalMinutes * 60 * 1000;
}

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

async function safeUnlink(absolutePath: string | null) {
  if (!absolutePath) return false;
  try {
    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    console.warn(`[retention-job] could not delete file ${absolutePath}`, error);
    return false;
  }
}

function resolveStoragePath(storagePath: string) {
  if (!storagePath) return null;
  if (path.isAbsolute(storagePath)) return storagePath;
  return path.resolve(config.uploadsDir, storagePath);
}

export async function runRetentionPurge(): Promise<RetentionRunResult> {
  const now = new Date();
  const archiveCutoff = new Date(now);
  archiveCutoff.setUTCFullYear(archiveCutoff.getUTCFullYear() - config.retentionKeepFinalizedYears);
  const purgeCutoff = new Date(now.getTime() - config.retentionPurgeArchivedAfterDays * 24 * 60 * 60 * 1000);

  // Step 1: archive finalized certifications whose validUntil is older than the
  // configured retention window. We keep the underlying data but flip the
  // status to ARCHIVED so it falls out of operational reports.
  const candidatesForArchive = await prisma.certification.findMany({
    where: {
      status: CertificationStatus.FINALIZED,
      validUntil: { lt: archiveCutoff },
    },
    select: { id: true, clientId: true },
  });

  let archivedCertifications = 0;
  if (candidatesForArchive.length > 0) {
    const result = await prisma.certification.updateMany({
      where: { id: { in: candidatesForArchive.map((row) => row.id) } },
      data: { status: CertificationStatus.ARCHIVED },
    });
    archivedCertifications = result.count;
  }

  // Step 2: purge ClientDocument rows that have been archived for longer than
  // the configured number of days. We also delete the underlying file from
  // disk when possible.
  const purgeCandidates = await prisma.clientDocument.findMany({
    where: {
      isArchived: true,
      archivedAt: { lt: purgeCutoff },
    },
    select: { id: true, storagePath: true },
  });

  let purgedDocumentFiles = 0;
  for (const candidate of purgeCandidates) {
    const removed = await safeUnlink(resolveStoragePath(candidate.storagePath));
    if (removed) {
      purgedDocumentFiles += 1;
    }
  }

  let purgedDocumentRecords = 0;
  if (purgeCandidates.length > 0) {
    const result = await prisma.clientDocument.deleteMany({
      where: { id: { in: purgeCandidates.map((row) => row.id) } },
    });
    purgedDocumentRecords = result.count;
  }

  return {
    archivedCertifications,
    purgedDocumentRecords,
    purgedDocumentFiles,
    scanWindow: {
      keepFinalizedYears: config.retentionKeepFinalizedYears,
      purgeArchivedAfterDays: config.retentionPurgeArchivedAfterDays,
    },
  };
}

async function executeRun(source: string): Promise<RetentionRunMeta> {
  if (runInProgress) {
    const skipped: RetentionRunMeta = {
      success: false,
      source,
      reason: "Retention run already in progress.",
    };
    lastResult = skipped;
    return skipped;
  }

  runInProgress = true;
  lastStartedAt = new Date();
  lastError = null;
  try {
    const result = await runRetentionPurge();
    const completed: RetentionRunMeta = { success: true, source, ...result };
    lastResult = completed;
    console.log(
      `[retention-job] ${source} run complete: archived=${result.archivedCertifications}, purgedDocs=${result.purgedDocumentRecords}, purgedFiles=${result.purgedDocumentFiles}`,
    );

    await writeAuditLog({
      actionType: "RETENTION_JOB_RUN",
      targetTable: "Certification",
      metadata: {
        source,
        ...result,
      },
    }).catch((error) => console.warn("[retention-job] failed to record audit log", error));

    return completed;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown retention job error.";
    console.error("[retention-job] run failed.", error);
    throw error;
  } finally {
    lastFinishedAt = new Date();
    runInProgress = false;
    nextRunAt = timer ? new Date(Date.now() + intervalMs()) : null;
  }
}

function scheduleNextTick() {
  nextRunAt = new Date(Date.now() + intervalMs());
  timer = setInterval(() => {
    void executeRun("scheduled").catch(() => undefined);
  }, intervalMs());
}

export function startRetentionScheduler() {
  if (!config.retentionJobEnabled) {
    console.log("[retention-job] disabled. Set RETENTION_JOB_ENABLED=true to enable automatic retention purges.");
    return getRetentionSchedulerStatus();
  }
  if (timer) {
    return getRetentionSchedulerStatus();
  }
  scheduleNextTick();
  console.log(
    `[retention-job] enabled. Interval: ${config.retentionJobIntervalMinutes} minute(s). Keep finalized for ${config.retentionKeepFinalizedYears} year(s). Purge archived after ${config.retentionPurgeArchivedAfterDays} day(s).`,
  );
  return getRetentionSchedulerStatus();
}

export function stopRetentionScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  nextRunAt = null;
  return getRetentionSchedulerStatus();
}

export function getRetentionSchedulerStatus() {
  return {
    enabled: config.retentionJobEnabled,
    intervalMinutes: config.retentionJobIntervalMinutes,
    keepFinalizedYears: config.retentionKeepFinalizedYears,
    purgeArchivedAfterDays: config.retentionPurgeArchivedAfterDays,
    running: Boolean(timer),
    lastStartedAt: serializeDate(lastStartedAt),
    lastFinishedAt: serializeDate(lastFinishedAt),
    lastResult,
    lastError,
    nextRunAt: serializeDate(nextRunAt),
    runInProgress,
  };
}

export async function runRetentionNow(source = "manual") {
  return executeRun(source);
}

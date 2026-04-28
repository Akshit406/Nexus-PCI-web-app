import { config } from "../config";
import { runPhase2ReminderScan } from "./reminders";

type ReminderScanResult = Awaited<ReturnType<typeof runPhase2ReminderScan>>;
type SchedulerRunResult =
  | ({ success: true; scanSkipped: false; source: string } & ReminderScanResult)
  | { success: false; scanSkipped: true; source: string; reason: string };

let timer: NodeJS.Timeout | null = null;
let runInProgress = false;
let lastStartedAt: Date | null = null;
let lastFinishedAt: Date | null = null;
let lastResult: SchedulerRunResult | null = null;
let lastError: string | null = null;
let nextRunAt: Date | null = null;

function intervalMs() {
  return config.reminderSchedulerIntervalMinutes * 60 * 1000;
}

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

async function executeScan(source: string): Promise<SchedulerRunResult> {
  if (runInProgress) {
    const skipped: SchedulerRunResult = {
      success: false,
      scanSkipped: true,
      source,
      reason: "Reminder scan already in progress.",
    };
    lastResult = skipped;
    console.warn(`[reminder-scheduler] skipped ${source} scan because a scan is already running.`);
    return skipped;
  }

  runInProgress = true;
  lastStartedAt = new Date();
  lastError = null;

  try {
    const result = await runPhase2ReminderScan();
    const completed: SchedulerRunResult = {
      success: true,
      scanSkipped: false,
      source,
      ...result,
    };
    lastResult = completed;
    console.log(
      `[reminder-scheduler] ${source} scan complete: scanned=${result.scanned}, candidates=${result.candidates}, sent=${result.sent}, skipped=${result.skipped}`,
    );
    return completed;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown reminder scan error.";
    console.error("[reminder-scheduler] scan failed.", error);
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
    void executeScan("scheduled").catch(() => {
      // executeScan logs and records the error; keep the server alive.
    });
  }, intervalMs());
}

export function startReminderScheduler() {
  if (!config.reminderSchedulerEnabled) {
    console.log("[reminder-scheduler] disabled. Set REMINDER_SCHEDULER_ENABLED=true to enable automatic reminder scans.");
    return getReminderSchedulerStatus();
  }

  if (timer) {
    return getReminderSchedulerStatus();
  }

  scheduleNextTick();
  console.log(`[reminder-scheduler] enabled. Interval: ${config.reminderSchedulerIntervalMinutes} minute(s).`);

  if (config.reminderSchedulerRunOnStart) {
    void executeScan("startup").catch(() => {
      // executeScan logs and records the error; startup should not crash.
    });
  }

  return getReminderSchedulerStatus();
}

export function stopReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  nextRunAt = null;
  return getReminderSchedulerStatus();
}

export function getReminderSchedulerStatus() {
  return {
    enabled: config.reminderSchedulerEnabled,
    intervalMinutes: config.reminderSchedulerIntervalMinutes,
    running: Boolean(timer),
    lastStartedAt: serializeDate(lastStartedAt),
    lastFinishedAt: serializeDate(lastFinishedAt),
    lastResult,
    lastError,
    nextRunAt: serializeDate(nextRunAt),
    runInProgress,
  };
}

export async function runReminderSchedulerNow(source = "manual") {
  return executeScan(source);
}

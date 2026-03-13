import {
  updateBackupSchedule as applyBackupSchedule,
  type BackupRuntimeInfo,
  getBackupRuntimeInfo,
} from "@/lib/backup/service";
import { isValidDateTimeDisplayFormat } from "@/lib/date-time-format";
import { ensureSchema } from "@/lib/db";
import {
  getDashboardStats,
  getDataFreshness,
  getLatestSyncLogs,
  getLatestSyncRuns,
  getSyncConfig,
  replaceRepositoryMaintainers,
  type SyncRunSummary,
  updateSyncConfig,
} from "@/lib/db/operations";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";
import { startScheduler } from "@/lib/sync/scheduler";
import type { TransferSyncRuntimeInfo } from "@/lib/transfer/service";
import {
  getTransferSyncRuntimeInfo,
  updateTransferSyncSchedule,
} from "@/lib/transfer/service";

export type SyncStatus = {
  config: Awaited<ReturnType<typeof getSyncConfig>>;
  runs: SyncRunSummary[];
  logs: Awaited<ReturnType<typeof getLatestSyncLogs>>;
  dataFreshness: Awaited<ReturnType<typeof getDataFreshness>>;
  backup: BackupRuntimeInfo;
  transferSync: TransferSyncRuntimeInfo;
};

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

export async function fetchSyncStatus(): Promise<SyncStatus> {
  await ensureSchema();
  const [config, runs, logs, dataFreshness, backup, transferSync] =
    await Promise.all([
      getSyncConfig(),
      getLatestSyncRuns(36),
      getLatestSyncLogs(36),
      getDataFreshness(),
      getBackupRuntimeInfo(),
      getTransferSyncRuntimeInfo(),
    ]);

  return { config, runs, logs, dataFreshness, backup, transferSync };
}

export async function fetchSyncConfig() {
  await ensureSchema();
  return getSyncConfig();
}

export async function fetchDashboardStats() {
  await ensureSchema();
  return getDashboardStats();
}

export async function updateOrganization(org: string) {
  const trimmed = org.trim();
  if (!trimmed) {
    throw new Error("Organization name cannot be empty.");
  }

  await ensureSchema();
  await updateSyncConfig({ orgName: trimmed });
}

export async function updateSyncSettings(params: {
  orgName?: string;
  syncIntervalMinutes?: number;
  timezone?: string;
  weekStart?: "sunday" | "monday";
  excludedRepositories?: string[];
  excludedPeople?: string[];
  allowedTeams?: string[];
  allowedUsers?: string[];
  dateTimeFormat?: string;
  authAccessTtlMinutes?: number;
  authIdleTtlMinutes?: number;
  authRefreshTtlDays?: number;
  authMaxLifetimeDays?: number;
  authReauthWindowHours?: number;
  authReauthActions?: string[];
  authReauthNewDevice?: boolean;
  authReauthCountryChange?: boolean;
  orgHolidayCalendarCodes?: (HolidayCalendarCode | string)[];
  backupHourLocal?: number;
  backupTimezone?: string;
  transferSyncHourLocal?: number;
  transferSyncMinuteLocal?: number;
  transferSyncTimezone?: string;
  repositoryMaintainers?: Record<string, string[]>;
}) {
  await ensureSchema();

  if (params.orgName !== undefined) {
    await updateOrganization(params.orgName);
  }

  if (params.syncIntervalMinutes !== undefined) {
    const interval = params.syncIntervalMinutes;
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new Error("Sync interval must be a positive number of minutes.");
    }

    await updateSyncConfig({ syncIntervalMinutes: interval });
    const config = await getSyncConfig();
    if (config?.auto_sync_enabled) {
      startScheduler(interval);
    }
  }

  if (params.timezone !== undefined) {
    const tz = params.timezone.trim();
    if (!tz) {
      throw new Error("Timezone cannot be empty.");
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    } catch (_error) {
      throw new Error("Invalid timezone identifier.");
    }

    await updateSyncConfig({ timezone: tz });
  }

  if (params.repositoryMaintainers !== undefined) {
    const assignments = Object.entries(params.repositoryMaintainers).map(
      ([repositoryId, maintainerIds]) => ({
        repositoryId,
        maintainerIds: Array.isArray(maintainerIds) ? maintainerIds : [],
      }),
    );
    await replaceRepositoryMaintainers(assignments);
  }

  if (params.weekStart !== undefined) {
    const value = params.weekStart;
    if (value !== "sunday" && value !== "monday") {
      throw new Error("Week start must be either 'sunday' or 'monday'.");
    }

    await updateSyncConfig({ weekStart: value });
  }

  if (params.authAccessTtlMinutes !== undefined) {
    if (
      !Number.isFinite(params.authAccessTtlMinutes) ||
      params.authAccessTtlMinutes <= 0
    ) {
      throw new Error("Access TTL must be a positive number of minutes.");
    }
    await updateSyncConfig({
      authAccessTtlMinutes: params.authAccessTtlMinutes,
    });
  }

  if (params.authIdleTtlMinutes !== undefined) {
    if (
      !Number.isFinite(params.authIdleTtlMinutes) ||
      params.authIdleTtlMinutes <= 0
    ) {
      throw new Error("Idle TTL must be a positive number of minutes.");
    }
    await updateSyncConfig({ authIdleTtlMinutes: params.authIdleTtlMinutes });
  }

  if (params.authRefreshTtlDays !== undefined) {
    if (
      !Number.isFinite(params.authRefreshTtlDays) ||
      params.authRefreshTtlDays <= 0
    ) {
      throw new Error("Refresh TTL must be a positive number of days.");
    }
    await updateSyncConfig({ authRefreshTtlDays: params.authRefreshTtlDays });
  }

  if (params.authMaxLifetimeDays !== undefined) {
    if (
      !Number.isFinite(params.authMaxLifetimeDays) ||
      params.authMaxLifetimeDays <= 0
    ) {
      throw new Error("Max lifetime must be a positive number of days.");
    }
    await updateSyncConfig({ authMaxLifetimeDays: params.authMaxLifetimeDays });
  }

  if (params.authReauthWindowHours !== undefined) {
    if (
      !Number.isFinite(params.authReauthWindowHours) ||
      params.authReauthWindowHours <= 0
    ) {
      throw new Error("Reauth window must be a positive number of hours.");
    }
    await updateSyncConfig({
      authReauthWindowHours: params.authReauthWindowHours,
    });
  }

  if (params.authReauthActions !== undefined) {
    await updateSyncConfig({
      authReauthActions: params.authReauthActions,
    });
  }

  if (params.authReauthNewDevice !== undefined) {
    await updateSyncConfig({ authReauthNewDevice: params.authReauthNewDevice });
  }

  if (params.authReauthCountryChange !== undefined) {
    await updateSyncConfig({
      authReauthCountryChange: params.authReauthCountryChange,
    });
  }

  if (params.excludedRepositories !== undefined) {
    const normalized = Array.from(
      new Set(
        params.excludedRepositories
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ excludedRepositories: normalized });
  }

  if (params.excludedPeople !== undefined) {
    const normalized = Array.from(
      new Set(
        params.excludedPeople
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ excludedUsers: normalized });
  }

  if (params.allowedTeams !== undefined) {
    const normalized = Array.from(
      new Set(
        params.allowedTeams
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0),
      ),
    );

    await updateSyncConfig({ allowedTeams: normalized });
  }

  if (params.allowedUsers !== undefined) {
    const normalized = Array.from(
      new Set(
        params.allowedUsers
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    );

    await updateSyncConfig({ allowedUsers: normalized });
  }

  if (params.orgHolidayCalendarCodes !== undefined) {
    if (!Array.isArray(params.orgHolidayCalendarCodes)) {
      throw new Error("Organization holiday calendars must be an array.");
    }

    const selected: HolidayCalendarCode[] = [];
    const seen = new Set<string>();
    for (const value of params.orgHolidayCalendarCodes) {
      if (typeof value !== "string") {
        throw new Error("Unsupported holiday calendar.");
      }
      const trimmed = value.trim();
      if (!trimmed) {
        continue;
      }
      if (!isHolidayCalendarCode(trimmed)) {
        throw new Error("Unsupported holiday calendar.");
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        selected.push(trimmed);
      }
    }

    if (selected.length === 0) {
      selected.push(DEFAULT_HOLIDAY_CALENDAR);
    }

    await updateSyncConfig({ orgHolidayCalendarCodes: selected });
  }

  if (params.dateTimeFormat !== undefined) {
    const format = params.dateTimeFormat.trim();
    if (!isValidDateTimeDisplayFormat(format)) {
      throw new Error("Unsupported date-time display format.");
    }

    await updateSyncConfig({ dateTimeFormat: format });
  }

  if (
    params.backupHourLocal !== undefined ||
    params.backupTimezone !== undefined
  ) {
    const config = await getSyncConfig();
    const hour = params.backupHourLocal ?? config?.backup_hour_local ?? 2;
    const timezone =
      params.backupTimezone ??
      config?.backup_timezone ??
      config?.timezone ??
      "UTC";

    await applyBackupSchedule({
      hourLocal: hour,
      timezone,
    });
  }

  if (
    params.transferSyncHourLocal !== undefined ||
    params.transferSyncMinuteLocal !== undefined ||
    params.transferSyncTimezone !== undefined
  ) {
    const config = await getSyncConfig();
    const hour =
      params.transferSyncHourLocal ?? config?.transfer_sync_hour_local ?? 4;
    const minute =
      params.transferSyncMinuteLocal ?? config?.transfer_sync_minute_local ?? 0;
    const timezone =
      params.transferSyncTimezone ??
      config?.transfer_sync_timezone ??
      config?.timezone ??
      "UTC";

    await updateTransferSyncSchedule({
      hourLocal: hour,
      minuteLocal: minute,
      timezone,
    });
  }
}

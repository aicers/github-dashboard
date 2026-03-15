import { query, withTransaction } from "@/lib/db/client";
import {
  type HolidayCalendarCode,
  isHolidayCalendarCode,
} from "@/lib/holidays/constants";
import { emitSyncEvent } from "@/lib/sync/event-bus";

import { type SyncLogStatus, toIsoString } from "./types";

export type SyncRunStatus = "running" | "success" | "failed";
export type SyncRunType = "automatic" | "manual" | "backfill";
export type SyncRunStrategy = "incremental" | "backfill";

type SyncRunRow = {
  id: number;
  run_type: SyncRunType;
  strategy: SyncRunStrategy;
  since: string | Date | null;
  until: string | Date | null;
  status: SyncRunStatus;
  started_at: string | Date;
  completed_at: string | Date | null;
};

type SyncRunLogRow = {
  id: number;
  run_id: number | null;
  resource: string;
  status: SyncLogStatus;
  message: string | null;
  started_at: string;
  finished_at: string | null;
};

export type SyncRunLog = {
  id: number;
  runId: number | null;
  resource: string;
  status: SyncLogStatus;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SyncRunSummary = {
  id: number;
  runType: SyncRunType;
  strategy: SyncRunStrategy;
  since: string | null;
  until: string | null;
  status: SyncRunStatus;
  startedAt: string;
  completedAt: string | null;
  logs: SyncRunLog[];
};

function compareAsc(a: string | null, b: string | null) {
  const aTime =
    typeof a === "string" ? new Date(a).getTime() : Number.NEGATIVE_INFINITY;
  const bTime =
    typeof b === "string" ? new Date(b).getTime() : Number.NEGATIVE_INFINITY;

  if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
    return 0;
  }

  if (Number.isNaN(aTime)) {
    return -1;
  }

  if (Number.isNaN(bTime)) {
    return 1;
  }

  if (aTime === bTime) {
    return 0;
  }

  return aTime < bTime ? -1 : 1;
}

export async function recordSyncLog(
  resource: string,
  status: SyncLogStatus,
  message?: string,
  runId?: number | null,
) {
  const result = await query<{
    id: number;
    run_id: number | null;
    started_at: string | Date;
  }>(
    `INSERT INTO sync_log (resource, status, message, started_at, run_id)
     VALUES ($1, $2, $3, NOW(), $4)
     RETURNING id, run_id, started_at`,
    [resource, status, message ?? null, runId ?? null],
  );
  const row = result.rows[0];
  if (row) {
    emitSyncEvent({
      type: "log-started",
      logId: row.id,
      runId: row.run_id,
      resource,
      status,
      message: message ?? null,
      startedAt: toIsoString(row.started_at) ?? new Date().toISOString(),
    });
    return row.id;
  }

  return undefined;
}

export async function updateSyncLog(
  id: number,
  status: SyncLogStatus,
  message?: string,
) {
  const result = await query<{
    run_id: number | null;
    resource: string;
    started_at: string | Date | null;
    finished_at: string | Date | null;
  }>(
    `UPDATE sync_log
     SET status = $2, message = $3, finished_at = NOW()
     WHERE id = $1
     RETURNING run_id, resource, started_at, finished_at`,
    [id, status, message ?? null],
  );

  const row = result.rows[0];
  if (row) {
    emitSyncEvent({
      type: "log-updated",
      logId: id,
      runId: row.run_id,
      resource: row.resource,
      status,
      message: message ?? null,
      finishedAt: toIsoString(row.finished_at) ?? new Date().toISOString(),
    });
  }
}

export async function updateSyncState(
  resource: string,
  lastCursor: string | null,
  lastItemTimestamp: string | null,
) {
  await query(
    `INSERT INTO sync_state (resource, last_cursor, last_item_timestamp, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (resource) DO UPDATE SET
       last_cursor = EXCLUDED.last_cursor,
       last_item_timestamp = EXCLUDED.last_item_timestamp,
       updated_at = NOW()`,
    [resource, lastCursor, lastItemTimestamp],
  );
}

export async function getSyncState(resource: string) {
  const result = await query(
    `SELECT resource, last_cursor, last_item_timestamp, updated_at
     FROM sync_state
     WHERE resource = $1`,
    [resource],
  );
  return result.rows[0] ?? null;
}

export async function getSyncConfig() {
  const result = await query(
    `SELECT id,
            org_name,
            auto_sync_enabled,
            sync_interval_minutes,
            timezone,
            week_start,
            excluded_repository_ids,
            excluded_user_ids,
            allowed_team_slugs,
            allowed_user_ids,
            date_time_format,
            auth_access_ttl_minutes,
            auth_idle_ttl_minutes,
            auth_refresh_ttl_days,
            auth_max_lifetime_days,
            auth_reauth_window_hours,
            auth_reauth_actions,
            auth_reauth_new_device,
            auth_reauth_country_change,
            last_sync_started_at,
            last_sync_completed_at,
            last_successful_sync_at,
            backup_enabled,
            backup_hour_local,
            backup_timezone,
            backup_last_started_at,
            backup_last_completed_at,
            backup_last_status,
            backup_last_error,
            transfer_sync_hour_local,
            transfer_sync_minute_local,
            transfer_sync_timezone,
            transfer_sync_last_started_at,
            transfer_sync_last_completed_at,
            transfer_sync_last_status,
            transfer_sync_last_error,
            unanswered_mentions_last_started_at,
            unanswered_mentions_last_completed_at,
            unanswered_mentions_last_success_at,
            unanswered_mentions_last_status,
            unanswered_mentions_last_error,
            org_holiday_calendar_codes
     FROM sync_config
     WHERE id = 'default'`,
  );

  return result.rows[0] ?? null;
}

export async function updateSyncConfig(params: {
  orgName?: string;
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
  timezone?: string;
  weekStart?: "sunday" | "monday";
  excludedRepositories?: string[];
  excludedUsers?: string[];
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
  orgHolidayCalendarCodes?: HolidayCalendarCode[];
  lastSyncStartedAt?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
  backupEnabled?: boolean;
  backupHourLocal?: number;
  backupTimezone?: string;
  backupLastStartedAt?: string | null;
  backupLastCompletedAt?: string | null;
  backupLastStatus?: string;
  backupLastError?: string | null;
  transferSyncHourLocal?: number;
  transferSyncMinuteLocal?: number;
  transferSyncTimezone?: string;
  transferSyncLastStartedAt?: string | null;
  transferSyncLastCompletedAt?: string | null;
  transferSyncLastStatus?: string;
  transferSyncLastError?: string | null;
  unansweredMentionsLastStartedAt?: string | null;
  unansweredMentionsLastCompletedAt?: string | null;
  unansweredMentionsLastSuccessAt?: string | null;
  unansweredMentionsLastStatus?: string | null;
  unansweredMentionsLastError?: string | null;
}) {
  const fields = [] as string[];
  const values = [] as unknown[];

  if (typeof params.orgName === "string") {
    fields.push(`org_name = $${fields.length + 1}`);
    values.push(params.orgName);
  }

  if (typeof params.autoSyncEnabled === "boolean") {
    fields.push(`auto_sync_enabled = $${fields.length + 1}`);
    values.push(params.autoSyncEnabled);
  }

  if (typeof params.syncIntervalMinutes === "number") {
    fields.push(`sync_interval_minutes = $${fields.length + 1}`);
    values.push(params.syncIntervalMinutes);
  }

  if (typeof params.timezone === "string") {
    fields.push(`timezone = $${fields.length + 1}`);
    values.push(params.timezone);
  }

  if (typeof params.weekStart === "string") {
    fields.push(`week_start = $${fields.length + 1}`);
    values.push(params.weekStart);
  }

  if (Array.isArray(params.excludedRepositories)) {
    fields.push(`excluded_repository_ids = $${fields.length + 1}`);
    values.push(params.excludedRepositories);
  }

  if (Array.isArray(params.excludedUsers)) {
    fields.push(`excluded_user_ids = $${fields.length + 1}`);
    values.push(params.excludedUsers);
  }

  if (Array.isArray(params.allowedTeams)) {
    fields.push(`allowed_team_slugs = $${fields.length + 1}`);
    values.push(params.allowedTeams);
  }

  if (Array.isArray(params.allowedUsers)) {
    fields.push(`allowed_user_ids = $${fields.length + 1}`);
    values.push(params.allowedUsers);
  }

  if (typeof params.dateTimeFormat === "string") {
    fields.push(`date_time_format = $${fields.length + 1}`);
    values.push(params.dateTimeFormat);
  }

  if (typeof params.authAccessTtlMinutes === "number") {
    fields.push(`auth_access_ttl_minutes = $${fields.length + 1}`);
    values.push(params.authAccessTtlMinutes);
  }

  if (typeof params.authIdleTtlMinutes === "number") {
    fields.push(`auth_idle_ttl_minutes = $${fields.length + 1}`);
    values.push(params.authIdleTtlMinutes);
  }

  if (typeof params.authRefreshTtlDays === "number") {
    fields.push(`auth_refresh_ttl_days = $${fields.length + 1}`);
    values.push(params.authRefreshTtlDays);
  }

  if (typeof params.authMaxLifetimeDays === "number") {
    fields.push(`auth_max_lifetime_days = $${fields.length + 1}`);
    values.push(params.authMaxLifetimeDays);
  }

  if (typeof params.authReauthWindowHours === "number") {
    fields.push(`auth_reauth_window_hours = $${fields.length + 1}`);
    values.push(params.authReauthWindowHours);
  }

  if (Array.isArray(params.authReauthActions)) {
    fields.push(`auth_reauth_actions = $${fields.length + 1}`);
    values.push(params.authReauthActions);
  }

  if (typeof params.authReauthNewDevice === "boolean") {
    fields.push(`auth_reauth_new_device = $${fields.length + 1}`);
    values.push(params.authReauthNewDevice);
  }

  if (typeof params.authReauthCountryChange === "boolean") {
    fields.push(`auth_reauth_country_change = $${fields.length + 1}`);
    values.push(params.authReauthCountryChange);
  }

  if (Array.isArray(params.orgHolidayCalendarCodes)) {
    const normalized = Array.from(
      new Set(
        params.orgHolidayCalendarCodes
          .map((code) => (typeof code === "string" ? code.trim() : ""))
          .filter((code): code is HolidayCalendarCode =>
            isHolidayCalendarCode(code),
          ),
      ),
    );
    fields.push(`org_holiday_calendar_codes = $${fields.length + 1}`);
    values.push(normalized);
  }

  if (params.lastSyncStartedAt !== undefined) {
    fields.push(`last_sync_started_at = $${fields.length + 1}`);
    values.push(params.lastSyncStartedAt);
  }

  if (params.lastSyncCompletedAt !== undefined) {
    fields.push(`last_sync_completed_at = $${fields.length + 1}`);
    values.push(params.lastSyncCompletedAt);
  }

  if (params.lastSuccessfulSyncAt !== undefined) {
    fields.push(`last_successful_sync_at = $${fields.length + 1}`);
    values.push(params.lastSuccessfulSyncAt);
  }

  if (typeof params.backupEnabled === "boolean") {
    fields.push(`backup_enabled = $${fields.length + 1}`);
    values.push(params.backupEnabled);
  }

  if (typeof params.backupHourLocal === "number") {
    fields.push(`backup_hour_local = $${fields.length + 1}`);
    values.push(params.backupHourLocal);
  }

  if (typeof params.backupTimezone === "string") {
    fields.push(`backup_timezone = $${fields.length + 1}`);
    values.push(params.backupTimezone);
  }

  if (params.backupLastStartedAt !== undefined) {
    fields.push(`backup_last_started_at = $${fields.length + 1}`);
    values.push(params.backupLastStartedAt);
  }

  if (params.backupLastCompletedAt !== undefined) {
    fields.push(`backup_last_completed_at = $${fields.length + 1}`);
    values.push(params.backupLastCompletedAt);
  }

  if (typeof params.backupLastStatus === "string") {
    fields.push(`backup_last_status = $${fields.length + 1}`);
    values.push(params.backupLastStatus);
  }

  if (params.backupLastError !== undefined) {
    fields.push(`backup_last_error = $${fields.length + 1}`);
    values.push(params.backupLastError);
  }

  if (typeof params.transferSyncHourLocal === "number") {
    fields.push(`transfer_sync_hour_local = $${fields.length + 1}`);
    values.push(params.transferSyncHourLocal);
  }

  if (typeof params.transferSyncMinuteLocal === "number") {
    fields.push(`transfer_sync_minute_local = $${fields.length + 1}`);
    values.push(params.transferSyncMinuteLocal);
  }

  if (typeof params.transferSyncTimezone === "string") {
    fields.push(`transfer_sync_timezone = $${fields.length + 1}`);
    values.push(params.transferSyncTimezone);
  }

  if (params.transferSyncLastStartedAt !== undefined) {
    fields.push(`transfer_sync_last_started_at = $${fields.length + 1}`);
    values.push(params.transferSyncLastStartedAt);
  }

  if (params.transferSyncLastCompletedAt !== undefined) {
    fields.push(`transfer_sync_last_completed_at = $${fields.length + 1}`);
    values.push(params.transferSyncLastCompletedAt);
  }

  if (typeof params.transferSyncLastStatus === "string") {
    fields.push(`transfer_sync_last_status = $${fields.length + 1}`);
    values.push(params.transferSyncLastStatus);
  }

  if (params.transferSyncLastError !== undefined) {
    fields.push(`transfer_sync_last_error = $${fields.length + 1}`);
    values.push(params.transferSyncLastError);
  }

  if (params.unansweredMentionsLastStartedAt !== undefined) {
    fields.push(`unanswered_mentions_last_started_at = $${fields.length + 1}`);
    values.push(params.unansweredMentionsLastStartedAt);
  }

  if (params.unansweredMentionsLastCompletedAt !== undefined) {
    fields.push(
      `unanswered_mentions_last_completed_at = $${fields.length + 1}`,
    );
    values.push(params.unansweredMentionsLastCompletedAt);
  }

  if (params.unansweredMentionsLastSuccessAt !== undefined) {
    fields.push(`unanswered_mentions_last_success_at = $${fields.length + 1}`);
    values.push(params.unansweredMentionsLastSuccessAt);
  }

  if (params.unansweredMentionsLastStatus !== undefined) {
    fields.push(`unanswered_mentions_last_status = $${fields.length + 1}`);
    values.push(params.unansweredMentionsLastStatus);
  }

  if (params.unansweredMentionsLastError !== undefined) {
    fields.push(`unanswered_mentions_last_error = $${fields.length + 1}`);
    values.push(params.unansweredMentionsLastError);
  }

  if (!fields.length) {
    return;
  }

  const assignments = fields.join(", ");
  const updateValues = values.map((value) => value ?? null);

  await query(
    `UPDATE sync_config
     SET ${assignments}, updated_at = NOW()
     WHERE id = 'default'`,
    updateValues,
  );
}

export async function createSyncRun(params: {
  runType: SyncRunType;
  strategy: SyncRunStrategy;
  since: string | null;
  until: string | null;
  startedAt: string;
}) {
  const result = await query<{ id: number }>(
    `INSERT INTO sync_runs (run_type, strategy, since, until, status, started_at)
     VALUES ($1, $2, $3, $4, 'running', $5)
     RETURNING id`,
    [
      params.runType,
      params.strategy,
      params.since ?? null,
      params.until ?? null,
      params.startedAt,
    ],
  );

  return result.rows[0]?.id ?? null;
}

export async function updateSyncRunStatus(
  runId: number,
  status: SyncRunStatus,
  completedAt: string | null,
) {
  await query(
    `UPDATE sync_runs
     SET status = $2,
         completed_at = COALESCE($3, completed_at),
         updated_at = NOW()
     WHERE id = $1`,
    [runId, status, completedAt ?? null],
  );
}

export async function getLatestSyncRuns(
  logLimit = 36,
): Promise<SyncRunSummary[]> {
  const normalizedLimit =
    Number.isFinite(logLimit) && logLimit > 0 ? logLimit : 36;
  const runsResult = await query<SyncRunRow>(
    `SELECT id, run_type, strategy, since, until, status, started_at, completed_at
     FROM sync_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [Math.max(normalizedLimit, 1)],
  );

  const runs = runsResult.rows;
  if (!runs.length) {
    return [];
  }

  const runIds = runs.map((run) => run.id);
  const logsResult = await query<SyncRunLogRow>(
    `SELECT id, run_id, resource, status, message, started_at, finished_at
     FROM sync_log
     WHERE run_id::text = ANY($1::text[])
     ORDER BY started_at DESC`,
    [runIds.map((id) => String(id))],
  );

  const logsByRun = new Map<number, SyncRunLog[]>();
  for (const log of logsResult.rows) {
    if (log.run_id === null) {
      continue;
    }

    const entry: SyncRunLog = {
      id: log.id,
      runId: log.run_id,
      resource: log.resource,
      status: log.status,
      message: log.message,
      startedAt: toIsoString(log.started_at),
      finishedAt: toIsoString(log.finished_at),
    };

    const bucket = logsByRun.get(log.run_id) ?? [];
    bucket.push(entry);
    logsByRun.set(log.run_id, bucket);
  }

  const includedRuns: SyncRunRow[] = [];
  let accumulatedLogCount = 0;

  for (const run of runs) {
    const runLogs = logsByRun.get(run.id) ?? [];
    const nextCount = accumulatedLogCount + runLogs.length;
    if (includedRuns.length > 0 && accumulatedLogCount >= normalizedLimit) {
      break;
    }

    if (includedRuns.length > 0 && nextCount > normalizedLimit) {
      break;
    }

    // Sort logs ascending by started time for display consistency.
    runLogs.sort((a, b) => compareAsc(a.startedAt, b.startedAt));
    logsByRun.set(run.id, runLogs);

    includedRuns.push(run);
    accumulatedLogCount = nextCount;
  }

  return includedRuns.map((run) => ({
    id: run.id,
    runType: run.run_type,
    strategy: run.strategy,
    since: toIsoString(run.since),
    until: toIsoString(run.until),
    status: run.status,
    startedAt: toIsoString(run.started_at) ?? "",
    completedAt: toIsoString(run.completed_at),
    logs: logsByRun.get(run.id) ?? [],
  }));
}

export async function cleanupRunningSyncRuns(): Promise<{
  runs: SyncRunRow[];
  logs: SyncRunLogRow[];
}> {
  return withTransaction(async (client) => {
    const runsResult = await client.query<SyncRunRow>(
      `UPDATE sync_runs
       SET status = 'failed',
           completed_at = COALESCE(completed_at, NOW())
       WHERE status = 'running'
       RETURNING id,
                 run_type,
                 strategy,
                 since,
                 until,
                 status,
                 started_at,
                 completed_at`,
    );

    const runs = runsResult.rows;
    if (!runs.length) {
      return { runs, logs: [] };
    }

    const runIds = runs.map((run) => String(run.id));
    const logsResult = await client.query<SyncRunLogRow>(
      `UPDATE sync_log
       SET status = 'failed',
           finished_at = COALESCE(finished_at, NOW())
       WHERE status = 'running'
         AND run_id IS NOT NULL
         AND run_id::text = ANY($1::text[])
       RETURNING id,
                 run_id,
                 resource,
                 status,
                 message,
                 started_at,
                 finished_at`,
      [runIds],
    );

    return { runs, logs: logsResult.rows };
  });
}

export async function resetData({
  preserveLogs = true,
}: {
  preserveLogs?: boolean;
}) {
  if (preserveLogs) {
    await query(
      `TRUNCATE comments, reviews, issues, pull_requests, repositories, users RESTART IDENTITY CASCADE`,
    );
  } else {
    await query(
      `TRUNCATE comments, reviews, issues, pull_requests, repositories, users, sync_log, sync_runs, sync_state, db_backups RESTART IDENTITY CASCADE`,
    );
  }
}

export async function deleteSyncLogs() {
  await query(`TRUNCATE sync_log, sync_runs RESTART IDENTITY CASCADE`);
}

export async function getLatestSyncLogs(limit = 20) {
  const result = await query<{
    id: number;
    run_id: number | null;
    resource: string;
    status: SyncLogStatus;
    message: string | null;
    started_at: string;
    finished_at: string | null;
  }>(
    `SELECT id, resource, status, message, started_at, finished_at, run_id
     FROM sync_log
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function updateSyncTimestamps(status: {
  startedAt?: string | null;
  completedAt?: string | null;
  successfulAt?: string | null;
}) {
  await updateSyncConfig({
    lastSyncStartedAt: status.startedAt ?? undefined,
    lastSyncCompletedAt: status.completedAt ?? undefined,
    lastSuccessfulSyncAt: status.successfulAt ?? undefined,
  });
}

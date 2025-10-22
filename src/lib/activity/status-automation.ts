import type { PoolClient } from "pg";

import { getPool } from "@/lib/db/client";
import { getSyncConfig } from "@/lib/db/operations";

const AUTOMATION_CACHE_KEY = "issue-status-automation";
const AUTOMATION_LOCK_ID = BigInt("4422100313370042");

type AutomationState = {
  status?: "running" | "success" | "failed";
  lastSuccessfulSyncAt?: string | null;
  runId?: number | null;
  trigger?: string;
  insertedInProgress?: number;
  insertedDone?: number;
  error?: string;
};

type AutomationOptions = {
  runId?: number | null;
  trigger?: string;
  force?: boolean;
  logger?: (message: string) => void;
};

export type IssueStatusAutomationRunResult = {
  processed: boolean;
  insertedInProgress: number;
  insertedDone: number;
};

export type IssueStatusAutomationSummary = {
  cacheKey: string;
  generatedAt: string | null;
  updatedAt: string | null;
  syncRunId: number | null;
  runId: number | null;
  status: AutomationState["status"] | null;
  trigger: string | null;
  lastSuccessfulSyncAt: string | null;
  insertedInProgress: number;
  insertedDone: number;
  itemCount: number;
  error: string | null;
};

type AutomationStateRow = {
  cache_key: string;
  generated_at: string | null;
  updated_at: string | null;
  sync_run_id: number | null;
  item_count: number | null;
  metadata: AutomationState | null;
};

function toStatus(value: unknown): AutomationState["status"] | null {
  if (value === "running" || value === "success" || value === "failed") {
    return value;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function toNumberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

async function fetchCurrentState(client: PoolClient) {
  const result = await client.query<{
    metadata: AutomationState | null;
  }>(
    `SELECT metadata
       FROM activity_cache_state
       WHERE cache_key = $1
       FOR UPDATE`,
    [AUTOMATION_CACHE_KEY],
  );

  const metadata = result.rows[0]?.metadata ?? null;
  return metadata ?? null;
}

async function upsertAutomationState(
  client: PoolClient,
  params: {
    status: AutomationState["status"];
    runId: number | null;
    lastSuccessfulSyncAt: string | null;
    trigger?: string;
    insertedInProgress?: number;
    insertedDone?: number;
    error?: string | null;
  },
) {
  const {
    status,
    runId,
    lastSuccessfulSyncAt,
    trigger,
    insertedInProgress = 0,
    insertedDone = 0,
    error = null,
  } = params;

  const metadata: AutomationState = {
    status,
    runId,
    lastSuccessfulSyncAt,
    trigger,
    insertedInProgress,
    insertedDone,
    error: error ?? undefined,
  };

  await client.query(
    `INSERT INTO activity_cache_state (
       cache_key,
       generated_at,
       sync_run_id,
       item_count,
       metadata,
       updated_at
     )
     VALUES ($1, NOW(), $2::int, $3::int, $4::jsonb, NOW())
     ON CONFLICT (cache_key) DO UPDATE SET
       generated_at = EXCLUDED.generated_at,
       sync_run_id = EXCLUDED.sync_run_id,
       item_count = EXCLUDED.item_count,
       metadata = EXCLUDED.metadata,
       updated_at = EXCLUDED.updated_at`,
    [
      AUTOMATION_CACHE_KEY,
      runId,
      insertedInProgress + insertedDone,
      JSON.stringify(metadata),
    ],
  );
}

async function insertInProgressStatuses(client: PoolClient) {
  const result = await client.query<{ issue_id: string }>(
    `INSERT INTO activity_issue_status_history (
       issue_id,
       status,
       occurred_at,
       source
     )
     SELECT candidate.issue_id, 'in_progress', candidate.occurred_at, 'activity'
     FROM (
       SELECT
         pri.issue_id,
         MIN(pr.github_created_at) AS occurred_at
      FROM pull_request_issues pri
      JOIN issues i ON i.id = pri.issue_id
      JOIN pull_requests pr ON pr.id = pri.pull_request_id
      WHERE pr.github_created_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM activity_issue_status_history h
           WHERE h.issue_id = pri.issue_id
             AND h.source = 'todo_project'
         )
       GROUP BY pri.issue_id
     ) AS candidate
     LEFT JOIN LATERAL (
       SELECT h.status
       FROM activity_issue_status_history h
       WHERE h.issue_id = candidate.issue_id
         AND h.source = 'activity'
         AND h.occurred_at <= candidate.occurred_at
       ORDER BY h.occurred_at DESC
       LIMIT 1
     ) AS previous ON TRUE
     WHERE candidate.occurred_at IS NOT NULL
       AND (previous.status IS DISTINCT FROM 'in_progress')
       AND NOT EXISTS (
         SELECT 1
         FROM activity_issue_status_history existing
         WHERE existing.issue_id = candidate.issue_id
           AND existing.source = 'activity'
           AND existing.status = 'in_progress'
           AND existing.occurred_at = candidate.occurred_at
       )
     RETURNING issue_id`,
  );

  return result.rowCount;
}

async function insertDoneStatuses(client: PoolClient) {
  const result = await client.query<{ issue_id: string }>(
    `INSERT INTO activity_issue_status_history (
       issue_id,
       status,
       occurred_at,
       source
     )
     SELECT DISTINCT candidate.issue_id, 'done', candidate.occurred_at, 'activity'
     FROM (
       SELECT
         i.id AS issue_id,
         i.github_closed_at AS occurred_at
       FROM issues i
       JOIN pull_request_issues pri ON pri.issue_id = i.id
       JOIN pull_requests pr ON pr.id = pri.pull_request_id
       WHERE i.state = 'CLOSED'
         AND i.github_closed_at IS NOT NULL
         AND pr.merged IS TRUE
         AND pr.github_merged_at IS NOT NULL
         AND pr.github_merged_at = i.github_closed_at
         AND NOT EXISTS (
           SELECT 1
           FROM activity_issue_status_history h
           WHERE h.issue_id = i.id
             AND h.source = 'todo_project'
         )
     ) AS candidate
     WHERE candidate.occurred_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM activity_issue_status_history existing
         WHERE existing.issue_id = candidate.issue_id
           AND existing.source = 'activity'
           AND existing.status = 'done'
           AND existing.occurred_at = candidate.occurred_at
       )
     RETURNING issue_id`,
  );

  return result.rowCount;
}

export async function ensureIssueStatusAutomation(
  options: AutomationOptions = {},
): Promise<IssueStatusAutomationRunResult> {
  const { force = false, runId = null, trigger, logger } = options;
  const config = await getSyncConfig();
  const lastSuccessfulSyncAt =
    typeof config?.last_successful_sync_at === "string"
      ? config.last_successful_sync_at
      : config?.last_successful_sync_at instanceof Date
        ? config.last_successful_sync_at.toISOString()
        : null;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      AUTOMATION_LOCK_ID,
    ]);

    let shouldRun = force;
    const currentState = await fetchCurrentState(client);
    if (!shouldRun) {
      if (lastSuccessfulSyncAt === null) {
        const alreadyProcessed =
          currentState?.status === "success" &&
          (currentState.lastSuccessfulSyncAt ?? null) === null;
        shouldRun = !alreadyProcessed;
      } else {
        const alreadyProcessed =
          currentState?.status === "success" &&
          currentState.lastSuccessfulSyncAt === lastSuccessfulSyncAt;
        shouldRun = !alreadyProcessed;
      }
    }

    if (!shouldRun) {
      await client.query("COMMIT");
      return {
        processed: false,
        insertedInProgress: 0,
        insertedDone: 0,
      };
    }

    await upsertAutomationState(client, {
      status: "running",
      runId,
      lastSuccessfulSyncAt,
      trigger,
    });

    const insertedInProgress = (await insertInProgressStatuses(client)) ?? 0;
    const insertedDone = (await insertDoneStatuses(client)) ?? 0;

    await upsertAutomationState(client, {
      status: "success",
      runId,
      lastSuccessfulSyncAt,
      trigger,
      insertedInProgress,
      insertedDone,
    });

    await client.query("COMMIT");

    logger?.(
      `[status-automation] Inserted ${insertedInProgress} in-progress and ${insertedDone} done statuses.`,
    );

    return {
      processed: true,
      insertedInProgress,
      insertedDone,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown automation failure.";

    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        AUTOMATION_LOCK_ID,
      ]);
      await upsertAutomationState(client, {
        status: "failed",
        runId,
        lastSuccessfulSyncAt,
        trigger,
        error: message,
        insertedInProgress: 0,
        insertedDone: 0,
      });
      await client.query("COMMIT");
    } catch (loggingError) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }
      const loggingMessage =
        loggingError instanceof Error
          ? loggingError.message
          : "Unknown automation logging failure.";
      logger?.(
        `[status-automation] Failed to record automation failure state: ${loggingMessage}`,
      );
    }

    logger?.(`[status-automation] Failed to apply automation: ${message}`);
    throw error;
  } finally {
    client.release();
  }
}

export async function getIssueStatusAutomationSummary(): Promise<IssueStatusAutomationSummary | null> {
  const pool = getPool();
  const result = await pool.query<AutomationStateRow>(
    `SELECT cache_key,
            generated_at,
            updated_at,
            sync_run_id,
            item_count,
            metadata
       FROM activity_cache_state
       WHERE cache_key = $1`,
    [AUTOMATION_CACHE_KEY],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const metadata = row.metadata ?? null;
  const status = toStatus(metadata?.status);
  const trigger =
    typeof metadata?.trigger === "string" && metadata.trigger.trim().length
      ? metadata.trigger
      : null;

  const lastSuccessfulSyncAt = toStringOrNull(metadata?.lastSuccessfulSyncAt);
  const insertedInProgress = toNumberOrZero(metadata?.insertedInProgress);
  const insertedDone = toNumberOrZero(metadata?.insertedDone);
  const error =
    typeof metadata?.error === "string" && metadata.error.trim().length
      ? metadata.error
      : null;

  const runId =
    typeof metadata?.runId === "number" && Number.isFinite(metadata.runId)
      ? metadata.runId
      : (row.sync_run_id ?? null);

  return {
    cacheKey: row.cache_key,
    generatedAt: row.generated_at ?? null,
    updatedAt: row.updated_at ?? null,
    syncRunId: row.sync_run_id ?? null,
    runId,
    status,
    trigger,
    lastSuccessfulSyncAt,
    insertedInProgress,
    insertedDone,
    itemCount: row.item_count ?? 0,
    error,
  };
}

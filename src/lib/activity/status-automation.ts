import type { PoolClient } from "pg";

import { getPool } from "@/lib/db/client";
import { getSyncConfig } from "@/lib/db/operations";
import { env } from "@/lib/env";

const AUTOMATION_CACHE_KEY = "issue-status-automation";
const AUTOMATION_LOCK_ID = BigInt("4422100313370042");

type AutomationState = {
  status?: "running" | "success" | "failed";
  lastSuccessfulSyncAt?: string | null;
  runId?: number | null;
  trigger?: string;
  insertedInProgress?: number;
  insertedDone?: number;
  insertedCanceled?: number;
  error?: string;
  lastSuccessAt?: string | null;
  lastSuccessSyncAt?: string | null;
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
  insertedCanceled: number;
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
  lastSuccessAt: string | null;
  lastSuccessSyncAt: string | null;
  insertedInProgress: number;
  insertedDone: number;
  insertedCanceled: number;
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
    insertedCanceled?: number;
    error?: string | null;
    lastSuccessAt?: string | null;
    lastSuccessSyncAt?: string | null;
  },
) {
  const {
    status,
    runId,
    lastSuccessfulSyncAt,
    trigger,
    insertedInProgress = 0,
    insertedDone = 0,
    insertedCanceled = 0,
    error = null,
    lastSuccessAt = null,
    lastSuccessSyncAt = null,
  } = params;

  const metadata: AutomationState = {
    status,
    runId,
    lastSuccessfulSyncAt,
    trigger,
    insertedInProgress,
    insertedDone,
    insertedCanceled,
    error: error ?? undefined,
    lastSuccessAt,
    lastSuccessSyncAt,
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
      insertedInProgress + insertedDone + insertedCanceled,
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
         GREATEST(
           i.github_closed_at,
           merged_data.latest_merged_at
         ) AS occurred_at
       FROM issues i
       JOIN pull_request_issues pri ON pri.issue_id = i.id
       JOIN pull_requests pr ON pr.id = pri.pull_request_id
       JOIN LATERAL (
         SELECT
           MAX(pr_inner.github_merged_at) AS latest_merged_at
         FROM pull_request_issues pri_inner
         JOIN pull_requests pr_inner ON pr_inner.id = pri_inner.pull_request_id
         WHERE pri_inner.issue_id = i.id
           AND pr_inner.merged IS TRUE
           AND pr_inner.github_merged_at IS NOT NULL
       ) AS merged_data ON TRUE
       WHERE i.state = 'CLOSED'
         AND i.github_closed_at IS NOT NULL
         AND pr.merged IS TRUE
         AND pr.github_merged_at IS NOT NULL
         AND merged_data.latest_merged_at IS NOT NULL
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
       )
     RETURNING issue_id`,
  );

  return result.rowCount;
}

function normalizeText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

async function insertCanceledStatuses(client: PoolClient) {
  const targetProject = normalizeText(env.TODO_PROJECT_NAME);
  if (!targetProject) {
    return 0;
  }

  const result = await client.query<{ issue_id: string }>(
    `WITH latest_status AS (
       SELECT
         issue_id,
         status,
         source,
         occurred_at,
         ROW_NUMBER() OVER (PARTITION BY issue_id ORDER BY occurred_at DESC) AS row_number
       FROM activity_issue_status_history
     ),
     latest_todo_in_progress AS (
       SELECT issue_id, occurred_at
       FROM latest_status
       WHERE row_number = 1
         AND source = 'todo_project'
         AND status = 'in_progress'
     ),
     candidate AS (
       SELECT
         i.id AS issue_id,
         COALESCE(
           i.github_updated_at,
           i.github_closed_at,
           latest_todo_in_progress.occurred_at,
           NOW()
         ) AS occurred_at
       FROM issues i
       JOIN latest_todo_in_progress ON latest_todo_in_progress.issue_id = i.id
       WHERE NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)) AS node
         WHERE LOWER(TRIM(COALESCE(
           node->'project'->>'title',
           node->'project'->>'name',
           node->>'projectTitle',
           ''
         ))) = $1
       )
     )
     INSERT INTO activity_issue_status_history (
       issue_id,
       status,
       occurred_at,
       source
     )
     SELECT
       candidate.issue_id,
       'canceled',
       candidate.occurred_at,
       'activity'
     FROM candidate
     WHERE NOT EXISTS (
       SELECT 1
       FROM activity_issue_status_history existing
       WHERE existing.issue_id = candidate.issue_id
         AND existing.source = 'activity'
         AND existing.status = 'canceled'
     )
     RETURNING issue_id`,
    [targetProject],
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
  let previousSuccessAt: string | null = null;
  let previousSuccessSyncAt: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [
      AUTOMATION_LOCK_ID,
    ]);

    let shouldRun = force;
    const currentState = await fetchCurrentState(client);
    previousSuccessAt = currentState?.lastSuccessAt ?? null;
    previousSuccessSyncAt = currentState?.lastSuccessSyncAt ?? null;
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
        insertedCanceled: 0,
      };
    }

    await upsertAutomationState(client, {
      status: "running",
      runId,
      lastSuccessfulSyncAt,
      trigger,
      lastSuccessAt: previousSuccessAt,
      lastSuccessSyncAt: previousSuccessSyncAt,
    });

    const insertedInProgress = (await insertInProgressStatuses(client)) ?? 0;
    const insertedDone = (await insertDoneStatuses(client)) ?? 0;
    const insertedCanceled = (await insertCanceledStatuses(client)) ?? 0;
    const successAt = new Date().toISOString();

    await upsertAutomationState(client, {
      status: "success",
      runId,
      lastSuccessfulSyncAt,
      trigger,
      insertedInProgress,
      insertedDone,
      insertedCanceled,
      lastSuccessAt: successAt,
      lastSuccessSyncAt: lastSuccessfulSyncAt,
    });

    await client.query("COMMIT");

    logger?.(
      `[status-automation] Inserted ${insertedInProgress} in-progress, ${insertedDone} done, and ${insertedCanceled} canceled statuses.`,
    );

    return {
      processed: true,
      insertedInProgress,
      insertedDone,
      insertedCanceled,
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
        insertedCanceled: 0,
        lastSuccessAt: previousSuccessAt,
        lastSuccessSyncAt: previousSuccessSyncAt,
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
  const lastSuccessAt = toStringOrNull(metadata?.lastSuccessAt);
  const lastSuccessSyncAt = toStringOrNull(metadata?.lastSuccessSyncAt);
  const insertedInProgress = toNumberOrZero(metadata?.insertedInProgress);
  const insertedDone = toNumberOrZero(metadata?.insertedDone);
  const insertedCanceled = toNumberOrZero(metadata?.insertedCanceled);
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
    lastSuccessAt,
    lastSuccessSyncAt,
    insertedInProgress,
    insertedDone,
    insertedCanceled,
    itemCount: row.item_count ?? 0,
    error,
  };
}

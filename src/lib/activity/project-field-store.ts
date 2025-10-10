import { query } from "@/lib/db/client";

export type ProjectFieldOverrides = {
  priority: string | null;
  priorityUpdatedAt: string | null;
  weight: string | null;
  weightUpdatedAt: string | null;
  initiationOptions: string | null;
  initiationOptionsUpdatedAt: string | null;
  startDate: string | null;
  startDateUpdatedAt: string | null;
};

export type ProjectFieldOverrideUpdate = {
  priority?: string | null;
  weight?: string | null;
  initiationOptions?: string | null;
  startDate?: string | null;
};

type ProjectFieldOverrideRow = {
  issue_id: string;
  priority_value: string | null;
  priority_updated_at: string | null;
  weight_value: string | null;
  weight_updated_at: string | null;
  initiation_value: string | null;
  initiation_updated_at: string | null;
  start_date_value: string | null;
  start_date_updated_at: string | null;
};

function formatRow(row: ProjectFieldOverrideRow): ProjectFieldOverrides {
  return {
    priority: row.priority_value,
    priorityUpdatedAt: row.priority_updated_at,
    weight: row.weight_value,
    weightUpdatedAt: row.weight_updated_at,
    initiationOptions: row.initiation_value,
    initiationOptionsUpdatedAt: row.initiation_updated_at,
    startDate: row.start_date_value,
    startDateUpdatedAt: row.start_date_updated_at,
  };
}

function hasOwn<T extends object>(object: T, key: keyof T) {
  return Object.hasOwn(object, key);
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function getProjectFieldOverrides(issueIds: string[]) {
  if (!issueIds.length) {
    return new Map<string, ProjectFieldOverrides>();
  }

  const result = await query<ProjectFieldOverrideRow>(
    `SELECT
       issue_id,
       priority_value,
       priority_updated_at,
       weight_value,
       weight_updated_at,
       initiation_value,
       initiation_updated_at,
       start_date_value,
       start_date_updated_at
     FROM activity_issue_project_overrides
     WHERE issue_id = ANY($1::text[])`,
    [issueIds],
  );

  const map = new Map<string, ProjectFieldOverrides>();
  result.rows.forEach((row) => {
    map.set(row.issue_id, formatRow(row));
  });
  return map;
}

async function getProjectFieldOverride(issueId: string) {
  const result = await query<ProjectFieldOverrideRow>(
    `SELECT
       issue_id,
       priority_value,
       priority_updated_at,
       weight_value,
       weight_updated_at,
       initiation_value,
       initiation_updated_at,
       start_date_value,
       start_date_updated_at
     FROM activity_issue_project_overrides
     WHERE issue_id = $1
     LIMIT 1`,
    [issueId],
  );

  const row = result.rows[0];
  return row ? formatRow(row) : null;
}

function allFieldsNull(overrides: ProjectFieldOverrides) {
  return (
    !overrides.priority &&
    !overrides.weight &&
    !overrides.initiationOptions &&
    !overrides.startDate
  );
}

export async function applyProjectFieldOverrides(
  issueId: string,
  updates: ProjectFieldOverrideUpdate,
) {
  const existing = (await getProjectFieldOverride(issueId)) ?? {
    priority: null,
    priorityUpdatedAt: null,
    weight: null,
    weightUpdatedAt: null,
    initiationOptions: null,
    initiationOptionsUpdatedAt: null,
    startDate: null,
    startDateUpdatedAt: null,
  };

  const next: ProjectFieldOverrides = { ...existing };
  let hasChanges = false;

  if (hasOwn(updates, "priority")) {
    const normalized = normalizeText(updates.priority ?? null);
    if (normalized !== next.priority) {
      next.priority = normalized;
      next.priorityUpdatedAt = normalized ? new Date().toISOString() : null;
      hasChanges = true;
    }
  }

  if (hasOwn(updates, "weight")) {
    const normalized = normalizeText(updates.weight ?? null);
    if (normalized !== next.weight) {
      next.weight = normalized;
      next.weightUpdatedAt = normalized ? new Date().toISOString() : null;
      hasChanges = true;
    }
  }

  if (hasOwn(updates, "initiationOptions")) {
    const normalized = normalizeText(updates.initiationOptions ?? null);
    if (normalized !== next.initiationOptions) {
      next.initiationOptions = normalized;
      next.initiationOptionsUpdatedAt = normalized
        ? new Date().toISOString()
        : null;
      hasChanges = true;
    }
  }

  if (hasOwn(updates, "startDate")) {
    const normalized = normalizeText(updates.startDate ?? null);
    if (normalized !== next.startDate) {
      next.startDate = normalized;
      next.startDateUpdatedAt = normalized ? new Date().toISOString() : null;
      hasChanges = true;
    }
  }

  if (!hasChanges) {
    return existing;
  }

  if (allFieldsNull(next)) {
    await clearProjectFieldOverrides(issueId);
    return {
      priority: null,
      priorityUpdatedAt: null,
      weight: null,
      weightUpdatedAt: null,
      initiationOptions: null,
      initiationOptionsUpdatedAt: null,
      startDate: null,
      startDateUpdatedAt: null,
    };
  }

  await query(
    `INSERT INTO activity_issue_project_overrides (
       issue_id,
       priority_value,
       priority_updated_at,
       weight_value,
       weight_updated_at,
       initiation_value,
       initiation_updated_at,
       start_date_value,
       start_date_updated_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (issue_id) DO UPDATE SET
       priority_value = EXCLUDED.priority_value,
       priority_updated_at = EXCLUDED.priority_updated_at,
       weight_value = EXCLUDED.weight_value,
       weight_updated_at = EXCLUDED.weight_updated_at,
       initiation_value = EXCLUDED.initiation_value,
       initiation_updated_at = EXCLUDED.initiation_updated_at,
       start_date_value = EXCLUDED.start_date_value,
       start_date_updated_at = EXCLUDED.start_date_updated_at,
       updated_at = NOW()`,
    [
      issueId,
      next.priority,
      next.priorityUpdatedAt,
      next.weight,
      next.weightUpdatedAt,
      next.initiationOptions,
      next.initiationOptionsUpdatedAt,
      next.startDate,
      next.startDateUpdatedAt,
    ],
  );

  return next;
}

export async function clearProjectFieldOverrides(issueId: string) {
  await query(
    `DELETE FROM activity_issue_project_overrides WHERE issue_id = $1`,
    [issueId],
  );
}

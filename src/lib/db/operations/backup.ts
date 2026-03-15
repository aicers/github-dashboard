import { query } from "@/lib/db/client";

import { toIsoString } from "./types";

export type DbBackupStatus = "running" | "success" | "failed";
export type DbBackupTrigger = "automatic" | "manual";

type DbBackupRow = {
  id: number;
  filename: string;
  directory: string;
  file_path: string;
  status: DbBackupStatus;
  trigger_type: DbBackupTrigger;
  started_at: string | Date;
  completed_at: string | Date | null;
  size_bytes: string | number | null;
  error: string | null;
  restored_at: string | Date | null;
  created_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type DbBackupRecord = {
  id: number;
  filename: string;
  directory: string;
  filePath: string;
  status: DbBackupStatus;
  trigger: DbBackupTrigger;
  startedAt: string;
  completedAt: string | null;
  sizeBytes: number | null;
  error: string | null;
  restoredAt: string | null;
  createdBy: string | null;
};

function mapBackupRow(row: DbBackupRow): DbBackupRecord {
  let sizeBytes: number | null = null;
  if (row.size_bytes !== null && row.size_bytes !== undefined) {
    const parsed =
      typeof row.size_bytes === "string"
        ? Number.parseInt(row.size_bytes, 10)
        : Number(row.size_bytes);
    sizeBytes = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    id: row.id,
    filename: row.filename,
    directory: row.directory,
    filePath: row.file_path,
    status: row.status,
    trigger: row.trigger_type,
    startedAt: toIsoString(row.started_at) ?? new Date().toISOString(),
    completedAt: toIsoString(row.completed_at),
    sizeBytes,
    error: row.error,
    restoredAt: toIsoString(row.restored_at),
    createdBy: row.created_by,
  };
}

export async function createBackupRecord(params: {
  filename: string;
  directory: string;
  filePath: string;
  trigger: DbBackupTrigger;
  startedAt?: string | null;
  createdBy?: string | null;
}) {
  const result = await query<DbBackupRow>(
    `INSERT INTO db_backups (filename, directory, file_path, status, trigger_type, started_at, created_by)
     VALUES ($1, $2, $3, 'running', $4, COALESCE($5, NOW()), $6)
     RETURNING id, filename, directory, file_path, status, trigger_type, started_at, completed_at, size_bytes, error, restored_at, created_by, created_at, updated_at`,
    [
      params.filename,
      params.directory,
      params.filePath,
      params.trigger,
      params.startedAt ?? null,
      params.createdBy ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapBackupRow(row) : null;
}

export async function markBackupSuccess(params: {
  id: number;
  sizeBytes?: number | null;
  completedAt?: string | null;
}) {
  const result = await query<DbBackupRow>(
    `UPDATE db_backups
     SET status = 'success',
         completed_at = COALESCE($2, NOW()),
         size_bytes = $3,
         error = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, filename, directory, file_path, status, trigger_type, started_at, completed_at, size_bytes, error, restored_at, created_by, created_at, updated_at`,
    [params.id, params.completedAt ?? null, params.sizeBytes ?? null],
  );

  const row = result.rows[0];
  return row ? mapBackupRow(row) : null;
}

export async function markBackupFailure(params: {
  id: number;
  error: string;
  completedAt?: string | null;
}) {
  const result = await query<DbBackupRow>(
    `UPDATE db_backups
     SET status = 'failed',
         completed_at = COALESCE($3, NOW()),
         error = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, filename, directory, file_path, status, trigger_type, started_at, completed_at, size_bytes, error, restored_at, created_by, created_at, updated_at`,
    [params.id, params.error, params.completedAt ?? null],
  );

  const row = result.rows[0];
  return row ? mapBackupRow(row) : null;
}

export async function listBackups(limit = 20): Promise<DbBackupRecord[]> {
  const result = await query<DbBackupRow>(
    `SELECT id, filename, directory, file_path, status, trigger_type, started_at, completed_at, size_bytes, error, restored_at, created_by, created_at, updated_at
     FROM db_backups
     ORDER BY started_at DESC
     LIMIT $1`,
    [Math.max(limit, 1)],
  );

  return result.rows.map(mapBackupRow);
}

export async function getBackupRecord(id: number) {
  const result = await query<DbBackupRow>(
    `SELECT id, filename, directory, file_path, status, trigger_type, started_at, completed_at, size_bytes, error, restored_at, created_by, created_at, updated_at
     FROM db_backups
     WHERE id = $1`,
    [id],
  );

  const row = result.rows[0];
  return row ? mapBackupRow(row) : null;
}

export async function markBackupRestored(params: {
  id: number;
  restoredAt?: string | null;
}) {
  await query(
    `UPDATE db_backups
     SET restored_at = COALESCE($2, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [params.id, params.restoredAt ?? null],
  );
}

export async function deleteBackupRecord(id: number) {
  await query(`DELETE FROM db_backups WHERE id = $1`, [id]);
}

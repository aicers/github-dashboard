import type { IssueProjectStatus } from "@/lib/activity/types";
import { query } from "@/lib/db/client";

export type ActivityStatusEvent = {
  status: IssueProjectStatus;
  occurredAt: string;
};

function mapRowStatus(rowStatus: string): IssueProjectStatus | null {
  switch (rowStatus) {
    case "no_status":
    case "todo":
    case "in_progress":
    case "done":
    case "pending":
      return rowStatus;
    default:
      return null;
  }
}

export async function recordActivityStatus(
  issueId: string,
  status: IssueProjectStatus,
  occurredAt?: Date,
) {
  const params: unknown[] = [issueId, status];
  if (occurredAt) {
    params.push(occurredAt.toISOString());
  }

  const occurredColumn = occurredAt ? "$3::timestamptz" : "NOW()";

  await query(
    `INSERT INTO activity_issue_status_history (issue_id, status, occurred_at)
     VALUES ($1, $2, ${occurredColumn})`,
    params,
  );
}

export async function clearActivityStatuses(issueId: string) {
  await query(`DELETE FROM activity_issue_status_history WHERE issue_id = $1`, [
    issueId,
  ]);
}

export async function getLatestActivityStatuses(
  issueIds: string[],
): Promise<Map<string, ActivityStatusEvent>> {
  if (!issueIds.length) {
    return new Map();
  }

  const result = await query<{
    issue_id: string;
    status: string;
    occurred_at: string;
  }>(
    `SELECT DISTINCT ON (issue_id)
       issue_id,
       status,
       occurred_at
     FROM activity_issue_status_history
     WHERE issue_id = ANY($1::text[])
     ORDER BY issue_id, occurred_at DESC`,
    [issueIds],
  );

  const map = new Map<string, ActivityStatusEvent>();
  result.rows.forEach((row) => {
    const status = mapRowStatus(row.status);
    if (!status) {
      return;
    }
    map.set(row.issue_id, {
      status,
      occurredAt: row.occurred_at,
    });
  });
  return map;
}

export async function getActivityStatusHistory(
  issueIds: string[],
): Promise<Map<string, ActivityStatusEvent[]>> {
  if (!issueIds.length) {
    return new Map();
  }

  const result = await query<{
    issue_id: string;
    status: string;
    occurred_at: string;
  }>(
    `SELECT
       issue_id,
       status,
       occurred_at
     FROM activity_issue_status_history
     WHERE issue_id = ANY($1::text[])
     ORDER BY issue_id, occurred_at`,
    [issueIds],
  );

  const map = new Map<string, ActivityStatusEvent[]>();
  result.rows.forEach((row) => {
    const status = mapRowStatus(row.status);
    if (!status) {
      return;
    }

    let list = map.get(row.issue_id);
    if (!list) {
      list = [];
      map.set(row.issue_id, list);
    }

    list.push({
      status,
      occurredAt: row.occurred_at,
    });
  });

  return map;
}

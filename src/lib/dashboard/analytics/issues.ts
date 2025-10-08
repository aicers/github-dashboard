import { normalizeText } from "@/lib/dashboard/analytics/shared";
import type { MultiTrendPoint } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";

type IssueAggregateRow = {
  issues_created: number;
  issues_closed: number;
  avg_resolution_hours: number | null;
  reopened_count: number;
  avg_comments_issue: number | null;
};

export async function fetchIssueAggregates(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IssueAggregateRow> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const repoParamIndex = params.length;
    repoClause = ` AND i.repository_id = ANY($${repoParamIndex}::text[])`;
  }

  const result = await query<IssueAggregateRow>(
    `SELECT
       COUNT(*) FILTER (WHERE i.github_created_at BETWEEN $1 AND $2) AS issues_created,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $1 AND $2) AS issues_closed,
       AVG(EXTRACT(EPOCH FROM (i.github_closed_at - i.github_created_at)) / 3600.0)
         FILTER (WHERE i.github_closed_at BETWEEN $1 AND $2 AND i.github_closed_at IS NOT NULL) AS avg_resolution_hours,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $1 AND $2 AND i.state = 'OPEN') AS reopened_count,
       AVG(COALESCE((i.data -> 'comments' ->> 'totalCount')::numeric, 0))
         FILTER (
           WHERE i.github_closed_at BETWEEN $1 AND $2
             AND i.github_closed_at IS NOT NULL
         ) AS avg_comments_issue
     FROM issues i
     WHERE (i.github_created_at BETWEEN $1 AND $2
        OR i.github_closed_at BETWEEN $1 AND $2)${repoClause}`,
    params,
  );

  return (
    result.rows[0] ?? {
      issues_created: 0,
      issues_closed: 0,
      avg_resolution_hours: null,
      reopened_count: 0,
      avg_comments_issue: null,
    }
  );
}

type IssueDurationDetailRow = {
  id: string;
  github_created_at: string | Date;
  github_closed_at: string | Date;
  data: unknown;
};

export async function fetchIssueDurationDetails(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  authorId?: string,
): Promise<IssueDurationDetailRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    repoClause = ` AND i.repository_id = ANY($${params.length}::text[])`;
  }

  let authorClause = "";
  if (authorId) {
    params.push(authorId);
    authorClause = ` AND i.author_id = $${params.length}`;
  }

  const result = await query<IssueDurationDetailRow>(
    `SELECT
       i.id,
       i.github_created_at,
       i.github_closed_at,
       i.data
     FROM issues i
     WHERE i.github_closed_at BETWEEN $1 AND $2
       AND i.github_closed_at IS NOT NULL${repoClause}${authorClause}`,
    params,
  );

  return result.rows;
}

type IssueDurationSummary = {
  parentResolution: number | null;
  childResolution: number | null;
  parentWork: number | null;
  childWork: number | null;
  overallWork: number | null;
};

type IssueDurationAccumulator = {
  sum: number;
  count: number;
};

type IssueRaw = {
  trackedIssues?: unknown;
  trackedInIssues?: unknown;
  timelineItems?: { nodes?: unknown[] };
  projectItems?: { nodes?: unknown[] };
  reactions?: { nodes?: unknown[] };
  projectStatusHistory?: unknown;
  [key: string]: unknown;
};

function createAccumulator(): IssueDurationAccumulator {
  return { sum: 0, count: 0 };
}

function addSample(acc: IssueDurationAccumulator, value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return;
  }

  acc.sum += value;
  acc.count += 1;
}

function finalizeAccumulator(acc: IssueDurationAccumulator): number | null {
  return acc.count > 0 ? acc.sum / acc.count : Number.NaN;
}

function parseIssueRaw(data: unknown): IssueRaw | null {
  if (!data) {
    return null;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as IssueRaw;
      }
      return null;
    } catch {
      return null;
    }
  }

  if (typeof data === "object") {
    return data as IssueRaw;
  }

  return null;
}

function extractTotalCount(node: unknown): number {
  if (!node || typeof node !== "object") {
    return 0;
  }

  const total = (node as Record<string, unknown>).totalCount;
  if (typeof total === "number") {
    return Number.isFinite(total) ? total : 0;
  }

  if (typeof total === "string") {
    const parsed = Number(total);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function classifyIssue(raw: IssueRaw): {
  isParent: boolean;
  isChild: boolean;
} {
  const trackedIssues = extractTotalCount(raw.trackedIssues);
  const trackedInIssues = extractTotalCount(raw.trackedInIssues);
  const isParent = trackedIssues > 0;
  return {
    isParent,
    // Treat issues without explicit parent/child links as child issues by default.
    isChild: trackedInIssues > 0 || !isParent,
  };
}

function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  if (typeof value !== "string") {
    return null;
  }

  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function calculateHoursBetween(
  start: string | Date | null,
  end: string | Date | null,
): number | null {
  if (!start || !end) {
    return null;
  }

  const startTime = parseTimestamp(start);
  const endTime = parseTimestamp(end);
  if (startTime === null || endTime === null) {
    return null;
  }

  const durationMs = endTime - startTime;
  if (durationMs < 0) {
    return null;
  }

  return durationMs / 3_600_000;
}

type WorkTimestamps = {
  startedAt: string | null;
  completedAt: string | null;
};

function matchProject(projectName: unknown, target: string | null) {
  if (!target) {
    return false;
  }

  return normalizeText(projectName) === target;
}

type TimelineEventNode = Record<string, unknown> & {
  __typename?: string;
};

function extractProjectFieldValueName(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") {
    return record.name;
  }
  if (typeof record.title === "string") {
    return record.title;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.number === "number") {
    return String(record.number);
  }
  return null;
}

function normalizeStatus(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase();
}

function isInProgressStatus(status: string) {
  return (
    status.includes("progress") ||
    status === "doing" ||
    status === "in-progress"
  );
}

function isDoneStatus(status: string) {
  return (
    status === "done" ||
    status === "completed" ||
    status === "complete" ||
    status === "finished" ||
    status === "closed"
  );
}

function extractWorkTimestamps(
  raw: IssueRaw,
  targetProject: string | null,
): WorkTimestamps {
  const empty: WorkTimestamps = { startedAt: null, completedAt: null };
  if (!targetProject) {
    return empty;
  }

  const timelineNodes = Array.isArray(raw.timelineItems?.nodes)
    ? (raw.timelineItems?.nodes as TimelineEventNode[])
    : [];

  const statusEvents: Array<{ status: string; createdAt: string }> = [];
  const seenStatusEvents = new Set<string>();
  let projectAddedAt: string | null = null;

  const addNormalizedStatusEvent = (
    normalizedStatus: string | null,
    createdAt: string | null,
  ) => {
    if (!normalizedStatus || !createdAt) {
      return;
    }

    if (normalizedStatus.startsWith("__")) {
      return;
    }

    const key = `${normalizedStatus}|${createdAt}`;
    if (seenStatusEvents.has(key)) {
      return;
    }

    seenStatusEvents.add(key);
    statusEvents.push({ status: normalizedStatus, createdAt });
  };

  const addStatusEvent = (
    statusLabel: string | null,
    createdAt: string | null,
  ) => {
    addNormalizedStatusEvent(normalizeStatus(statusLabel), createdAt);
  };

  const updateProjectAddedAt = (timestamp: string | null) => {
    if (!timestamp) {
      return;
    }

    if (!projectAddedAt) {
      projectAddedAt = timestamp;
      return;
    }

    const current = parseTimestamp(projectAddedAt);
    const candidate = parseTimestamp(timestamp);
    if (candidate !== null && (current === null || candidate < current)) {
      projectAddedAt = timestamp;
    }
  };

  timelineNodes.forEach((node) => {
    if (!node) {
      return;
    }

    const type = typeof node.__typename === "string" ? node.__typename : "";
    if (
      type === "AddedToProjectEvent" ||
      type === "MovedColumnsInProjectEvent"
    ) {
      const projectName =
        node.project && typeof node.project === "object"
          ? normalizeText((node.project as Record<string, unknown>).name)
          : null;
      if (!matchProject(projectName, targetProject)) {
        return;
      }

      const columnName = normalizeStatus(
        (typeof node.projectColumnName === "string"
          ? node.projectColumnName
          : typeof (node as Record<string, unknown>).columnName === "string"
            ? ((node as Record<string, unknown>).columnName as string)
            : null) ?? null,
      );
      const createdAt =
        typeof node.createdAt === "string" ? node.createdAt : null;
      if (!columnName || !createdAt) {
        return;
      }

      if (type === "AddedToProjectEvent") {
        updateProjectAddedAt(createdAt);
      }
      addNormalizedStatusEvent(columnName, createdAt);
      return;
    }

    if (type === "ProjectV2ItemFieldValueChangedEvent") {
      const projectItem = node.projectItem as
        | { project?: { title?: string | null } }
        | undefined;
      const projectTitle = projectItem?.project?.title ?? null;
      if (!matchProject(projectTitle, targetProject)) {
        return;
      }

      const fieldName = normalizeStatus(
        (node as Record<string, unknown>).fieldName as string | null,
      );
      if (fieldName !== "status") {
        return;
      }

      const currentValue = extractProjectFieldValueName(
        (node as Record<string, unknown>).currentValue,
      );
      const normalizedStatus = normalizeStatus(currentValue);
      const createdAt =
        typeof node.createdAt === "string" ? node.createdAt : null;
      if (!normalizedStatus || !createdAt) {
        return;
      }

      addNormalizedStatusEvent(normalizedStatus, createdAt);
    }
  });

  const projectItems = Array.isArray(raw.projectItems?.nodes)
    ? (raw.projectItems?.nodes as Record<string, unknown>[])
    : [];

  projectItems.forEach((item) => {
    if (!item) {
      return;
    }

    const projectTitle =
      item.project && typeof item.project === "object"
        ? normalizeText((item.project as Record<string, unknown>).title)
        : null;
    if (!matchProject(projectTitle, targetProject)) {
      return;
    }

    const createdAt =
      typeof item.createdAt === "string" ? (item.createdAt as string) : null;
    updateProjectAddedAt(createdAt);

    const statusValue = (item as Record<string, unknown>).status as
      | Record<string, unknown>
      | null
      | undefined;
    if (!statusValue) {
      return;
    }

    const statusLabel = normalizeStatus(
      extractProjectFieldValueName(statusValue),
    );
    const timestamp =
      typeof statusValue.updatedAt === "string"
        ? (statusValue.updatedAt as string)
        : typeof item.updatedAt === "string"
          ? (item.updatedAt as string)
          : typeof item.createdAt === "string"
            ? (item.createdAt as string)
            : null;
    if (!statusLabel || !timestamp) {
      return;
    }

    addNormalizedStatusEvent(statusLabel, timestamp);
  });

  const history =
    raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).projectStatusHistory
      : null;

  if (Array.isArray(history)) {
    history.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const record = entry as Record<string, unknown>;
      const projectTitle = normalizeText(record.projectTitle);
      if (!matchProject(projectTitle, targetProject)) {
        return;
      }

      const statusLabel =
        typeof record.status === "string" ? record.status : null;
      const occurredAt =
        typeof record.occurredAt === "string" ? record.occurredAt : null;

      addStatusEvent(statusLabel, occurredAt);
    });
  }

  statusEvents.sort((a, b) => {
    const left = parseTimestamp(a.createdAt) ?? 0;
    const right = parseTimestamp(b.createdAt) ?? 0;
    return left - right;
  });

  let startedAt: string | null = null;
  let completedAt: string | null = null;

  for (const event of statusEvents) {
    if (!startedAt && isInProgressStatus(event.status)) {
      startedAt = event.createdAt;
    }

    if (!completedAt && isDoneStatus(event.status)) {
      completedAt = event.createdAt;
      if (startedAt) {
        break;
      }
    }
  }

  if (!startedAt && projectAddedAt) {
    startedAt = projectAddedAt;
  }

  return { startedAt, completedAt };
}

export function summarizeIssueDurations(
  rows: IssueDurationDetailRow[],
  targetProject: string | null,
): IssueDurationSummary {
  const parentResolution = createAccumulator();
  const childResolution = createAccumulator();
  const parentWork = createAccumulator();
  const childWork = createAccumulator();
  const overallWork = createAccumulator();

  rows.forEach((row) => {
    const raw = parseIssueRaw(row.data);
    const resolutionHours = calculateHoursBetween(
      row.github_created_at,
      row.github_closed_at,
    );

    // Issues without raw payload lack link metadata; default them to child-only stats.
    const fallbackClassification = { isParent: false, isChild: true };
    const classification = raw ? classifyIssue(raw) : fallbackClassification;
    if (classification.isParent) {
      addSample(parentResolution, resolutionHours);
    }
    if (classification.isChild) {
      addSample(childResolution, resolutionHours);
    }

    if (targetProject && raw) {
      const { startedAt, completedAt } = extractWorkTimestamps(
        raw,
        targetProject,
      );
      const workHours = calculateHoursBetween(startedAt, completedAt);
      addSample(overallWork, workHours);
      if (classification.isParent) {
        addSample(parentWork, workHours);
      }
      if (classification.isChild) {
        addSample(childWork, workHours);
      }
    }
  });

  return {
    parentResolution: finalizeAccumulator(parentResolution),
    childResolution: finalizeAccumulator(childResolution),
    parentWork: finalizeAccumulator(parentWork),
    childWork: finalizeAccumulator(childWork),
    overallWork: finalizeAccumulator(overallWork),
  };
}

type MonthlyBucket = {
  resolution: IssueDurationAccumulator;
  work: IssueDurationAccumulator;
};

function getMonthFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
}

export function buildMonthlyDurationTrend(
  rows: IssueDurationDetailRow[],
  targetProject: string | null,
  timeZone: string,
): MultiTrendPoint[] {
  const formatter = getMonthFormatter(timeZone);
  const buckets = new Map<string, MonthlyBucket>();

  rows.forEach((row) => {
    if (!row.github_closed_at) {
      return;
    }

    const closedDate = new Date(row.github_closed_at);
    if (Number.isNaN(closedDate.getTime())) {
      return;
    }

    const bucketKey = formatter.format(closedDate);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = {
        resolution: createAccumulator(),
        work: createAccumulator(),
      };
      buckets.set(bucketKey, bucket);
    }

    const resolutionHours = calculateHoursBetween(
      row.github_created_at,
      row.github_closed_at,
    );
    addSample(bucket.resolution, resolutionHours);

    if (targetProject) {
      const raw = parseIssueRaw(row.data);
      if (raw) {
        const { startedAt, completedAt } = extractWorkTimestamps(
          raw,
          targetProject,
        );
        const workHours = calculateHoursBetween(startedAt, completedAt);
        addSample(bucket.work, workHours);
      }
    }
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, bucket]) => ({
      date,
      values: {
        resolutionHours: finalizeAccumulator(bucket.resolution) ?? Number.NaN,
        workHours: finalizeAccumulator(bucket.work) ?? Number.NaN,
      },
    }));
}

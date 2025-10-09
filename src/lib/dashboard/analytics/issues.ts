import {
  type ActivityStatusEvent,
  getActivityStatusHistory,
} from "@/lib/activity/status-store";
import type { IssueProjectStatus } from "@/lib/activity/types";
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
  activityStatusHistory: ActivityStatusEvent[];
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

  const result = await query<
    Omit<IssueDurationDetailRow, "activityStatusHistory">
  >(
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

  const rows = result.rows;
  if (!rows.length) {
    return [];
  }

  const historyMap = await getActivityStatusHistory(rows.map((row) => row.id));

  return rows.map((row) => ({
    ...row,
    activityStatusHistory: historyMap.get(row.id) ?? [],
  }));
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

function normalizeProjectStatus(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function mapIssueProjectStatus(
  value: string | null | undefined,
): IssueProjectStatus {
  const normalized = normalizeProjectStatus(value);

  if (!normalized || normalized === "no" || normalized === "no_status") {
    return "no_status";
  }

  if (normalized === "todo" || normalized === "to_do") {
    return "todo";
  }

  if (
    normalized.includes("in_progress") ||
    normalized === "doing" ||
    normalized === "in-progress"
  ) {
    return "in_progress";
  }

  if (
    normalized === "done" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "finished" ||
    normalized === "closed"
  ) {
    return "done";
  }

  if (normalized.startsWith("pending") || normalized === "waiting") {
    return "pending";
  }

  return "no_status";
}

const ISSUE_PROJECT_STATUS_LOCKED = new Set<IssueProjectStatus>([
  "in_progress",
  "done",
  "pending",
]);

type ProjectStatusEvent = {
  status: string;
  occurredAt: string;
};

type IssueStatusInfo = {
  todoStatus: IssueProjectStatus | null;
  todoStatusAt: string | null;
  activityStatus: IssueProjectStatus | null;
  activityStatusAt: string | null;
  displayStatus: IssueProjectStatus;
  source: "todo_project" | "activity" | "none";
  locked: boolean;
  timelineSource: "todo_project" | "activity" | "none";
  projectEvents: ProjectStatusEvent[];
  projectAddedAt: string | null;
  activityEvents: ActivityStatusEvent[];
};

function collectProjectStatusEvents(
  raw: IssueRaw,
  targetProject: string | null,
): {
  events: ProjectStatusEvent[];
  projectAddedAt: string | null;
} {
  const empty = {
    events: [] as ProjectStatusEvent[],
    projectAddedAt: null as string | null,
  };
  if (!targetProject) {
    return empty;
  }

  const timelineNodes = Array.isArray(raw.timelineItems?.nodes)
    ? (raw.timelineItems?.nodes as TimelineEventNode[])
    : [];

  const statusEvents: ProjectStatusEvent[] = [];
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
    statusEvents.push({ status: normalizedStatus, occurredAt: createdAt });
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
    const left = parseTimestamp(a.occurredAt) ?? 0;
    const right = parseTimestamp(b.occurredAt) ?? 0;
    return left - right;
  });

  return { events: statusEvents, projectAddedAt };
}

function resolveIssueStatusInfo(
  raw: IssueRaw,
  targetProject: string | null,
  activityEvents: ActivityStatusEvent[],
): IssueStatusInfo {
  const timeline = collectProjectStatusEvents(raw, targetProject);
  const projectEvents = timeline.events;
  const latestProjectEvent =
    projectEvents.length > 0 ? projectEvents[projectEvents.length - 1] : null;
  const todoStatus = latestProjectEvent
    ? mapIssueProjectStatus(latestProjectEvent.status)
    : timeline.projectAddedAt
      ? "no_status"
      : null;
  const todoStatusAt = latestProjectEvent
    ? latestProjectEvent.occurredAt
    : timeline.projectAddedAt;

  const latestActivityEvent =
    activityEvents.length > 0
      ? activityEvents[activityEvents.length - 1]
      : null;
  const activityStatus = latestActivityEvent?.status ?? null;
  const activityStatusAt = latestActivityEvent?.occurredAt ?? null;
  const locked =
    todoStatus != null && ISSUE_PROJECT_STATUS_LOCKED.has(todoStatus);

  let displayStatus: IssueProjectStatus = "no_status";
  let source: IssueStatusInfo["source"] = "none";

  if (todoStatus && (locked || !activityStatus)) {
    displayStatus = todoStatus;
    source = "todo_project";
  } else if (activityStatus && !locked) {
    displayStatus = activityStatus;
    source = "activity";
  } else if (todoStatus) {
    displayStatus = todoStatus;
    source = "todo_project";
  }

  let timelineSource: IssueStatusInfo["timelineSource"] = "none";
  if (locked) {
    timelineSource = "todo_project";
  } else if (activityEvents.length > 0) {
    timelineSource = "activity";
  } else if (projectEvents.length > 0 || timeline.projectAddedAt) {
    timelineSource = "todo_project";
  }

  return {
    todoStatus,
    todoStatusAt,
    activityStatus,
    activityStatusAt,
    displayStatus,
    source,
    locked,
    timelineSource,
    projectEvents,
    projectAddedAt: timeline.projectAddedAt,
    activityEvents,
  };
}

function resolveWorkTimestamps(info: IssueStatusInfo | null): WorkTimestamps {
  if (!info) {
    return { startedAt: null, completedAt: null };
  }

  if (info.timelineSource === "activity") {
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    info.activityEvents.forEach((event) => {
      switch (event.status) {
        case "in_progress":
          startedAt = event.occurredAt;
          completedAt = null;
          break;
        case "done":
          if (startedAt && !completedAt) {
            completedAt = event.occurredAt;
          }
          break;
        case "todo":
        case "no_status":
          startedAt = null;
          completedAt = null;
          break;
        default:
          break;
      }
    });
    return { startedAt, completedAt };
  }

  if (info.timelineSource === "todo_project") {
    let startedAt: string | null = null;
    let completedAt: string | null = null;
    info.projectEvents.forEach((event) => {
      const mapped = mapIssueProjectStatus(event.status);
      if (mapped === "in_progress") {
        startedAt = event.occurredAt;
        completedAt = null;
        return;
      }
      if (mapped === "done") {
        if (startedAt && !completedAt) {
          completedAt = event.occurredAt;
        }
        return;
      }
      if (mapped === "todo" || mapped === "no_status") {
        startedAt = null;
        completedAt = null;
      }
    });
    if (!startedAt && info.projectAddedAt) {
      startedAt = info.projectAddedAt;
    }
    return { startedAt, completedAt };
  }

  return { startedAt: null, completedAt: null };
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
      const statusInfo = resolveIssueStatusInfo(
        raw,
        targetProject,
        row.activityStatusHistory,
      );
      const { startedAt, completedAt } = resolveWorkTimestamps(statusInfo);
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
        const statusInfo = resolveIssueStatusInfo(
          raw,
          targetProject,
          row.activityStatusHistory,
        );
        const { startedAt, completedAt } = resolveWorkTimestamps(statusInfo);
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

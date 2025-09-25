import type {
  AnalyticsParams,
  ComparisonBreakdownEntry,
  ComparisonValue,
  DashboardAnalytics,
  DurationComparisonValue,
  HeatmapCell,
  LeaderboardEntry,
  LeaderboardSummary,
  MetricHistoryEntry,
  MultiTrendPoint,
  OrganizationAnalytics,
  PeriodKey,
  RepoComparisonRow,
  RepoDistributionItem,
  ReviewerActivity,
  TrendPoint,
  WeekStart,
} from "@/lib/dashboard/types";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  getRepositoryProfiles,
  getSyncConfig,
  getUserProfiles,
  type RepositoryProfile,
  type UserProfile,
} from "@/lib/db/operations";
import { env } from "@/lib/env";

const HOLIDAY_SET = buildHolidaySet(env.HOLIDAYS);

const DEPENDABOT_FILTER =
  "NOT (COALESCE(LOWER(u.login), '') LIKE 'dependabot%' OR COALESCE(LOWER(u.login), '') = 'app/dependabot')";

function toIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date.toISOString();
}

function differenceInDays(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const msPerDay = 86_400_000;
  return Math.max(1, Math.floor((end - start) / msPerDay) + 1);
}

function subtractDuration(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - durationMs);
  return {
    previousStart: previousStart.toISOString(),
    previousEnd: previousEnd.toISOString(),
  };
}

function calculatePercentChange(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }

  if (previous === 0) {
    return current === 0 ? 0 : null;
  }

  return ((current - previous) / previous) * 100;
}

function buildComparison(
  current: number,
  previous: number,
  breakdown?: ComparisonBreakdownEntry[],
): ComparisonValue {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);
  return {
    current: currentValue,
    previous: previousValue,
    absoluteChange: currentValue - previousValue,
    percentChange: calculatePercentChange(currentValue, previousValue),
    breakdown: breakdown?.length ? breakdown : undefined,
  };
}

function buildDurationComparison(
  currentHours: number | null,
  previousHours: number | null,
  unit: "hours" | "days",
): DurationComparisonValue {
  const normalize = (value: number | string | null | undefined) => {
    if (value === null || value === undefined) {
      return Number.NaN;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
  };

  const current = normalize(currentHours);
  const previous = normalize(previousHours);
  return {
    current,
    previous,
    absoluteChange: current - previous,
    percentChange: calculatePercentChange(current, previous),
    unit,
  };
}

function buildRatioComparison(
  current: number | null,
  previous: number | null,
): ComparisonValue {
  return buildComparison(current ?? 0, previous ?? 0);
}

const HISTORY_PERIODS: PeriodKey[] = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
];

function normalizeHistoryValue(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildHistorySeries(
  values: Array<number | null | undefined>,
): MetricHistoryEntry[] {
  return HISTORY_PERIODS.map((period, index) => ({
    period,
    value: normalizeHistoryValue(values[index]),
  }));
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function buildHolidaySet(dates: string[]): Set<string> {
  const set = new Set<string>();
  dates.forEach((date) => {
    const normalized = normalizeHolidayDate(date);
    if (normalized) {
      set.add(normalized);
    }
  });
  return set;
}

function normalizeHolidayDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const directMatch = /^\d{4}-\d{2}-\d{2}$/.exec(trimmed);
  if (directMatch) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getUTCFullYear()}-${`${parsed.getUTCMonth() + 1}`.padStart(2, "0")}-${`${parsed.getUTCDate()}`.padStart(2, "0")}`;
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, "0")}-${`${date.getUTCDate()}`.padStart(2, "0")}`;
}

function isBusinessDay(date: Date, holidays: Set<string>) {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }

  return !holidays.has(formatDateKey(date));
}

function calculateBusinessHoursBetween(
  startIso: string | null,
  endIso: string | null,
  holidays: Set<string>,
) {
  if (!startIso || !endIso) {
    return null;
  }

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  if (end <= start) {
    return 0;
  }

  let cursor = start.getTime();
  const endMs = end.getTime();
  let totalMs = 0;

  while (cursor < endMs) {
    const cursorDate = new Date(cursor);
    const nextDayUtc = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate() + 1,
    );
    const segmentEnd = Math.min(nextDayUtc, endMs);
    if (isBusinessDay(cursorDate, holidays)) {
      totalMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return totalMs / 3_600_000;
}

function averageBusinessResponseHours(
  rows: { requestedAt: string; respondedAt: string | null }[],
  holidays: Set<string>,
) {
  const values: number[] = [];
  rows.forEach((row) => {
    const hours = calculateBusinessHoursBetween(
      row.requestedAt,
      row.respondedAt,
      holidays,
    );
    if (hours !== null && Number.isFinite(hours)) {
      values.push(hours);
    }
  });

  if (!values.length) {
    return null;
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

type RangeContext = {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  previous2Start: string;
  previous2End: string;
  previous3Start: string;
  previous3End: string;
  previous4Start: string;
  previous4End: string;
  intervalDays: number;
};

function resolveRange({
  start,
  end,
}: {
  start: string;
  end: string;
}): RangeContext {
  const sanitizedStart = toIso(start);
  const sanitizedEnd = toIso(end);
  const { previousStart, previousEnd } = subtractDuration(
    sanitizedStart,
    sanitizedEnd,
  );
  const { previousStart: previous2Start, previousEnd: previous2End } =
    subtractDuration(previousStart, previousEnd);
  const { previousStart: previous3Start, previousEnd: previous3End } =
    subtractDuration(previous2Start, previous2End);
  const { previousStart: previous4Start, previousEnd: previous4End } =
    subtractDuration(previous3Start, previous3End);
  const intervalDays = differenceInDays(sanitizedStart, sanitizedEnd);
  return {
    start: sanitizedStart,
    end: sanitizedEnd,
    previousStart,
    previousEnd,
    previous2Start,
    previous2End,
    previous3Start,
    previous3End,
    previous4Start,
    previous4End,
    intervalDays,
  };
}

type IssueAggregateRow = {
  issues_created: number;
  issues_closed: number;
  avg_resolution_hours: number | null;
  reopened_count: number;
  avg_comments_issue: number | null;
};

async function fetchIssueAggregates(
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
         FILTER (WHERE i.github_created_at BETWEEN $1 AND $2) AS avg_comments_issue
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

type PrAggregateRow = {
  prs_created: number;
  prs_created_dependabot: number;
  prs_merged: number;
  prs_merged_dependabot: number;
  avg_merge_hours: number | null;
  merge_without_review: number;
  avg_lines_changed: number | null;
  avg_comments_pr: number | null;
};

async function fetchPrAggregates(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<PrAggregateRow> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<{
    prs_created_total: number | null;
    prs_created_dependabot: number | null;
    prs_merged_total: number | null;
    prs_merged_dependabot: number | null;
    avg_merge_hours: number | null;
    merge_without_review: number | null;
    avg_lines_changed: number | null;
    avg_comments_pr: number | null;
  }>(
    `WITH review_counts AS (
       SELECT r.pull_request_id, COUNT(*) FILTER (WHERE r.github_submitted_at IS NOT NULL) AS review_count
       FROM reviews r
       GROUP BY r.pull_request_id
     ),
     pull_requests_with_flags AS (
       SELECT
         p.*,
         CASE
           WHEN u.login IS NULL THEN FALSE
           ELSE (
             LOWER(u.login) LIKE 'dependabot%'
             OR LOWER(u.login) = 'app/dependabot'
           )
         END AS is_dependabot
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
     )
      SELECT
       COUNT(*) FILTER (WHERE p.github_created_at BETWEEN $1 AND $2) AS prs_created_total,
       COUNT(*) FILTER (
         WHERE p.github_created_at BETWEEN $1 AND $2 AND p.is_dependabot
       ) AS prs_created_dependabot,
       COUNT(*) FILTER (WHERE p.github_merged_at BETWEEN $1 AND $2) AS prs_merged_total,
       COUNT(*) FILTER (
         WHERE p.github_merged_at BETWEEN $1 AND $2 AND p.is_dependabot
       ) AS prs_merged_dependabot,
       AVG(EXTRACT(EPOCH FROM (p.github_merged_at - p.github_created_at)) / 3600.0)
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND p.github_merged_at IS NOT NULL
             AND NOT p.is_dependabot
         ) AS avg_merge_hours,
       COUNT(*) FILTER (
         WHERE p.github_merged_at BETWEEN $1 AND $2
           AND COALESCE(rc.review_count, 0) = 0
           AND NOT p.is_dependabot
       ) AS merge_without_review,
       AVG(COALESCE((p.data ->> 'additions')::numeric, 0) + COALESCE((p.data ->> 'deletions')::numeric, 0))
         FILTER (
           WHERE p.github_merged_at BETWEEN $1 AND $2
             AND NOT p.is_dependabot
         ) AS avg_lines_changed,
       AVG(COALESCE((p.data -> 'comments' ->> 'totalCount')::numeric, 0))
         FILTER (
           WHERE p.github_created_at BETWEEN $1 AND $2
             AND NOT p.is_dependabot
         ) AS avg_comments_pr
     FROM pull_requests_with_flags p
     LEFT JOIN review_counts rc ON rc.pull_request_id = p.id
     WHERE (p.github_created_at BETWEEN $1 AND $2
        OR p.github_merged_at BETWEEN $1 AND $2)${repoClause}`,
    params,
  );

  const row = result.rows[0];

  if (!row) {
    return {
      prs_created: 0,
      prs_created_dependabot: 0,
      prs_merged: 0,
      prs_merged_dependabot: 0,
      avg_merge_hours: null,
      merge_without_review: 0,
      avg_lines_changed: null,
      avg_comments_pr: null,
    };
  }

  const createdTotal = Number(row.prs_created_total ?? 0);
  const createdDependabot = Number(row.prs_created_dependabot ?? 0);
  const mergedTotal = Number(row.prs_merged_total ?? 0);
  const mergedDependabot = Number(row.prs_merged_dependabot ?? 0);

  return {
    prs_created: createdTotal - createdDependabot,
    prs_created_dependabot: createdDependabot,
    prs_merged: mergedTotal - mergedDependabot,
    prs_merged_dependabot: mergedDependabot,
    avg_merge_hours: row.avg_merge_hours,
    merge_without_review: Number(row.merge_without_review ?? 0),
    avg_lines_changed: row.avg_lines_changed,
    avg_comments_pr: row.avg_comments_pr,
  };
}

type IssueDurationDetailRow = {
  id: string;
  github_created_at: string | Date;
  github_closed_at: string | Date;
  data: unknown;
};

async function fetchIssueDurationDetails(
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
  let projectAddedAt: string | null = null;

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
      statusEvents.push({ status: columnName, createdAt });
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

      statusEvents.push({ status: normalizedStatus, createdAt });
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

    statusEvents.push({ status: statusLabel, createdAt: timestamp });
  });

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

function summarizeIssueDurations(
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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  });
}

function buildMonthlyDurationTrend(
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

type ReviewAggregateRow = {
  reviews_completed: number;
  avg_response_hours: number | null;
  avg_participation: number | null;
};

type ReviewStatsRow = {
  reviews_completed: number;
  avg_participation: number | null;
};

type ReviewResponseRow = {
  reviewer_id: string | null;
  pull_request_id: string;
  requested_at: string;
  responded_at: string | null;
};

async function fetchReviewAggregates(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<ReviewAggregateRow> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const [statsResult, responseRows] = await Promise.all([
    query<ReviewStatsRow>(
      `WITH pr_scope AS (
         SELECT pr.id, pr.github_created_at, pr.repository_id, pr.author_id
         FROM pull_requests pr
         LEFT JOIN users u ON u.id = pr.author_id
         WHERE pr.github_created_at BETWEEN $1 AND $2${repoClause}
           AND ${DEPENDABOT_FILTER}
       ),
       reviews_in_range AS (
         SELECT r.id, r.author_id, r.github_submitted_at, r.pull_request_id
         FROM reviews r
         JOIN pr_scope pr ON pr.id = r.pull_request_id
         WHERE r.github_submitted_at BETWEEN $1 AND $2
       ),
       participation AS (
         SELECT
           pr_scope.id AS pull_request_id,
           COUNT(DISTINCT r.author_id) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS reviewer_count
         FROM pr_scope
         LEFT JOIN reviews r ON r.pull_request_id = pr_scope.id
         GROUP BY pr_scope.id
       )
       SELECT
         (SELECT COUNT(*) FROM reviews_in_range) AS reviews_completed,
         (SELECT AVG(COALESCE(participation.reviewer_count, 0)) FROM participation) AS avg_participation
       `,
      params,
    ),
    fetchReviewResponsePairs(start, end, repositoryIds),
  ]);

  const statsRow = statsResult.rows[0] ?? {
    reviews_completed: 0,
    avg_participation: null,
  };

  const avgResponseHours = averageBusinessResponseHours(
    responseRows.map((row) => ({
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
    })),
    HOLIDAY_SET,
  );

  return {
    reviews_completed: Number(statsRow.reviews_completed ?? 0),
    avg_response_hours: avgResponseHours,
    avg_participation: statsRow.avg_participation,
  };
}

type TotalEventsRow = {
  total_events: number;
  issues: number;
  pull_requests: number;
  reviews: number;
  comments: number;
};

async function fetchTotalEvents(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<TotalEventsRow> {
  const params: unknown[] = [start, end];
  let repoClauseIssues = "";
  let repoClausePrs = "";
  let repoClauseCommentsIssue = "";
  let repoClauseCommentsPr = "";
  let repoClauseReviews = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrs = ` AND p.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsIssue = ` AND ic.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pc.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<TotalEventsRow>(
    `WITH issue_events AS (
       SELECT COUNT(*) AS issues
       FROM issues i
       WHERE i.github_created_at BETWEEN $1 AND $2${repoClauseIssues}
     ),
     pr_events AS (
       SELECT COUNT(*) AS pull_requests
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_created_at BETWEEN $1 AND $2${repoClausePrs}
         AND ${DEPENDABOT_FILTER}
     ),
     review_events AS (
       SELECT COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.github_submitted_at BETWEEN $1 AND $2${repoClauseReviews}
         AND ${DEPENDABOT_FILTER}
     ),
     comment_events AS (
       SELECT COUNT(*) AS comments
       FROM comments c
       LEFT JOIN LATERAL (
         SELECT i.repository_id FROM issues i WHERE i.id = c.issue_id
       ) ic ON TRUE
       LEFT JOIN LATERAL (
         SELECT p.repository_id FROM pull_requests p WHERE p.id = c.pull_request_id
       ) pc ON TRUE
       WHERE c.github_created_at BETWEEN $1 AND $2
         AND (
           (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
           OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
         )
     )
     SELECT
       issue_events.issues + pr_events.pull_requests + review_events.reviews + comment_events.comments AS total_events,
       issue_events.issues,
       pr_events.pull_requests,
       review_events.reviews,
       comment_events.comments
     FROM issue_events, pr_events, review_events, comment_events`,
    params,
  );

  return (
    result.rows[0] ?? {
      total_events: 0,
      issues: 0,
      pull_requests: 0,
      reviews: 0,
      comments: 0,
    }
  );
}

type TrendRow = {
  date: Date | string;
  count: number | string;
};

async function fetchTrend(
  table: "issues" | "pull_requests",
  column: "github_created_at" | "github_closed_at" | "github_merged_at",
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<TrendPoint[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  const alias = table === "issues" ? "i" : "p";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND ${alias}.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const queryText = `SELECT date_trunc('day', ${alias}.${column} AT TIME ZONE $${timezoneIndex})::date AS bucket, COUNT(*)
    FROM ${table} ${alias}
    WHERE ${alias}.${column} BETWEEN $1 AND $2${repoClause}
    GROUP BY bucket
    ORDER BY bucket`;

  params.push(timeZone);
  const result = await query<TrendRow>(queryText, params);
  return result.rows.map((row) => {
    let normalizedDate: string | null = null;
    if (row.date instanceof Date) {
      normalizedDate = formatDateKey(row.date);
    } else if (typeof row.date === "string") {
      const parsed = new Date(row.date);
      normalizedDate = Number.isNaN(parsed.getTime())
        ? row.date
        : formatDateKey(parsed);
    }

    return {
      date: normalizedDate ?? String(row.date),
      value: Number(row.count ?? 0),
    };
  });
}

type HeatmapRow = {
  dow: number;
  hour: number;
  count: number;
};

async function fetchReviewHeatmap(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<HeatmapCell[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<HeatmapRow>(
    `SELECT
       EXTRACT(DOW FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS dow,
       EXTRACT(HOUR FROM (r.github_submitted_at AT TIME ZONE $${timezoneIndex}))::int AS hour,
       COUNT(*)
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     WHERE r.github_submitted_at BETWEEN $1 AND $2${repoClause}
      GROUP BY dow, hour
      ORDER BY dow, hour`,
    [...params, timeZone],
  );

  return result.rows.map((row) => ({
    day: row.dow,
    hour: row.hour,
    count: Number(row.count ?? 0),
  }));
}

type RepoDistributionRow = {
  repository_id: string;
  issues: number;
  pull_requests: number;
  reviews: number;
  comments: number;
  total_events: number;
};

async function fetchRepoDistribution(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoDistributionRow[]> {
  const params: unknown[] = [start, end];
  let repoFilter = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilter = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<RepoDistributionRow>(
    `WITH issue_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS issues
       FROM issues
       WHERE github_created_at BETWEEN $1 AND $2
       GROUP BY repository_id
     ),
     pr_counts AS (
       SELECT p.repository_id AS repo_id, COUNT(*) AS pull_requests
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_created_at BETWEEN $1 AND $2
         AND ${DEPENDABOT_FILTER}
       GROUP BY p.repository_id
     ),
     review_counts AS (
       SELECT pr.repository_id AS repo_id, COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE r.github_submitted_at BETWEEN $1 AND $2
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     comment_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.github_created_at BETWEEN $1 AND $2
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         LEFT JOIN users u ON u.id = p.author_id
         WHERE c.github_created_at BETWEEN $1 AND $2
           AND ${DEPENDABOT_FILTER}
       ) AS combined
       GROUP BY repository_id
     ),
     combined AS (
       SELECT
         COALESCE(ic.repo_id, pc.repo_id, rc.repo_id, cc.repo_id) AS repository_id,
         COALESCE(ic.issues, 0) AS issues,
         COALESCE(pc.pull_requests, 0) AS pull_requests,
         COALESCE(rc.reviews, 0) AS reviews,
         COALESCE(cc.comments, 0) AS comments
       FROM issue_counts ic
       FULL OUTER JOIN pr_counts pc ON pc.repo_id = ic.repo_id
       FULL OUTER JOIN review_counts rc ON rc.repo_id = COALESCE(ic.repo_id, pc.repo_id)
       FULL OUTER JOIN comment_counts cc ON cc.repo_id = COALESCE(ic.repo_id, pc.repo_id, rc.repo_id)
     )
     SELECT
       repository_id,
       issues,
       pull_requests,
       reviews,
       comments,
       (issues + pull_requests + reviews + comments) AS total_events
     FROM combined
     WHERE repository_id IS NOT NULL${repoFilter}
     ORDER BY total_events DESC`,
    params,
  );

  return result.rows;
}

type RepoComparisonRawRow = {
  repository_id: string;
  issues_resolved: number;
  prs_merged: number;
  avg_first_review_hours: number | string | null;
};

async function fetchRepoComparison(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoComparisonRawRow[]> {
  const params: unknown[] = [start, end];
  let repoFilterPr = "";
  let repoFilterIssues = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilterPr = ` AND repository_id = ANY($${index}::text[])`;
    repoFilterIssues = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<RepoComparisonRawRow>(
    `WITH repo_ids AS (
       SELECT DISTINCT repository_id
       FROM issues
       WHERE github_closed_at BETWEEN $1 AND $2${repoFilterIssues}
       UNION
       SELECT DISTINCT pr.repository_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
     ),
     issue_counts AS (
       SELECT repository_id, COUNT(*) AS issues_resolved
       FROM issues
       WHERE github_closed_at BETWEEN $1 AND $2${repoFilterIssues}
       GROUP BY repository_id
     ),
     pr_counts AS (
       SELECT pr.repository_id, COUNT(*) AS prs_merged
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_merged_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id
     ),
     first_review_times AS (
       SELECT
         pr.repository_id,
         pr.github_created_at,
         MIN(r.github_submitted_at) AS first_review_at
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       LEFT JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.github_created_at BETWEEN $1 AND $2${repoFilterPr}
         AND ${DEPENDABOT_FILTER}
       GROUP BY pr.repository_id, pr.id, pr.github_created_at
     ),
     first_reviews AS (
       SELECT
         repository_id,
         AVG(EXTRACT(EPOCH FROM (first_review_at - github_created_at)) / 3600.0) AS avg_first_review_hours
       FROM first_review_times
       WHERE first_review_at IS NOT NULL
       GROUP BY repository_id
     )
     SELECT
       repo_ids.repository_id,
       COALESCE(issue_counts.issues_resolved, 0) AS issues_resolved,
       COALESCE(pr_counts.prs_merged, 0) AS prs_merged,
       first_reviews.avg_first_review_hours
     FROM repo_ids
     LEFT JOIN issue_counts ON issue_counts.repository_id = repo_ids.repository_id
     LEFT JOIN pr_counts ON pr_counts.repository_id = repo_ids.repository_id
     LEFT JOIN first_reviews ON first_reviews.repository_id = repo_ids.repository_id`,
    params,
  );

  return result.rows;
}

type ReviewerActivityRow = {
  reviewer_id: string;
  review_count: number;
  prs_reviewed: number;
};

type MainBranchContributionRow = {
  user_id: string;
  review_count: number;
  author_count: number;
  additions: number;
  deletions: number;
};

async function fetchReviewerActivity(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  limit?: number,
): Promise<ReviewerActivityRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  let limitClause = "";
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.push(limit);
    limitClause = ` LIMIT $${params.length}`;
  }

  const result = await query<ReviewerActivityRow>(
    `SELECT
       r.author_id AS reviewer_id,
       COUNT(*) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS review_count,
       COUNT(DISTINCT r.pull_request_id) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS prs_reviewed
     FROM reviews r
     JOIN pull_requests pr ON pr.id = r.pull_request_id
     LEFT JOIN users u ON u.id = pr.author_id
     WHERE r.author_id IS NOT NULL${repoClause}
       AND ${DEPENDABOT_FILTER}
     GROUP BY r.author_id
     ORDER BY review_count DESC, prs_reviewed DESC${limitClause}`,
    params,
  );

  return result.rows;
}

async function fetchMainBranchContribution(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<MainBranchContributionRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<MainBranchContributionRow>(
    `WITH merged_prs AS (
       SELECT
         p.id,
         p.author_id,
         COALESCE((p.data ->> 'additions')::numeric, 0) AS additions,
         COALESCE((p.data ->> 'deletions')::numeric, 0) AS deletions
       FROM pull_requests p
       LEFT JOIN users u ON u.id = p.author_id
       WHERE p.github_merged_at BETWEEN $1 AND $2
         AND p.github_merged_at IS NOT NULL${repoClause}
         AND ${DEPENDABOT_FILTER}
     ),
     author_contrib AS (
       SELECT
         mp.author_id AS user_id,
         COUNT(*) AS author_count,
         SUM(mp.additions) AS additions,
         SUM(mp.deletions) AS deletions
       FROM merged_prs mp
       WHERE mp.author_id IS NOT NULL
       GROUP BY mp.author_id
     ),
     review_prs AS (
       SELECT DISTINCT
         r.author_id AS reviewer_id,
         mp.id,
         mp.additions,
         mp.deletions
       FROM merged_prs mp
       JOIN reviews r ON r.pull_request_id = mp.id
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.author_id IS NOT NULL
         AND ${DEPENDABOT_FILTER}
         AND r.github_submitted_at BETWEEN $1 AND $2
         AND r.author_id <> mp.author_id
     ),
     review_contrib AS (
       SELECT
         reviewer_id AS user_id,
         COUNT(*) AS review_count,
         SUM(additions) AS additions,
         SUM(deletions) AS deletions
       FROM review_prs
       GROUP BY reviewer_id
     )
     SELECT
       COALESCE(author_contrib.user_id, review_contrib.user_id) AS user_id,
       COALESCE(review_contrib.review_count, 0) AS review_count,
       COALESCE(author_contrib.author_count, 0) AS author_count,
       COALESCE(author_contrib.additions, 0) + COALESCE(review_contrib.additions, 0) AS additions,
       COALESCE(author_contrib.deletions, 0) + COALESCE(review_contrib.deletions, 0) AS deletions
     FROM author_contrib
     FULL OUTER JOIN review_contrib ON author_contrib.user_id = review_contrib.user_id
     WHERE COALESCE(author_contrib.author_count, 0) + COALESCE(review_contrib.review_count, 0) > 0
     ORDER BY (COALESCE(author_contrib.author_count, 0) + COALESCE(review_contrib.review_count, 0)) DESC,
              COALESCE(author_contrib.additions, 0) + COALESCE(review_contrib.additions, 0) DESC`,
    params,
  );

  return result.rows;
}

async function fetchReviewResponsePairs(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  reviewerId?: string,
): Promise<ReviewResponseRow[]> {
  const params: unknown[] = [start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  let reviewerClause = "";
  if (reviewerId) {
    params.push(reviewerId);
    reviewerClause = ` AND rr.reviewer_id = $${params.length}`;
  }

  const result = await query<ReviewResponseRow>(
    `WITH pr_scope AS (
       SELECT pr.id, pr.github_created_at, pr.repository_id, pr.author_id
       FROM pull_requests pr
       LEFT JOIN users u ON u.id = pr.author_id
       WHERE pr.github_created_at BETWEEN $1 AND $2${repoClause}
         AND ${DEPENDABOT_FILTER}
     ),
     review_requests_scope AS (
       SELECT rr.id, rr.pull_request_id, rr.reviewer_id, rr.requested_at, rr.removed_at
       FROM review_requests rr
       JOIN pr_scope pr ON pr.id = rr.pull_request_id
       WHERE rr.reviewer_id IS NOT NULL
         AND rr.requested_at BETWEEN $1 AND $2${reviewerClause}
         AND pr.author_id <> rr.reviewer_id
     ),
     response_events AS (
       SELECT
         rr.id AS review_request_id,
         r.github_submitted_at AS responded_at
       FROM review_requests_scope rr
       JOIN reviews r ON r.pull_request_id = rr.pull_request_id
       WHERE r.author_id = rr.reviewer_id
         AND r.github_submitted_at BETWEEN $1 AND $2
       UNION ALL
       SELECT
         rr.id AS review_request_id,
         c.github_created_at AS responded_at
       FROM review_requests_scope rr
       JOIN comments c ON c.pull_request_id = rr.pull_request_id
       WHERE c.author_id = rr.reviewer_id
         AND c.github_created_at BETWEEN $1 AND $2
       UNION ALL
       SELECT
         rr.id AS review_request_id,
         r.github_created_at AS responded_at
       FROM review_requests_scope rr
       JOIN reactions r ON r.subject_id = rr.pull_request_id
       WHERE r.subject_type = 'pull_request'
         AND r.user_id = rr.reviewer_id
         AND r.github_created_at BETWEEN $1 AND $2
     ),
     valid_responses AS (
       SELECT
         rr.id AS review_request_id,
         MIN(response_events.responded_at) AS responded_at
       FROM review_requests_scope rr
       LEFT JOIN response_events
         ON response_events.review_request_id = rr.id
         AND response_events.responded_at >= rr.requested_at
         AND (rr.removed_at IS NULL OR response_events.responded_at < rr.removed_at)
       GROUP BY rr.id
     )
     SELECT
       rr.reviewer_id,
       rr.pull_request_id,
       rr.requested_at,
       valid_responses.responded_at
     FROM review_requests_scope rr
     JOIN valid_responses ON valid_responses.review_request_id = rr.id
     WHERE valid_responses.responded_at IS NOT NULL`,
    params,
  );

  return result.rows;
}

type LeaderboardRow = {
  user_id: string;
  value: number;
  secondary_value?: number | null;
};

async function fetchLeaderboard(
  metric: "issues" | "reviews" | "response" | "comments" | "prs",
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<LeaderboardRow[]> {
  const params: unknown[] = [start, end];
  let repoClauseIssues = "";
  let repoClausePrs = "";
  let repoClauseCommentsIssue = "";
  let repoClauseCommentsPr = "";
  let repoClauseReviews = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrs = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = repoClausePrs;
    repoClauseCommentsIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  switch (metric) {
    case "issues": {
      const result = await query<LeaderboardRow>(
        `SELECT i.author_id AS user_id, COUNT(*) AS value
         FROM issues i
         WHERE i.author_id IS NOT NULL AND i.github_created_at BETWEEN $1 AND $2${repoClauseIssues}
         GROUP BY i.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "prs": {
      const result = await query<LeaderboardRow>(
        `SELECT pr.author_id AS user_id, COUNT(*) AS value
         FROM pull_requests pr
         WHERE pr.author_id IS NOT NULL AND pr.github_created_at BETWEEN $1 AND $2${repoClausePrs}
         GROUP BY pr.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "reviews": {
      const result = await query<LeaderboardRow>(
        `SELECT r.author_id AS user_id,
                COUNT(*) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS value,
                COUNT(DISTINCT r.pull_request_id) FILTER (WHERE r.github_submitted_at BETWEEN $1 AND $2) AS secondary_value
         FROM reviews r
         JOIN pull_requests pr ON pr.id = r.pull_request_id
         WHERE r.author_id IS NOT NULL${repoClauseReviews}
         GROUP BY r.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    case "response": {
      const responsePairs = await fetchReviewResponsePairs(
        start,
        end,
        repositoryIds,
      );
      const stats = new Map<string, { sum: number; count: number }>();
      responsePairs.forEach((row) => {
        if (!row.reviewer_id) {
          return;
        }

        const hours = calculateBusinessHoursBetween(
          row.requested_at,
          row.responded_at,
          HOLIDAY_SET,
        );
        if (hours === null || !Number.isFinite(hours)) {
          return;
        }

        const current = stats.get(row.reviewer_id) ?? { sum: 0, count: 0 };
        current.sum += hours;
        current.count += 1;
        stats.set(row.reviewer_id, current);
      });

      return Array.from(stats.entries())
        .map(([userId, { sum, count }]) => ({
          user_id: userId,
          value: sum / count,
          secondary_value: null,
        }))
        .sort((a, b) => a.value - b.value);
    }
    case "comments": {
      const result = await query<LeaderboardRow>(
        `SELECT c.author_id AS user_id, COUNT(*) AS value
         FROM comments c
         LEFT JOIN issues i ON i.id = c.issue_id
         LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
         WHERE c.author_id IS NOT NULL AND c.github_created_at BETWEEN $1 AND $2
           AND (
             (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
             OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
           )
         GROUP BY c.author_id
         ORDER BY value DESC`,
        params,
      );
      return result.rows;
    }
    default:
      return [];
  }
}

type IndividualIssueRow = {
  created: number;
  closed: number;
  avg_resolution_hours: number | null;
  reopened: number;
};

async function fetchIndividualIssueMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualIssueRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND i.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualIssueRow>(
    `SELECT
       COUNT(*) FILTER (WHERE i.github_created_at BETWEEN $2 AND $3) AS created,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3) AS closed,
       AVG(EXTRACT(EPOCH FROM (i.github_closed_at - i.github_created_at)) / 3600.0)
         FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3 AND i.github_closed_at IS NOT NULL) AS avg_resolution_hours,
       COUNT(*) FILTER (WHERE i.github_closed_at BETWEEN $2 AND $3 AND i.state = 'OPEN') AS reopened
     FROM issues i
     WHERE i.author_id = $1${repoClause}`,
    params,
  );

  return (
    result.rows[0] ?? {
      created: 0,
      closed: 0,
      avg_resolution_hours: null,
      reopened: 0,
    }
  );
}

type IndividualReviewRow = {
  reviews: number;
  avg_response_hours: number | null;
  prs_reviewed: number;
  review_comments: number;
};

type IndividualReviewBaseRow = {
  reviews: number;
  prs_reviewed: number;
  review_comments: number;
};

type IndividualPullRequestRow = {
  created: number;
  merged: number;
};

async function fetchIndividualPullRequestMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualPullRequestRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND p.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualPullRequestRow>(
    `SELECT
       COUNT(*) FILTER (WHERE p.github_created_at BETWEEN $2 AND $3) AS created,
       COUNT(*) FILTER (WHERE p.github_merged_at BETWEEN $2 AND $3) AS merged
     FROM pull_requests p
     WHERE p.author_id = $1${repoClause}`,
    params,
  );

  return (
    result.rows[0] ?? {
      created: 0,
      merged: 0,
    }
  );
}

async function fetchIndividualReviewMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualReviewRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const statsResult = await query<IndividualReviewBaseRow>(
    `WITH reviewer_reviews AS (
       SELECT r.pull_request_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id = $1
         AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
         AND pr.author_id <> $1
     ),
     review_comments AS (
       SELECT COUNT(*) AS review_comments
       FROM comments c
       JOIN pull_requests pr ON pr.id = c.pull_request_id
       WHERE c.author_id = $1
         AND c.github_created_at BETWEEN $2 AND $3${repoClause}
         AND pr.author_id <> $1
     )
     SELECT
       (SELECT COUNT(*) FROM reviewer_reviews) AS reviews,
       (SELECT COUNT(DISTINCT pull_request_id) FROM reviewer_reviews) AS prs_reviewed,
       (SELECT review_comments FROM review_comments) AS review_comments
     `,
    params,
  );

  const statsRow = statsResult.rows[0] ?? {
    reviews: 0,
    prs_reviewed: 0,
    review_comments: 0,
  };

  const responsePairs = await fetchReviewResponsePairs(
    start,
    end,
    repositoryIds,
    personId,
  );

  const avgResponseHours = averageBusinessResponseHours(
    responsePairs.map((row) => ({
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
    })),
    HOLIDAY_SET,
  );

  return {
    reviews: Number(statsRow.reviews ?? 0),
    prs_reviewed: Number(statsRow.prs_reviewed ?? 0),
    avg_response_hours: avgResponseHours,
    review_comments: Number(statsRow.review_comments ?? 0),
  };
}

type IndividualCoverageRow = {
  coverage: number | null;
  participation: number | null;
};

async function fetchIndividualCoverageMetrics(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualCoverageRow> {
  const params: unknown[] = [personId, start, end];
  let repoClause = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClause = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualCoverageRow>(
    `WITH prs_in_range AS (
       SELECT id
       FROM pull_requests pr
       WHERE pr.github_created_at BETWEEN $2 AND $3${repoClause}
     ),
     reviewer_prs AS (
       SELECT DISTINCT r.pull_request_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id = $1 AND r.github_submitted_at BETWEEN $2 AND $3${repoClause}
     ),
     participation AS (
       SELECT
         pr.id,
         COUNT(DISTINCT r.author_id) FILTER (WHERE r.github_submitted_at BETWEEN $2 AND $3) AS reviewer_count
       FROM pull_requests pr
       LEFT JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.id IN (SELECT id FROM prs_in_range)
       GROUP BY pr.id
     ),
     person_participation AS (
       SELECT
         pr.id,
         COUNT(DISTINCT r.author_id) FILTER (WHERE r.github_submitted_at BETWEEN $2 AND $3) AS reviewer_count
       FROM pull_requests pr
       JOIN reviews r ON r.pull_request_id = pr.id
       WHERE pr.id IN (SELECT pull_request_id FROM reviewer_prs)
       GROUP BY pr.id
     )
     SELECT
       CASE WHEN (SELECT COUNT(*) FROM prs_in_range) = 0 THEN NULL
            ELSE (SELECT COUNT(*) FROM reviewer_prs)::numeric / (SELECT COUNT(*) FROM prs_in_range)::numeric
       END AS coverage,
       (SELECT AVG(reviewer_count) FROM person_participation) AS participation
     `,
    params,
  );

  return (
    result.rows[0] ?? {
      coverage: null,
      participation: null,
    }
  );
}

type IndividualDiscussionRow = {
  comments: number;
};

async function fetchIndividualDiscussion(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<IndividualDiscussionRow> {
  const params: unknown[] = [personId, start, end];
  let repoClauseIssue = "";
  let repoClausePr = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualDiscussionRow>(
    `SELECT COUNT(*) AS comments
     FROM comments c
     LEFT JOIN issues i ON i.id = c.issue_id
     LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
     WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
       AND (
         (c.issue_id IS NOT NULL${repoClauseIssue})
         OR (c.pull_request_id IS NOT NULL${repoClausePr})
       )`,
    params,
  );

  return result.rows[0] ?? { comments: 0 };
}

type IndividualMonthlyRow = {
  bucket: string;
  issues: number;
  reviews: number;
};

async function fetchIndividualMonthlyTrends(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
  timeZone: string,
): Promise<MultiTrendPoint[]> {
  const params: unknown[] = [personId, start, end];
  let repoClauseIssues = "";
  let repoClauseReviews = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const timezoneIndex = params.length + 1;
  const result = await query<IndividualMonthlyRow>(
    `WITH issue_trend AS (
       SELECT to_char(date_trunc('month', i.github_created_at AT TIME ZONE $${timezoneIndex}), 'YYYY-MM') AS bucket,
              COUNT(*) AS issues
       FROM issues i
       WHERE i.author_id = $1 AND i.github_created_at BETWEEN $2 AND $3${repoClauseIssues}
       GROUP BY bucket
     ),
     review_trend AS (
       SELECT to_char(date_trunc('month', r.github_submitted_at AT TIME ZONE $${timezoneIndex}), 'YYYY-MM') AS bucket,
              COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id = $1 AND r.github_submitted_at BETWEEN $2 AND $3${repoClauseReviews}
       GROUP BY bucket
     ),
     combined AS (
       SELECT
         COALESCE(i.bucket, r.bucket) AS bucket,
         COALESCE(i.issues, 0) AS issues,
         COALESCE(r.reviews, 0) AS reviews
       FROM issue_trend i
       FULL OUTER JOIN review_trend r ON r.bucket = i.bucket
     )
     SELECT bucket, issues, reviews
     FROM combined
     ORDER BY bucket`,
    [...params, timeZone],
  );

  return result.rows.map((row) => ({
    date: row.bucket,
    values: {
      issues: row.issues,
      reviews: row.reviews,
    },
  }));
}

type IndividualRepoActivityRow = RepoDistributionRow;

async function fetchIndividualRepoActivity(
  personId: string,
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<RepoDistributionRow[]> {
  const params: unknown[] = [personId, start, end];
  let repoFilter = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoFilter = ` AND repository_id = ANY($${index}::text[])`;
  }

  const result = await query<IndividualRepoActivityRow>(
    `WITH issue_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS issues
       FROM issues
       WHERE author_id = $1 AND github_created_at BETWEEN $2 AND $3
       GROUP BY repository_id
     ),
     review_counts AS (
       SELECT pr.repository_id AS repo_id, COUNT(*) AS reviews
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id = $1 AND r.github_submitted_at BETWEEN $2 AND $3
       GROUP BY pr.repository_id
     ),
     comment_counts AS (
       SELECT repository_id AS repo_id, COUNT(*) AS comments
       FROM (
         SELECT i.repository_id AS repository_id
         FROM comments c
         JOIN issues i ON i.id = c.issue_id
         WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
         UNION ALL
         SELECT p.repository_id AS repository_id
         FROM comments c
         JOIN pull_requests p ON p.id = c.pull_request_id
         WHERE c.author_id = $1 AND c.github_created_at BETWEEN $2 AND $3
       ) combined
       GROUP BY repository_id
     ),
     combined AS (
       SELECT
         COALESCE(ic.repo_id, rc.repo_id, cc.repo_id) AS repository_id,
         COALESCE(ic.issues, 0) AS issues,
         0 AS pull_requests,
         COALESCE(rc.reviews, 0) AS reviews,
         COALESCE(cc.comments, 0) AS comments
       FROM issue_counts ic
       FULL OUTER JOIN review_counts rc ON rc.repo_id = ic.repo_id
       FULL OUTER JOIN comment_counts cc ON cc.repo_id = COALESCE(ic.repo_id, rc.repo_id)
     )
     SELECT *, (issues + reviews + comments) AS total_events
     FROM combined
     WHERE repository_id IS NOT NULL${repoFilter}
     ORDER BY total_events DESC`,
    params,
  );

  return result.rows;
}

async function fetchActiveContributors(
  start: string,
  end: string,
  repositoryIds: string[] | undefined,
): Promise<string[]> {
  const params: unknown[] = [start, end];
  let repoClauseIssues = "";
  let repoClausePrs = "";
  let repoClauseReviews = "";
  let repoClauseCommentsIssue = "";
  let repoClauseCommentsPr = "";
  if (repositoryIds?.length) {
    params.push(repositoryIds);
    const index = params.length;
    repoClauseIssues = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClausePrs = ` AND pr.repository_id = ANY($${index}::text[])`;
    repoClauseReviews = repoClausePrs;
    repoClauseCommentsIssue = ` AND i.repository_id = ANY($${index}::text[])`;
    repoClauseCommentsPr = ` AND pr.repository_id = ANY($${index}::text[])`;
  }

  const result = await query<{ user_id: string }>(
    `WITH issue_authors AS (
       SELECT DISTINCT i.author_id AS user_id
       FROM issues i
       WHERE i.author_id IS NOT NULL AND i.github_created_at BETWEEN $1 AND $2${repoClauseIssues}
     ),
     review_authors AS (
       SELECT DISTINCT r.author_id AS user_id
       FROM reviews r
       JOIN pull_requests pr ON pr.id = r.pull_request_id
       WHERE r.author_id IS NOT NULL AND r.github_submitted_at BETWEEN $1 AND $2${repoClauseReviews}
     ),
     comment_authors AS (
       SELECT DISTINCT c.author_id AS user_id
       FROM comments c
       LEFT JOIN issues i ON i.id = c.issue_id
       LEFT JOIN pull_requests pr ON pr.id = c.pull_request_id
       WHERE c.author_id IS NOT NULL AND c.github_created_at BETWEEN $1 AND $2
         AND (
           (c.issue_id IS NOT NULL${repoClauseCommentsIssue})
           OR (c.pull_request_id IS NOT NULL${repoClauseCommentsPr})
         )
     )
     SELECT DISTINCT user_id
     FROM (
       SELECT user_id FROM issue_authors
       UNION
       SELECT user_id FROM review_authors
       UNION
       SELECT user_id FROM comment_authors
     ) combined
     WHERE user_id IS NOT NULL`,
    params,
  );

  return result.rows.map((row) => row.user_id);
}

async function resolveProfiles(
  repositoryIds: string[],
  userIds: string[],
): Promise<{ repositories: RepositoryProfile[]; users: UserProfile[] }> {
  const [repositories, users] = await Promise.all([
    repositoryIds.length
      ? getRepositoryProfiles(repositoryIds)
      : Promise.resolve([]),
    userIds.length ? getUserProfiles(userIds) : Promise.resolve([]),
  ]);

  return { repositories, users };
}

function mapRepoDistribution(
  rows: RepoDistributionRow[],
  repoProfiles: Map<string, RepositoryProfile>,
): RepoDistributionItem[] {
  const total = rows.reduce(
    (sum, row) => sum + Number(row.total_events ?? 0),
    0,
  );
  return rows.map((row) => ({
    repositoryId: row.repository_id,
    repository: repoProfiles.get(row.repository_id) ?? null,
    issues: Number(row.issues ?? 0),
    pullRequests: Number(row.pull_requests ?? 0),
    reviews: Number(row.reviews ?? 0),
    comments: Number(row.comments ?? 0),
    totalEvents: Number(row.total_events ?? 0),
    share: total > 0 ? Number(row.total_events ?? 0) / total : 0,
  }));
}

function mapRepoComparison(
  rows: RepoComparisonRawRow[],
  repoProfiles: Map<string, RepositoryProfile>,
): RepoComparisonRow[] {
  return rows.map((row) => ({
    repositoryId: row.repository_id,
    repository: repoProfiles.get(row.repository_id) ?? null,
    issuesResolved: Number(row.issues_resolved ?? 0),
    pullRequestsMerged: Number(row.prs_merged ?? 0),
    avgFirstReviewHours: (() => {
      if (row.avg_first_review_hours == null) {
        return null;
      }

      const numeric = Number(row.avg_first_review_hours);
      return Number.isFinite(numeric) ? numeric : null;
    })(),
  }));
}

function mapReviewerActivity(
  rows: ReviewerActivityRow[],
  userProfiles: Map<string, UserProfile>,
): ReviewerActivity[] {
  return rows
    .filter((row) => row.reviewer_id)
    .map((row) => ({
      reviewerId: row.reviewer_id,
      reviewCount: Number(row.review_count ?? 0),
      pullRequestsReviewed: Number(row.prs_reviewed ?? 0),
      profile: userProfiles.get(row.reviewer_id) ?? null,
    }));
}

function mapLeaderboard(
  rows: LeaderboardRow[],
  userProfiles: Map<string, UserProfile>,
): LeaderboardEntry[] {
  return rows
    .filter((row) => row.user_id)
    .map((row) => ({
      user: userProfiles.get(row.user_id) ?? {
        id: row.user_id,
        login: null,
        name: null,
        avatarUrl: null,
      },
      value: Number(row.value ?? 0),
      secondaryValue: row.secondary_value ?? null,
    }));
}

function toTrend(points: TrendPoint[]): TrendPoint[] {
  return points.map((point) => ({
    date: point.date,
    value: Number(point.value ?? 0),
  }));
}

export async function getDashboardAnalytics(
  params: AnalyticsParams,
): Promise<DashboardAnalytics> {
  const { start, end, repositoryIds = [], personId } = params;
  const range = resolveRange({ start, end });
  const repositoryFilter = repositoryIds.length ? repositoryIds : undefined;

  await ensureSchema();
  const config = await getSyncConfig();
  const timeZone = config?.timezone ?? "UTC";
  const weekStart: WeekStart =
    config?.week_start === "sunday" ? "sunday" : "monday";
  const targetProject = normalizeText(env.TODO_PROJECT_NAME);

  const [
    currentIssues,
    previousIssues,
    previous2Issues,
    previous3Issues,
    previous4Issues,
  ] = await Promise.all([
    fetchIssueAggregates(range.start, range.end, repositoryFilter),
    fetchIssueAggregates(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchIssueAggregates(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const [currentPrs, previousPrs, previous2Prs, previous3Prs, previous4Prs] =
    await Promise.all([
      fetchPrAggregates(range.start, range.end, repositoryFilter),
      fetchPrAggregates(
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous2Start,
        range.previous2End,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous3Start,
        range.previous3End,
        repositoryFilter,
      ),
      fetchPrAggregates(
        range.previous4Start,
        range.previous4End,
        repositoryFilter,
      ),
    ]);

  const [
    currentReviews,
    previousReviews,
    previous2Reviews,
    previous3Reviews,
    previous4Reviews,
  ] = await Promise.all([
    fetchReviewAggregates(range.start, range.end, repositoryFilter),
    fetchReviewAggregates(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchReviewAggregates(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const [currentEvents, previousEvents] = await Promise.all([
    fetchTotalEvents(range.start, range.end, repositoryFilter),
    fetchTotalEvents(range.previousStart, range.previousEnd, repositoryFilter),
  ]);

  const [
    issuesCreatedTrend,
    issuesClosedTrend,
    prsCreatedTrend,
    prsMergedTrend,
    reviewHeatmap,
    repoDistributionRows,
    repoComparisonRows,
    reviewerActivityRows,
    mainBranchContributionRows,
    leaderboardPrs,
    leaderboardIssues,
    leaderboardReviews,
    leaderboardResponders,
    leaderboardComments,
    currentIssueDurationDetails,
    previousIssueDurationDetails,
    previous2IssueDurationDetails,
    previous3IssueDurationDetails,
    previous4IssueDurationDetails,
  ] = await Promise.all([
    fetchTrend(
      "issues",
      "github_created_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "issues",
      "github_closed_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "pull_requests",
      "github_created_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchTrend(
      "pull_requests",
      "github_merged_at",
      range.start,
      range.end,
      repositoryFilter,
      timeZone,
    ),
    fetchReviewHeatmap(range.start, range.end, repositoryFilter, timeZone),
    fetchRepoDistribution(range.start, range.end, repositoryFilter),
    fetchRepoComparison(range.start, range.end, repositoryFilter),
    fetchReviewerActivity(range.start, range.end, repositoryFilter),
    fetchMainBranchContribution(range.start, range.end, repositoryFilter),
    fetchLeaderboard("prs", range.start, range.end, repositoryFilter),
    fetchLeaderboard("issues", range.start, range.end, repositoryFilter),
    fetchLeaderboard("reviews", range.start, range.end, repositoryFilter),
    fetchLeaderboard("response", range.start, range.end, repositoryFilter),
    fetchLeaderboard("comments", range.start, range.end, repositoryFilter),
    fetchIssueDurationDetails(range.start, range.end, repositoryFilter),
    fetchIssueDurationDetails(
      range.previousStart,
      range.previousEnd,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous2Start,
      range.previous2End,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous3Start,
      range.previous3End,
      repositoryFilter,
    ),
    fetchIssueDurationDetails(
      range.previous4Start,
      range.previous4End,
      repositoryFilter,
    ),
  ]);

  const repoIds = new Set<string>();
  repoDistributionRows.forEach((row) => {
    repoIds.add(row.repository_id);
  });
  repoComparisonRows.forEach((row) => {
    repoIds.add(row.repository_id);
  });

  const reviewerIds = new Set<string>();
  reviewerActivityRows.forEach((row) => {
    if (row.reviewer_id) {
      reviewerIds.add(row.reviewer_id);
    }
  });

  const leaderboardUserIds = new Set<string>();
  [
    leaderboardPrs,
    leaderboardIssues,
    leaderboardReviews,
    leaderboardResponders,
    leaderboardComments,
  ].forEach((rows) => {
    rows.forEach((row) => {
      if (row.user_id) {
        leaderboardUserIds.add(row.user_id);
      }
    });
  });

  const contributorIds = await fetchActiveContributors(
    range.start,
    range.end,
    repositoryFilter,
  );
  contributorIds.forEach((id) => {
    leaderboardUserIds.add(id);
  });

  let personProfile: UserProfile | null = null;
  if (personId) {
    leaderboardUserIds.add(personId);
  }

  const { repositories, users } = await resolveProfiles(
    Array.from(repoIds),
    Array.from(new Set([...reviewerIds, ...leaderboardUserIds])),
  );
  const repoProfileMap = new Map(repositories.map((repo) => [repo.id, repo]));
  const userProfileMap = new Map(users.map((user) => [user.id, user]));

  if (personId) {
    personProfile = userProfileMap.get(personId) ?? null;
    if (!personProfile) {
      const profiles = await getUserProfiles([personId]);
      if (profiles.length) {
        personProfile = profiles[0];
        userProfileMap.set(personProfile.id, personProfile);
      }
    }
  }

  const totalIssuesClosedCurrent = currentIssues.issues_closed || 0;
  const reopenedRatioCurrent =
    totalIssuesClosedCurrent > 0
      ? currentIssues.reopened_count / totalIssuesClosedCurrent
      : 0;
  const totalIssuesClosedPrevious = previousIssues.issues_closed || 0;
  const reopenedRatioPrevious =
    totalIssuesClosedPrevious > 0
      ? previousIssues.reopened_count / totalIssuesClosedPrevious
      : 0;

  const issueDurationCurrent = summarizeIssueDurations(
    currentIssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious = summarizeIssueDurations(
    previousIssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious2 = summarizeIssueDurations(
    previous2IssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious3 = summarizeIssueDurations(
    previous3IssueDurationDetails,
    targetProject,
  );
  const issueDurationPrevious4 = summarizeIssueDurations(
    previous4IssueDurationDetails,
    targetProject,
  );
  const monthlyDurationTrend = buildMonthlyDurationTrend(
    currentIssueDurationDetails,
    targetProject,
    timeZone,
  );

  const issueMetrics = {
    issuesCreated: buildComparison(
      currentIssues.issues_created,
      previousIssues.issues_created,
    ),
    issuesClosed: buildComparison(
      currentIssues.issues_closed,
      previousIssues.issues_closed,
    ),
    issueResolutionTime: buildDurationComparison(
      currentIssues.avg_resolution_hours,
      previousIssues.avg_resolution_hours,
      "hours",
    ),
    issueWorkTime: buildDurationComparison(
      issueDurationCurrent.overallWork,
      issueDurationPrevious.overallWork,
      "hours",
    ),
    issueBacklogRatio: buildRatioComparison(
      currentIssues.issues_closed
        ? currentIssues.issues_created / currentIssues.issues_closed
        : currentIssues.issues_created,
      previousIssues.issues_closed
        ? previousIssues.issues_created / previousIssues.issues_closed
        : previousIssues.issues_created,
    ),
    parentIssueResolutionTime: buildDurationComparison(
      issueDurationCurrent.parentResolution,
      issueDurationPrevious.parentResolution,
      "hours",
    ),
    childIssueResolutionTime: buildDurationComparison(
      issueDurationCurrent.childResolution,
      issueDurationPrevious.childResolution,
      "hours",
    ),
    parentIssueWorkTime: buildDurationComparison(
      issueDurationCurrent.parentWork,
      issueDurationPrevious.parentWork,
      "hours",
    ),
    childIssueWorkTime: buildDurationComparison(
      issueDurationCurrent.childWork,
      issueDurationPrevious.childWork,
      "hours",
    ),
  };

  const organizationHistory = {
    issuesCreated: buildHistorySeries([
      previous4Issues.issues_created,
      previous3Issues.issues_created,
      previous2Issues.issues_created,
      previousIssues.issues_created,
      currentIssues.issues_created,
    ]),
    issuesClosed: buildHistorySeries([
      previous4Issues.issues_closed,
      previous3Issues.issues_closed,
      previous2Issues.issues_closed,
      previousIssues.issues_closed,
      currentIssues.issues_closed,
    ]),
    issueResolutionTime: buildHistorySeries([
      previous4Issues.avg_resolution_hours,
      previous3Issues.avg_resolution_hours,
      previous2Issues.avg_resolution_hours,
      previousIssues.avg_resolution_hours,
      currentIssues.avg_resolution_hours,
    ]),
    issueWorkTime: buildHistorySeries([
      issueDurationPrevious4.overallWork,
      issueDurationPrevious3.overallWork,
      issueDurationPrevious2.overallWork,
      issueDurationPrevious.overallWork,
      issueDurationCurrent.overallWork,
    ]),
    parentIssueResolutionTime: buildHistorySeries([
      issueDurationPrevious4.parentResolution,
      issueDurationPrevious3.parentResolution,
      issueDurationPrevious2.parentResolution,
      issueDurationPrevious.parentResolution,
      issueDurationCurrent.parentResolution,
    ]),
    parentIssueWorkTime: buildHistorySeries([
      issueDurationPrevious4.parentWork,
      issueDurationPrevious3.parentWork,
      issueDurationPrevious2.parentWork,
      issueDurationPrevious.parentWork,
      issueDurationCurrent.parentWork,
    ]),
    childIssueResolutionTime: buildHistorySeries([
      issueDurationPrevious4.childResolution,
      issueDurationPrevious3.childResolution,
      issueDurationPrevious2.childResolution,
      issueDurationPrevious.childResolution,
      issueDurationCurrent.childResolution,
    ]),
    childIssueWorkTime: buildHistorySeries([
      issueDurationPrevious4.childWork,
      issueDurationPrevious3.childWork,
      issueDurationPrevious2.childWork,
      issueDurationPrevious.childWork,
      issueDurationCurrent.childWork,
    ]),
    prsCreated: buildHistorySeries([
      previous4Prs.prs_created,
      previous3Prs.prs_created,
      previous2Prs.prs_created,
      previousPrs.prs_created,
      currentPrs.prs_created,
    ]),
    prsMerged: buildHistorySeries([
      previous4Prs.prs_merged,
      previous3Prs.prs_merged,
      previous2Prs.prs_merged,
      previousPrs.prs_merged,
      currentPrs.prs_merged,
    ]),
    reviewParticipation: buildHistorySeries([
      previous4Reviews.avg_participation,
      previous3Reviews.avg_participation,
      previous2Reviews.avg_participation,
      previousReviews.avg_participation,
      currentReviews.avg_participation,
    ]),
    reviewResponseTime: buildHistorySeries([
      previous4Reviews.avg_response_hours,
      previous3Reviews.avg_response_hours,
      previous2Reviews.avg_response_hours,
      previousReviews.avg_response_hours,
      currentReviews.avg_response_hours,
    ]),
  } satisfies OrganizationAnalytics["metricHistory"];

  const prMetrics = {
    prsCreated: buildComparison(
      currentPrs.prs_created,
      previousPrs.prs_created,
      [
        {
          label: "Dependabot",
          current: currentPrs.prs_created_dependabot,
          previous: previousPrs.prs_created_dependabot,
        },
      ],
    ),
    prsMerged: buildComparison(currentPrs.prs_merged, previousPrs.prs_merged, [
      {
        label: "Dependabot",
        current: currentPrs.prs_merged_dependabot,
        previous: previousPrs.prs_merged_dependabot,
      },
    ]),
    prMergeTime: buildDurationComparison(
      currentPrs.avg_merge_hours,
      previousPrs.avg_merge_hours,
      "hours",
    ),
    mergeWithoutReviewRatio: buildRatioComparison(
      currentPrs.prs_merged
        ? currentPrs.merge_without_review / currentPrs.prs_merged
        : 0,
      previousPrs.prs_merged
        ? previousPrs.merge_without_review / previousPrs.prs_merged
        : 0,
    ),
    avgPrSize: buildComparison(
      Number(currentPrs.avg_lines_changed ?? 0),
      Number(previousPrs.avg_lines_changed ?? 0),
    ),
    avgCommentsPerPr: buildComparison(
      Number(currentPrs.avg_comments_pr ?? 0),
      Number(previousPrs.avg_comments_pr ?? 0),
    ),
  };

  const reviewMetrics = {
    reviewsCompleted: buildComparison(
      currentReviews.reviews_completed,
      previousReviews.reviews_completed,
    ),
    reviewResponseTime: buildDurationComparison(
      currentReviews.avg_response_hours,
      previousReviews.avg_response_hours,
      "hours",
    ),
    reviewParticipation: buildRatioComparison(
      currentReviews.avg_participation,
      previousReviews.avg_participation,
    ),
  };

  const collaborationMetrics = {
    avgCommentsPerIssue: buildComparison(
      Number(currentIssues.avg_comments_issue ?? 0),
      Number(previousIssues.avg_comments_issue ?? 0),
    ),
    reopenedIssuesRatio: buildRatioComparison(
      reopenedRatioCurrent,
      reopenedRatioPrevious,
    ),
  };

  const activityMetrics = {
    totalEvents: buildComparison(
      currentEvents.total_events,
      previousEvents.total_events,
    ),
  };

  const activityBreakdown = {
    issues: Number(currentEvents.issues ?? 0),
    pullRequests: Number(currentEvents.pull_requests ?? 0),
    reviews: Number(currentEvents.reviews ?? 0),
    comments: Number(currentEvents.comments ?? 0),
  };

  const organization: OrganizationAnalytics = {
    metrics: {
      ...issueMetrics,
      ...prMetrics,
      ...reviewMetrics,
      ...collaborationMetrics,
      totalEvents: activityMetrics.totalEvents,
    },
    activityBreakdown,
    metricHistory: organizationHistory,
    reviewers: mapReviewerActivity(reviewerActivityRows, userProfileMap),
    trends: {
      issuesCreated: toTrend(issuesCreatedTrend),
      issuesClosed: toTrend(issuesClosedTrend),
      prsCreated: toTrend(prsCreatedTrend),
      prsMerged: toTrend(prsMergedTrend),
      issueResolutionHours: monthlyDurationTrend,
      reviewHeatmap,
    },
    repoDistribution: mapRepoDistribution(repoDistributionRows, repoProfileMap),
    repoComparison: mapRepoComparison(repoComparisonRows, repoProfileMap),
  };

  let individual = null;
  if (personProfile) {
    const [
      individualIssuesCurrent,
      individualIssuesPrevious,
      individualPullRequestsCurrent,
      individualPullRequestsPrevious,
      individualReviewsCurrent,
      individualReviewsPrevious,
      individualCoverageCurrent,
      individualCoveragePrevious,
      individualDiscussionCurrent,
      individualDiscussionPrevious,
      individualIssueDurationsCurrent,
      individualIssueDurationsPrevious,
      individualMonthly,
      individualRepoRows,
    ] = await Promise.all([
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualIssueMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualPullRequestMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualReviewMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualCoverageMetrics(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
      fetchIndividualDiscussion(
        personProfile.id,
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
      ),
      fetchIssueDurationDetails(
        range.start,
        range.end,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIssueDurationDetails(
        range.previousStart,
        range.previousEnd,
        repositoryFilter,
        personProfile.id,
      ),
      fetchIndividualMonthlyTrends(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
        timeZone,
      ),
      fetchIndividualRepoActivity(
        personProfile.id,
        range.start,
        range.end,
        repositoryFilter,
      ),
    ]);

    const individualDurationCurrent = summarizeIssueDurations(
      individualIssueDurationsCurrent,
      targetProject,
    );
    const individualDurationPrevious = summarizeIssueDurations(
      individualIssueDurationsPrevious,
      targetProject,
    );

    const individualMetrics = {
      issuesCreated: buildComparison(
        individualIssuesCurrent.created,
        individualIssuesPrevious.created,
      ),
      issuesClosed: buildComparison(
        individualIssuesCurrent.closed,
        individualIssuesPrevious.closed,
      ),
      issueResolutionRatio: buildRatioComparison(
        individualIssuesCurrent.created
          ? individualIssuesCurrent.closed / individualIssuesCurrent.created
          : 0,
        individualIssuesPrevious.created
          ? individualIssuesPrevious.closed / individualIssuesPrevious.created
          : 0,
      ),
      issueResolutionTime: buildDurationComparison(
        individualIssuesCurrent.avg_resolution_hours,
        individualIssuesPrevious.avg_resolution_hours,
        "hours",
      ),
      issueWorkTime: buildDurationComparison(
        individualDurationCurrent.overallWork,
        individualDurationPrevious.overallWork,
        "hours",
      ),
      prsCreated: buildComparison(
        individualPullRequestsCurrent.created,
        individualPullRequestsPrevious.created,
      ),
      prsMerged: buildComparison(
        individualPullRequestsCurrent.merged,
        individualPullRequestsPrevious.merged,
      ),
      parentIssueResolutionTime: buildDurationComparison(
        individualDurationCurrent.parentResolution,
        individualDurationPrevious.parentResolution,
        "hours",
      ),
      childIssueResolutionTime: buildDurationComparison(
        individualDurationCurrent.childResolution,
        individualDurationPrevious.childResolution,
        "hours",
      ),
      parentIssueWorkTime: buildDurationComparison(
        individualDurationCurrent.parentWork,
        individualDurationPrevious.parentWork,
        "hours",
      ),
      childIssueWorkTime: buildDurationComparison(
        individualDurationCurrent.childWork,
        individualDurationPrevious.childWork,
        "hours",
      ),
      reviewsCompleted: buildComparison(
        individualReviewsCurrent.reviews,
        individualReviewsPrevious.reviews,
      ),
      reviewResponseTime: buildDurationComparison(
        individualReviewsCurrent.avg_response_hours,
        individualReviewsPrevious.avg_response_hours,
        "hours",
      ),
      prsReviewed: buildComparison(
        individualReviewsCurrent.prs_reviewed,
        individualReviewsPrevious.prs_reviewed,
      ),
      reviewComments: buildComparison(
        individualReviewsCurrent.review_comments,
        individualReviewsPrevious.review_comments,
      ),
      reviewCoverage: buildRatioComparison(
        individualCoverageCurrent.coverage,
        individualCoveragePrevious.coverage,
      ),
      reviewParticipation: buildRatioComparison(
        individualCoverageCurrent.participation,
        individualCoveragePrevious.participation,
      ),
      reopenedIssues: buildComparison(
        individualIssuesCurrent.reopened,
        individualIssuesPrevious.reopened,
      ),
      discussionComments: buildComparison(
        individualDiscussionCurrent.comments,
        individualDiscussionPrevious.comments,
      ),
    };

    individual = {
      person: personProfile,
      metrics: individualMetrics,
      trends: {
        monthly: individualMonthly,
        repoActivity: mapRepoDistribution(individualRepoRows, repoProfileMap),
      },
    };
  }

  const leaderboardProfiles = new Set<string>();
  leaderboardPrs.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardIssues.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardReviews.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardResponders.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  leaderboardComments.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });
  mainBranchContributionRows.forEach((row) => {
    if (row.user_id) {
      leaderboardProfiles.add(row.user_id);
    }
  });

  const leaderboardMap = new Map<string, UserProfile>();
  leaderboardProfiles.forEach((id) => {
    const profile = userProfileMap.get(id);
    if (profile) {
      leaderboardMap.set(id, profile);
    }
  });

  const mainBranchContributionEntries: LeaderboardEntry[] =
    mainBranchContributionRows.map((row) => {
      const reviewCount = Number(row.review_count ?? 0);
      const authorCount = Number(row.author_count ?? 0);
      const additions = Number(row.additions ?? 0);
      const deletions = Number(row.deletions ?? 0);

      return {
        user: leaderboardMap.get(row.user_id) ??
          userProfileMap.get(row.user_id) ?? {
            id: row.user_id,
            login: null,
            name: null,
            avatarUrl: null,
          },
        value: reviewCount + authorCount,
        secondaryValue: reviewCount,
        details: [
          {
            label: "PR",
            value: authorCount,
            suffix: "건",
          },
          {
            label: "+",
            value: additions,
            sign: "positive",
            suffix: "라인",
          },
          {
            label: "-",
            value: deletions,
            sign: "negative",
            suffix: "라인",
          },
        ],
      } satisfies LeaderboardEntry;
    });

  const leaderboard: LeaderboardSummary = {
    prsCreated: mapLeaderboard(leaderboardPrs, leaderboardMap),
    issuesCreated: mapLeaderboard(leaderboardIssues, leaderboardMap),
    reviewsCompleted: mapLeaderboard(leaderboardReviews, leaderboardMap),
    fastestResponders: mapLeaderboard(leaderboardResponders, leaderboardMap),
    discussionEngagement: mapLeaderboard(leaderboardComments, leaderboardMap),
    mainBranchContribution: mainBranchContributionEntries,
  };

  const contributorProfiles = contributorIds.length
    ? await getUserProfiles(contributorIds)
    : [];

  return {
    range,
    repositories,
    contributors: contributorProfiles,
    organization,
    individual,
    leaderboard,
    timeZone,
    weekStart,
  };
}

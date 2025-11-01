import { normalizeProjectTarget } from "@/lib/activity/base-query";
import type { ActivityStatusEvent } from "@/lib/activity/status-store";
import type { IssueProjectStatus } from "@/lib/activity/types";

export const ISSUE_PROJECT_STATUS_LOCKED = new Set<IssueProjectStatus>([
  "in_progress",
  "done",
  "pending",
]);

export type ProjectStatusEntry = {
  status: string;
  occurredAt: string;
};

export type IssueStatusInfo = {
  todoStatus: IssueProjectStatus | null;
  todoStatusAt: string | null;
  activityStatus: IssueProjectStatus | null;
  activityStatusAt: string | null;
  displayStatus: IssueProjectStatus;
  source: "todo_project" | "activity" | "none";
  locked: boolean;
  timelineSource: "todo_project" | "activity" | "none";
  projectEntries: ProjectStatusEntry[];
  activityEvents: ActivityStatusEvent[];
};

export type WorkTimestamps = {
  startedAt: string | null;
  completedAt: string | null;
};

export function matchProject(projectName: unknown, target: string | null) {
  if (!target) {
    return false;
  }

  if (typeof projectName !== "string") {
    return false;
  }

  return normalizeProjectTarget(projectName) === target;
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

export function mapIssueProjectStatus(
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
    normalized.includes("progress") ||
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

  if (normalized === "canceled" || normalized === "cancelled") {
    return "canceled";
  }

  return "no_status";
}

export function extractProjectStatusEntries(
  raw: unknown,
  targetProject: string | null,
): ProjectStatusEntry[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const history = Array.isArray(
    (raw as { projectStatusHistory?: unknown }).projectStatusHistory,
  )
    ? ((raw as { projectStatusHistory?: unknown })
        .projectStatusHistory as unknown[])
    : [];

  const entries = new Map<number, ProjectStatusEntry>();
  history.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    if (!matchProject(record.projectTitle, targetProject)) {
      return;
    }

    const status =
      typeof record.status === "string" ? record.status.trim() : null;
    const occurredAt =
      typeof record.occurredAt === "string" ? record.occurredAt : null;

    if (!status || !occurredAt) {
      return;
    }

    const timestamp = Date.parse(occurredAt);
    if (Number.isNaN(timestamp)) {
      return;
    }

    entries.set(timestamp, { status, occurredAt });
  });

  return Array.from(entries.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([, value]) => value);
}

export function resolveIssueStatusInfo(
  raw: unknown,
  targetProject: string | null,
  activityEvents: ActivityStatusEvent[],
): IssueStatusInfo {
  const projectEntries = extractProjectStatusEntries(raw, targetProject);
  const latestProjectEntry =
    projectEntries.length > 0
      ? projectEntries[projectEntries.length - 1]
      : null;
  const todoStatus = latestProjectEntry
    ? mapIssueProjectStatus(latestProjectEntry.status)
    : null;
  const todoStatusAt = latestProjectEntry
    ? latestProjectEntry.occurredAt
    : null;

  const latestActivityEntry =
    activityEvents.length > 0
      ? activityEvents[activityEvents.length - 1]
      : null;
  const activityStatus = latestActivityEntry?.status ?? null;
  const activityStatusAt = latestActivityEntry?.occurredAt ?? null;

  const locked =
    todoStatus != null && ISSUE_PROJECT_STATUS_LOCKED.has(todoStatus);

  const parseTimestamp = (value: string | null | undefined) => {
    if (!value) {
      return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  };

  const todoTimestamp = parseTimestamp(todoStatusAt);
  const activityTimestamp = parseTimestamp(activityStatusAt);

  let displayStatus: IssueProjectStatus = "no_status";
  let source: IssueStatusInfo["source"] = "none";

  if (locked && todoStatus) {
    displayStatus = todoStatus;
    source = "todo_project";
  } else {
    const hasTodoStatus = todoStatus !== null;
    const hasActivityStatus = activityStatus !== null;

    if (hasTodoStatus && hasActivityStatus) {
      if (
        activityTimestamp !== null &&
        (todoTimestamp === null || activityTimestamp >= todoTimestamp)
      ) {
        displayStatus = activityStatus ?? "no_status";
        source = "activity";
      } else {
        displayStatus = todoStatus ?? "no_status";
        source = "todo_project";
      }
    } else if (hasActivityStatus) {
      displayStatus = activityStatus ?? "no_status";
      source = "activity";
    } else if (hasTodoStatus) {
      displayStatus = todoStatus ?? "no_status";
      source = "todo_project";
    }
  }

  let timelineSource: IssueStatusInfo["timelineSource"] = "none";
  if (source === "activity" && activityEvents.length > 0) {
    timelineSource = "activity";
  } else if (projectEntries.length > 0) {
    timelineSource = "todo_project";
  }
  if (timelineSource === "none" && activityEvents.length > 0) {
    timelineSource = "activity";
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
    projectEntries,
    activityEvents,
  };
}

export function resolveWorkTimestamps(
  info: IssueStatusInfo | null,
): WorkTimestamps {
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
        case "canceled":
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
    info.projectEntries.forEach((entry) => {
      const mapped = mapIssueProjectStatus(entry.status);
      if (mapped === "in_progress") {
        startedAt = entry.occurredAt;
        completedAt = null;
        return;
      }
      if (mapped === "done" || mapped === "canceled") {
        if (startedAt && !completedAt) {
          completedAt = entry.occurredAt;
        }
        return;
      }
      if (mapped === "todo" || mapped === "no_status") {
        startedAt = null;
        completedAt = null;
      }
    });
    return { startedAt, completedAt };
  }

  return { startedAt: null, completedAt: null };
}

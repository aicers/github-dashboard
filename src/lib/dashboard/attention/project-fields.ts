import { normalizeProjectTarget } from "@/lib/activity/base-query";
import type { ProjectFieldOverrides } from "@/lib/activity/project-field-store";
import {
  extractProjectStatusEntries,
  ISSUE_PROJECT_STATUS_LOCKED,
  mapIssueProjectStatus,
  matchProject,
  resolveIssueStatusInfo,
} from "@/lib/activity/status-utils";
import type { IssueProjectSnapshot } from "@/lib/dashboard/attention/types";

type IssueRaw = {
  projectStatusHistory?: unknown;
  projectItems?: unknown;
  assignees?: { nodes?: unknown[] } | null;
};

type ProjectFieldAggregate = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

type ProjectFieldValueInfo = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

type TodoProjectFieldValues = {
  priority: string | null;
  priorityUpdatedAt: string | null;
  weight: string | null;
  weightUpdatedAt: string | null;
  initiationOptions: string | null;
  initiationOptionsUpdatedAt: string | null;
  startDate: string | null;
  startDateUpdatedAt: string | null;
};

export type ProjectFieldOverrideTarget = {
  issueProjectStatusLocked?: boolean | null;
  issueTodoProjectPriority?: string | null;
  issueTodoProjectWeight?: string | null;
  issueTodoProjectInitiationOptions?: string | null;
  issueTodoProjectStartDate?: string | null;
};

function createProjectFieldAggregate(): ProjectFieldAggregate {
  return { value: null, updatedAt: null, dateValue: null };
}

function compareTimestamps(left: string, right: string) {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime === rightTime) {
      return 0;
    }
    return leftTime > rightTime ? 1 : -1;
  }

  return left.localeCompare(right);
}

function pickFirstTimestamp(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

function extractProjectFieldValueInfo(
  value: unknown,
  fallbackTimestamps: string[],
): ProjectFieldValueInfo {
  if (!value || typeof value !== "object") {
    return {
      value: null,
      updatedAt: pickFirstTimestamp(fallbackTimestamps),
      dateValue: null,
    };
  }

  const record = value as Record<string, unknown>;

  let resolvedValue: string | null = null;
  if (typeof record.name === "string" && record.name.trim().length) {
    resolvedValue = record.name.trim();
  } else if (typeof record.title === "string" && record.title.trim().length) {
    resolvedValue = record.title.trim();
  } else if (typeof record.text === "string" && record.text.trim().length) {
    resolvedValue = record.text.trim();
  } else if (
    typeof record.number === "number" &&
    Number.isFinite(record.number)
  ) {
    resolvedValue = String(record.number);
  }

  let dateValue: string | null = null;
  if (typeof record.date === "string" && record.date.trim().length) {
    dateValue = record.date.trim();
    if (!resolvedValue) {
      resolvedValue = dateValue;
    }
  }

  let updatedAt: string | null = null;
  if (typeof record.updatedAt === "string" && record.updatedAt.trim().length) {
    updatedAt = record.updatedAt.trim();
  } else {
    updatedAt = pickFirstTimestamp(fallbackTimestamps);
  }

  return {
    value: resolvedValue,
    updatedAt,
    dateValue,
  };
}

function applyProjectFieldCandidate(
  aggregate: ProjectFieldAggregate,
  candidate: ProjectFieldValueInfo,
) {
  const candidateValue = candidate.value ?? candidate.dateValue ?? null;
  if (!candidateValue) {
    return;
  }

  if (!aggregate.value && !aggregate.dateValue) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt ?? aggregate.updatedAt;
    return;
  }

  if (!candidate.updatedAt) {
    return;
  }

  if (!aggregate.updatedAt) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt;
    return;
  }

  if (compareTimestamps(candidate.updatedAt, aggregate.updatedAt) >= 0) {
    aggregate.value = candidateValue;
    aggregate.dateValue = candidate.dateValue ?? null;
    aggregate.updatedAt = candidate.updatedAt;
  }
}

export function extractTodoProjectFieldValues(
  raw: IssueRaw | null,
  targetProject: string | null,
): TodoProjectFieldValues {
  const result: TodoProjectFieldValues = {
    priority: null,
    priorityUpdatedAt: null,
    weight: null,
    weightUpdatedAt: null,
    initiationOptions: null,
    initiationOptionsUpdatedAt: null,
    startDate: null,
    startDateUpdatedAt: null,
  };

  if (!raw || !raw.projectItems || typeof raw.projectItems !== "object") {
    return result;
  }

  const connection = raw.projectItems as { nodes?: unknown };
  const nodes = Array.isArray(connection.nodes)
    ? (connection.nodes as unknown[])
    : [];

  const priorityAggregate = createProjectFieldAggregate();
  const weightAggregate = createProjectFieldAggregate();
  const initiationAggregate = createProjectFieldAggregate();
  const startAggregate = createProjectFieldAggregate();

  nodes.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    const projectRecord = record.project;
    const projectTitle =
      projectRecord && typeof projectRecord === "object"
        ? (projectRecord as { title?: unknown }).title
        : null;

    if (!matchProject(projectTitle, targetProject)) {
      return;
    }

    const fallbackTimestamps: string[] = [];
    const updatedAt =
      typeof record.updatedAt === "string" ? record.updatedAt.trim() : null;
    if (updatedAt?.length) {
      fallbackTimestamps.push(updatedAt);
    }

    const fieldRecord =
      record.field && typeof record.field === "object"
        ? (record.field as Record<string, unknown>)
        : null;
    const valueRecord =
      record.value && typeof record.value === "object"
        ? (record.value as Record<string, unknown>)
        : null;

    if (fieldRecord?.name === "Priority") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(priorityAggregate, info);
    } else if (fieldRecord?.name === "Weight") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(weightAggregate, info);
    } else if (fieldRecord?.name === "Initiation") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(initiationAggregate, info);
    } else if (fieldRecord?.name === "Start date") {
      const info = extractProjectFieldValueInfo(
        valueRecord,
        fallbackTimestamps,
      );
      applyProjectFieldCandidate(startAggregate, info);
    }
  });

  result.priority = priorityAggregate.value;
  result.priorityUpdatedAt = priorityAggregate.updatedAt;
  result.weight = weightAggregate.value;
  result.weightUpdatedAt = weightAggregate.updatedAt;
  result.initiationOptions = initiationAggregate.value;
  result.initiationOptionsUpdatedAt = initiationAggregate.updatedAt;
  result.startDate = startAggregate.dateValue ?? startAggregate.value;
  result.startDateUpdatedAt = startAggregate.updatedAt;

  // Weight field may live at the root connection nodes as direct values.
  nodes.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const record = entry as Record<string, unknown>;
    const projectRecord = record.project;
    const projectTitle =
      projectRecord && typeof projectRecord === "object"
        ? (projectRecord as { title?: unknown }).title
        : null;

    if (!matchProject(projectTitle, targetProject)) {
      return;
    }

    const fieldRecord =
      record.field && typeof record.field === "object"
        ? (record.field as Record<string, unknown>)
        : null;
    const valueRecord =
      record.value && typeof record.value === "object"
        ? (record.value as Record<string, unknown>)
        : null;

    if (fieldRecord?.name === "Weight") {
      const info = extractProjectFieldValueInfo(valueRecord, []);
      result.weight = info.value;
      result.weightUpdatedAt = info.updatedAt;
    }
  });

  return result;
}

function normalizePriorityOverride(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("p0")) {
    return "P0";
  }
  if (lowered.startsWith("p1")) {
    return "P1";
  }
  if (lowered.startsWith("p2")) {
    return "P2";
  }
  return trimmed;
}

function normalizeWeightOverride(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("heavy")) {
    return "Heavy";
  }
  if (lowered.startsWith("medium")) {
    return "Medium";
  }
  if (lowered.startsWith("light")) {
    return "Light";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function applyProjectFieldOverridesToTarget(
  target: ProjectFieldOverrideTarget,
  overrides: ProjectFieldOverrides | undefined,
) {
  if (!overrides) {
    return;
  }
  if (target.issueProjectStatusLocked) {
    return;
  }
  const normalizedPriority = normalizePriorityOverride(overrides.priority);
  if (normalizedPriority) {
    target.issueTodoProjectPriority = normalizedPriority;
  }
  const normalizedWeight = normalizeWeightOverride(overrides.weight);
  if (normalizedWeight) {
    target.issueTodoProjectWeight = normalizedWeight;
  }
  if (overrides.initiationOptions) {
    target.issueTodoProjectInitiationOptions = overrides.initiationOptions;
  }
  if (overrides.startDate) {
    target.issueTodoProjectStartDate = overrides.startDate;
  }
}

export function resolveIssueProjectSnapshot(
  raw: IssueRaw | null,
  targetProject: string | null,
): IssueProjectSnapshot {
  const entries = extractProjectStatusEntries(raw, targetProject);
  const latestEntry = entries.length ? entries[entries.length - 1] : null;
  const todoStatus = latestEntry
    ? mapIssueProjectStatus(latestEntry.status)
    : "no_status";
  const fields = extractTodoProjectFieldValues(raw, targetProject);
  const hasStatus = todoStatus !== "no_status";
  const projectStatus = hasStatus ? todoStatus : null;
  const projectStatusSource: "todo_project" | "activity" | "none" = hasStatus
    ? "todo_project"
    : "none";
  const projectStatusLocked = hasStatus
    ? ISSUE_PROJECT_STATUS_LOCKED.has(todoStatus)
    : false;

  return {
    projectStatus,
    projectStatusSource,
    projectStatusLocked,
    todoStatus: hasStatus ? todoStatus : null,
    priority: fields.priority,
    weight: fields.weight,
    initiationOptions: fields.initiationOptions,
    startDate: fields.startDate,
  };
}

// Re-export normalizeProjectTarget for use in parent attention.ts
export { normalizeProjectTarget, resolveIssueStatusInfo };

import { matchProject } from "@/lib/activity/status-utils";

export type ProjectFieldAggregate = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

export type ProjectFieldValueInfo = {
  value: string | null;
  updatedAt: string | null;
  dateValue: string | null;
};

export type TodoProjectFieldValues = {
  priority: string | null;
  priorityUpdatedAt: string | null;
  weight: string | null;
  weightUpdatedAt: string | null;
  initiationOptions: string | null;
  initiationOptionsUpdatedAt: string | null;
  startDate: string | null;
  startDateUpdatedAt: string | null;
};

export function createProjectFieldAggregate(): ProjectFieldAggregate {
  return { value: null, updatedAt: null, dateValue: null };
}

export function compareTimestamps(left: string, right: string) {
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

export function pickFirstTimestamp(candidates: string[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

export function extractProjectFieldValueInfo(
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

export function applyProjectFieldCandidate(
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

export function normalizePriorityText(value: string | null | undefined) {
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

export function normalizeWeightText(value: string | null | undefined) {
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

type IssueRawWithProjectItems = {
  projectItems?: { nodes?: unknown } | null;
};

/**
 * Extracts and normalizes project field values (priority, weight, initiation
 * options, start date) from the raw issue data for a given target project.
 * Priority and weight are normalized via `normalizePriorityText` /
 * `normalizeWeightText`.
 */
export function extractTodoProjectFieldValuesNormalized(
  raw: IssueRawWithProjectItems | null,
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
    const createdAt =
      typeof record.createdAt === "string" ? record.createdAt.trim() : null;
    if (createdAt?.length) {
      fallbackTimestamps.push(createdAt);
    }

    applyProjectFieldCandidate(
      priorityAggregate,
      extractProjectFieldValueInfo(
        (record as { priority?: unknown }).priority,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      weightAggregate,
      extractProjectFieldValueInfo(
        (record as { weight?: unknown }).weight,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      initiationAggregate,
      extractProjectFieldValueInfo(
        (record as { initiationOptions?: unknown }).initiationOptions,
        fallbackTimestamps,
      ),
    );
    applyProjectFieldCandidate(
      startAggregate,
      extractProjectFieldValueInfo(
        (record as { startDate?: unknown }).startDate,
        fallbackTimestamps,
      ),
    );
  });

  return {
    priority: normalizePriorityText(priorityAggregate.value),
    priorityUpdatedAt: priorityAggregate.updatedAt,
    weight: normalizeWeightText(weightAggregate.value),
    weightUpdatedAt: weightAggregate.updatedAt,
    initiationOptions: initiationAggregate.value,
    initiationOptionsUpdatedAt: initiationAggregate.updatedAt,
    startDate: startAggregate.dateValue ?? startAggregate.value,
    startDateUpdatedAt: startAggregate.updatedAt,
  };
}

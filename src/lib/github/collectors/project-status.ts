import { env } from "@/lib/env";

import type {
  IssueNode,
  ProjectStatusHistoryEntry,
  ProjectV2ItemFieldValue,
  ProjectV2ItemNode,
} from "./types";

export const PROJECT_REMOVED_STATUS = "__PROJECT_REMOVED__";

export function normalizeProjectName(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export const TARGET_TODO_PROJECT = normalizeProjectName(env.TODO_PROJECT_NAME);

export function isTargetProject(projectTitle: unknown) {
  if (!TARGET_TODO_PROJECT) {
    return false;
  }
  if (typeof projectTitle !== "string") {
    return false;
  }
  return normalizeProjectName(projectTitle) === TARGET_TODO_PROJECT;
}

export function extractProjectStatusHistoryFromRaw(
  raw: unknown,
): ProjectStatusHistoryEntry[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const history = record.projectStatusHistory;
  if (!Array.isArray(history)) {
    return [];
  }

  const entries: ProjectStatusHistoryEntry[] = [];
  history.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const data = item as Record<string, unknown>;
    const projectItemId =
      typeof data.projectItemId === "string" ? data.projectItemId : null;
    const status = typeof data.status === "string" ? data.status : null;
    const occurredAt =
      typeof data.occurredAt === "string" ? data.occurredAt : null;
    if (!projectItemId || !status || !occurredAt) {
      return;
    }
    const projectTitle =
      typeof data.projectTitle === "string" ? data.projectTitle : null;
    entries.push({ projectItemId, projectTitle, status, occurredAt });
  });

  return entries;
}

function extractProjectFieldValueLabel(
  value: ProjectV2ItemFieldValue | null | undefined,
): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  if (typeof record.title === "string" && record.title.trim()) {
    return record.title.trim();
  }
  if (typeof record.text === "string" && record.text.trim()) {
    return record.text.trim();
  }
  if (typeof record.number === "number" && Number.isFinite(record.number)) {
    return String(record.number);
  }
  if (typeof (record as { date?: unknown }).date === "string") {
    const dateValue = (record as { date?: string | null }).date;
    if (dateValue?.trim()) {
      return dateValue.trim();
    }
  }

  return null;
}

function resolveStatusTimestamp(item: ProjectV2ItemNode): string | null {
  const statusRecord =
    item.status && typeof item.status === "object"
      ? (item.status as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [];
  if (statusRecord) {
    candidates.push(statusRecord.updatedAt, statusRecord.createdAt);
  }
  candidates.push(item.updatedAt, item.createdAt);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

export function collectProjectStatusSnapshots(
  issue: IssueNode,
): ProjectStatusHistoryEntry[] {
  if (!TARGET_TODO_PROJECT) {
    return [];
  }

  const nodes = Array.isArray(issue.projectItems?.nodes)
    ? (issue.projectItems?.nodes as ProjectV2ItemNode[])
    : [];

  const snapshots: ProjectStatusHistoryEntry[] = [];
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const projectItemId = typeof node.id === "string" ? node.id : null;
    if (!projectItemId) {
      return;
    }

    const projectTitle =
      node.project && typeof node.project === "object"
        ? typeof node.project.title === "string"
          ? node.project.title
          : null
        : null;

    if (!isTargetProject(projectTitle)) {
      return;
    }

    const statusLabel = extractProjectFieldValueLabel(node.status ?? null);
    const occurredAt = resolveStatusTimestamp(node);

    if (!statusLabel || !occurredAt) {
      return;
    }

    snapshots.push({
      projectItemId,
      projectTitle,
      status: statusLabel,
      occurredAt,
    });
  });

  return snapshots;
}

export function mergeProjectStatusHistory(
  existing: ProjectStatusHistoryEntry[],
  snapshots: ProjectStatusHistoryEntry[],
): ProjectStatusHistoryEntry[] {
  const map = new Map<string, ProjectStatusHistoryEntry>();

  const createKey = (entry: ProjectStatusHistoryEntry) =>
    `${entry.projectItemId}|${entry.status}|${entry.occurredAt}`;

  existing.forEach((entry) => {
    map.set(createKey(entry), { ...entry });
  });

  snapshots.forEach((snapshot) => {
    const key = createKey(snapshot);
    const current = map.get(key);
    if (current) {
      if (!current.projectTitle && snapshot.projectTitle) {
        current.projectTitle = snapshot.projectTitle;
      }
      return;
    }
    map.set(key, { ...snapshot });
  });

  const entries = Array.from(map.values());
  entries.sort((a, b) => {
    const left = Date.parse(a.occurredAt);
    const right = Date.parse(b.occurredAt);
    if (!Number.isNaN(left) && !Number.isNaN(right)) {
      return left - right;
    }
    return a.occurredAt.localeCompare(b.occurredAt);
  });

  return entries;
}

export function createRemovalEntries(
  previous: ProjectStatusHistoryEntry[],
  currentSnapshots: ProjectStatusHistoryEntry[],
  detectedAt: string | null,
): ProjectStatusHistoryEntry[] {
  if (!previous.length) {
    return [];
  }

  const currentIds = new Set(
    currentSnapshots.map((entry) => entry.projectItemId),
  );
  const timestamp = detectedAt ?? new Date().toISOString();
  const grouped = new Map<string, ProjectStatusHistoryEntry[]>();

  previous.forEach((entry) => {
    const list = grouped.get(entry.projectItemId);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(entry.projectItemId, [entry]);
    }
  });

  const removals: ProjectStatusHistoryEntry[] = [];
  for (const [projectItemId, entries] of grouped) {
    if (currentIds.has(projectItemId)) {
      continue;
    }

    if (entries.some((entry) => entry.status === PROJECT_REMOVED_STATUS)) {
      continue;
    }

    const sorted = [...entries].sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt);
      const rightTime = Date.parse(right.occurredAt);
      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
        return 0;
      }
      if (Number.isNaN(leftTime)) {
        return -1;
      }
      if (Number.isNaN(rightTime)) {
        return 1;
      }
      return leftTime - rightTime;
    });
    const lastEntry = sorted[sorted.length - 1];
    removals.push({
      projectItemId,
      projectTitle: lastEntry?.projectTitle ?? null,
      status: PROJECT_REMOVED_STATUS,
      occurredAt: timestamp,
    });
  }

  return removals;
}

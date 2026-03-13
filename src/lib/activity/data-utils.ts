/**
 * Parses an unknown database value into a plain object.
 *
 * PostgreSQL JSONB columns may arrive as already-parsed objects or as JSON
 * strings depending on the driver and query path. This helper normalises both
 * cases into a `Record<string, unknown>` so callers don't need to repeat the
 * same try/catch JSON.parse dance.
 */
export function parseRawRecord(data: unknown): Record<string, unknown> | null {
  if (!data) {
    return null;
  }

  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  if (typeof data === "object") {
    return data as Record<string, unknown>;
  }

  return null;
}

/**
 * Converts a string value to an ISO 8601 timestamp string, or `null` if the
 * input is empty/invalid.
 */
export function toIso(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/**
 * Like `toIso`, but returns the original string when it cannot be parsed as a
 * valid date, instead of returning `null`.
 */
export function toIsoWithFallback(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  return toIso(value) ?? value;
}

/**
 * Converts a `Date` or date string to an ISO 8601 timestamp string, or `null`
 * if the input is empty/invalid.
 */
export function toIsoDate(
  value: Date | string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return toIso(value);
}

export type IssueRaw = {
  projectStatusHistory?: unknown;
  projectItems?: { nodes?: unknown } | null;
  assignees?: { nodes?: unknown[] } | null;
};

/**
 * Parses an unknown database value into an {@link IssueRaw} object using
 * {@link parseRawRecord} under the hood.
 */
export function parseIssueRaw(data: unknown): IssueRaw | null {
  if (!data) {
    return null;
  }

  const record = parseRawRecord(data);
  if (!record) {
    return null;
  }

  return record as IssueRaw;
}

/**
 * Extracts unique GitHub node IDs from the `assignees.nodes` field of an
 * issue's raw data.
 */
export function extractAssigneeIds(raw: IssueRaw | null): string[] {
  if (!raw) {
    return [];
  }

  const assigneeNodes = Array.isArray(raw.assignees?.nodes)
    ? (raw.assignees?.nodes as unknown[])
    : [];

  const ids = new Set<string>();
  assigneeNodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (id) {
      ids.add(id);
    }
  });

  return Array.from(ids);
}

/**
 * Extracts unique GitHub node IDs from the `assignees.nodes` field of a
 * pull request's raw data.  Accepts `unknown` and uses {@link parseRawRecord}
 * to normalise the input first.
 */
export function extractPullRequestAssigneeIds(raw: unknown): string[] {
  const record = parseRawRecord(raw);
  if (!record) {
    return [];
  }

  const assignees = record.assignees;
  if (!assignees || typeof assignees !== "object") {
    return [];
  }

  const nodes = Array.isArray((assignees as { nodes?: unknown }).nodes)
    ? ((assignees as { nodes?: unknown[] }).nodes ?? [])
    : [];

  const ids = new Set<string>();
  nodes.forEach((node) => {
    if (!node || typeof node !== "object") {
      return;
    }
    const id = (node as { id?: unknown }).id;
    if (typeof id === "string" && id.trim().length) {
      ids.add(id);
    }
  });

  return Array.from(ids);
}

import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import {
  applyProjectFieldOverrides,
  clearProjectFieldOverrides,
  type ProjectFieldOverrideUpdate,
} from "@/lib/activity/project-field-store";
import { getActivityItemDetail } from "@/lib/activity/service";
import type { IssueProjectStatus } from "@/lib/activity/types";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ProjectFieldKey =
  | "priority"
  | "weight"
  | "initiationOptions"
  | "startDate";

const FIELD_LABEL_MAP: Record<ProjectFieldKey, string> = {
  priority: "Priority",
  weight: "Weight",
  initiationOptions: "Initiation Options",
  startDate: "Start date",
};

const PRIORITY_VALUES = new Set(["P0", "P1", "P2"]);
const WEIGHT_VALUES = new Set(["Heavy", "Medium", "Light"]);
const INITIATION_VALUES = new Set(["Open to Start", "Requires Approval"]);

type ProjectFieldExpectation = {
  value: string | null;
  updatedAt: string | null;
};

function normalizeText(value: string | null | undefined) {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeComparison(
  field: ProjectFieldKey,
  value: string | null | undefined,
) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  if (field === "startDate") {
    const parsed = DateTime.fromISO(normalized);
    if (parsed.isValid) {
      return parsed.toISODate();
    }
  }

  if (field === "priority") {
    return normalized.toUpperCase();
  }

  if (field === "weight") {
    return normalized.toLowerCase();
  }

  return normalized;
}

function parseExpectedEntry(
  expectedPayload: Record<string, unknown> | undefined,
  key: ProjectFieldKey,
): ProjectFieldExpectation | undefined {
  if (!expectedPayload) {
    return undefined;
  }

  const rawEntry = expectedPayload[key];
  if (rawEntry === undefined) {
    return undefined;
  }

  if (
    rawEntry === null ||
    typeof rawEntry !== "object" ||
    Array.isArray(rawEntry)
  ) {
    throw new Error("기대한 값 형식이 올바르지 않아요.");
  }

  if (!Object.hasOwn(rawEntry, "value")) {
    throw new Error("기대한 값 형식이 올바르지 않아요.");
  }

  const rawValue = (rawEntry as { value: unknown }).value;
  let value: string | null;
  if (rawValue === null) {
    value = null;
  } else if (typeof rawValue === "string") {
    value = rawValue;
  } else {
    throw new Error("기대한 값 형식이 올바르지 않아요.");
  }

  const rawUpdatedAt = (rawEntry as { updatedAt?: unknown }).updatedAt;
  let updatedAt: string | null = null;
  if (rawUpdatedAt == null) {
    updatedAt = null;
  } else if (typeof rawUpdatedAt === "string") {
    updatedAt = rawUpdatedAt;
  } else {
    throw new Error("기대한 값 형식이 올바르지 않아요.");
  }

  return { value, updatedAt };
}

function sanitizePayloadValue(key: ProjectFieldKey, raw: unknown) {
  if (raw === null) {
    return null;
  }

  if (typeof raw === "string") {
    const text = normalizeText(raw);
    if (text === null) {
      return null;
    }

    switch (key) {
      case "priority": {
        const normalized = text.toUpperCase();
        if (!PRIORITY_VALUES.has(normalized)) {
          throw new Error("Priority 값이 올바르지 않아요.");
        }
        return normalized;
      }
      case "weight": {
        const formatted =
          text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
        if (!WEIGHT_VALUES.has(formatted)) {
          throw new Error("Weight 값이 올바르지 않아요.");
        }
        return formatted;
      }
      case "initiationOptions": {
        if (!INITIATION_VALUES.has(text)) {
          throw new Error("Initiation Options 값이 올바르지 않아요.");
        }
        return text;
      }
      case "startDate": {
        const parsed = DateTime.fromISO(text);
        if (!parsed.isValid) {
          throw new Error("Start date 값이 올바르지 않아요.");
        }
        return parsed.toISODate();
      }
      default:
        return text;
    }
  }

  throw new Error(`${FIELD_LABEL_MAP[key]} 값이 올바르지 않아요.`);
}

async function resolveIssueItem(id: string) {
  const detail = await getActivityItemDetail(id);
  if (!detail || detail.item.type !== "issue") {
    return null;
  }
  return detail;
}

function isLockedStatus(status: IssueProjectStatus | null) {
  return status === "in_progress" || status === "done" || status === "pending";
}

export async function PATCH(request: Request, context: RouteParams) {
  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json({ error: "Invalid issue id." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const record = (payload as Record<string, unknown>) ?? {};
  const providedKeys = (Object.keys(record) as ProjectFieldKey[]).filter(
    (key) =>
      key === "priority" ||
      key === "weight" ||
      key === "initiationOptions" ||
      key === "startDate",
  );

  if (providedKeys.length === 0) {
    return NextResponse.json(
      { error: "Missing project field values." },
      { status: 400 },
    );
  }

  const expectedPayloadRaw = record.expected;
  let expectedPayload: Record<string, unknown> | undefined;
  if (expectedPayloadRaw !== undefined) {
    if (
      expectedPayloadRaw === null ||
      typeof expectedPayloadRaw !== "object" ||
      Array.isArray(expectedPayloadRaw)
    ) {
      return NextResponse.json(
        { error: "기대한 값 형식이 올바르지 않아요." },
        { status: 400 },
      );
    }
    expectedPayload = expectedPayloadRaw as Record<string, unknown>;
  }

  const detail = await resolveIssueItem(id);
  if (!detail) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  if (
    detail.item.issueProjectStatusLocked &&
    providedKeys.some((key) => key !== "weight")
  ) {
    return NextResponse.json(
      {
        error: "To-do 프로젝트가 이 값을 관리하고 있어요.",
        todoStatus: detail.item.issueTodoProjectStatus,
      },
      { status: 409 },
    );
  }

  const effectiveUpdates: ProjectFieldOverrideUpdate = {};

  for (const key of providedKeys) {
    let sanitized: string | null;
    try {
      sanitized = sanitizePayloadValue(key, record[key]);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 },
      );
    }

    const currentValue = (() => {
      switch (key) {
        case "priority":
          return detail.item.issueTodoProjectPriority;
        case "weight":
          return detail.item.issueTodoProjectWeight;
        case "initiationOptions":
          return detail.item.issueTodoProjectInitiationOptions;
        case "startDate":
          return detail.item.issueTodoProjectStartDate;
        default:
          return null;
      }
    })();

    const normalizedCurrent = normalizeComparison(key, currentValue);
    const normalizedNext = normalizeComparison(key, sanitized);

    let normalizedExpected: string | null | undefined;
    try {
      const expectedEntry = parseExpectedEntry(expectedPayload, key);
      if (expectedEntry) {
        normalizedExpected = normalizeComparison(key, expectedEntry.value);
      }
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 },
      );
    }

    if (normalizedCurrent === normalizedNext) {
      continue;
    }

    if (
      normalizedExpected !== undefined &&
      normalizedExpected !== normalizedCurrent
    ) {
      const refreshed = await resolveIssueItem(id);
      const label = FIELD_LABEL_MAP[key];
      return NextResponse.json(
        {
          error: `${label} 값이 이미 변경되었어요. 최신 값을 불러왔어요.`,
          item: refreshed?.item ?? detail.item,
        },
        { status: 409 },
      );
    }

    switch (key) {
      case "priority":
        effectiveUpdates.priority = sanitized;
        break;
      case "weight":
        effectiveUpdates.weight = sanitized;
        break;
      case "initiationOptions":
        effectiveUpdates.initiationOptions = sanitized;
        break;
      case "startDate":
        effectiveUpdates.startDate = sanitized;
        break;
      default:
        break;
    }
  }

  if (
    effectiveUpdates.priority === undefined &&
    effectiveUpdates.weight === undefined &&
    effectiveUpdates.initiationOptions === undefined &&
    effectiveUpdates.startDate === undefined
  ) {
    return NextResponse.json({ item: detail.item });
  }

  await applyProjectFieldOverrides(id, effectiveUpdates);
  const updated = await resolveIssueItem(id);
  return NextResponse.json({ item: updated?.item ?? detail.item });
}

export async function DELETE(_: Request, context: RouteParams) {
  const resolvedParams = await context.params;
  const rawId = resolvedParams?.id ?? "";
  const id = decodeURIComponent(rawId.trim());
  if (!id) {
    return NextResponse.json({ error: "Invalid issue id." }, { status: 400 });
  }

  const detail = await resolveIssueItem(id);
  if (!detail) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  if (isLockedStatus(detail.item.issueTodoProjectStatus)) {
    return NextResponse.json(
      {
        error: "To-do 프로젝트가 이 값을 관리하고 있어요.",
        todoStatus: detail.item.issueTodoProjectStatus,
      },
      { status: 409 },
    );
  }

  await clearProjectFieldOverrides(id);
  const updated = await resolveIssueItem(id);
  return NextResponse.json({ item: updated?.item ?? detail.item });
}

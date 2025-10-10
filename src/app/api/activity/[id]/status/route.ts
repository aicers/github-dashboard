import { NextResponse } from "next/server";
import { clearProjectFieldOverrides } from "@/lib/activity/project-field-store";
import { getActivityItemDetail } from "@/lib/activity/service";
import {
  clearActivityStatuses,
  recordActivityStatus,
} from "@/lib/activity/status-store";
import type { IssueProjectStatus } from "@/lib/activity/types";
import { ensureSchema } from "@/lib/db";

type RouteParams = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES: IssueProjectStatus[] = [
  "no_status",
  "todo",
  "in_progress",
  "done",
  "pending",
];

const STATUS_SET = new Set<IssueProjectStatus>(ALLOWED_STATUSES);

function isIssueProjectStatus(value: unknown): value is IssueProjectStatus {
  return (
    typeof value === "string" && STATUS_SET.has(value as IssueProjectStatus)
  );
}

async function resolveIssueItem(id: string) {
  await ensureSchema();
  const detail = await getActivityItemDetail(id);
  if (!detail || detail.item.type !== "issue") {
    return null;
  }
  return detail;
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

  const status = (payload as { status?: unknown })?.status;
  if (!isIssueProjectStatus(status)) {
    return NextResponse.json(
      { error: "Missing or invalid status value." },
      { status: 400 },
    );
  }

  const detail = await resolveIssueItem(id);
  if (!detail) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  if (detail.item.issueProjectStatusLocked) {
    return NextResponse.json(
      {
        error: "Status managed by the to-do list project.",
        todoStatus: detail.item.issueTodoProjectStatus,
      },
      { status: 409 },
    );
  }

  if (status === "no_status") {
    await clearActivityStatuses(id);
  } else {
    await recordActivityStatus(id, status);
  }

  const updated = await resolveIssueItem(id);
  if (updated?.item.issueProjectStatusLocked) {
    await clearProjectFieldOverrides(id);
    const refreshed = await resolveIssueItem(id);
    return NextResponse.json({ item: refreshed?.item ?? updated.item });
  }

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

  await clearActivityStatuses(id);
  const updated = await resolveIssueItem(id);
  return NextResponse.json({ item: updated?.item ?? detail.item });
}

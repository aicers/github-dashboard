import {
  CommentDiscussionIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  type IconProps,
  IssueClosedIcon,
  IssueOpenedIcon,
} from "@primer/octicons-react";
import { type ComponentType, Fragment, type ReactNode } from "react";

import type { ActivityItem } from "@/lib/activity/types";

export type ActivityIconInfo = {
  Icon: ComponentType<IconProps>;
  className: string;
  label: string;
};

export const CATEGORY_LABELS: Record<ActivityItem["type"], string> = {
  issue: "이슈",
  pull_request: "PR",
  discussion: "토론",
};

export const STATUS_LABELS: Record<ActivityItem["status"], string> = {
  open: "열림",
  closed: "닫힘",
  merged: "병합됨",
};

export function resolveActivityIcon(
  item: Pick<ActivityItem, "type" | "status">,
): ActivityIconInfo {
  const typeLabel = CATEGORY_LABELS[item.type] ?? "항목";
  const statusLabel = STATUS_LABELS[item.status] ?? item.status;

  if (item.type === "pull_request") {
    if (item.status === "merged") {
      return {
        Icon: GitMergeIcon,
        className: "text-purple-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    if (item.status === "closed") {
      return {
        Icon: GitPullRequestClosedIcon,
        className: "text-rose-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: GitPullRequestIcon,
      className: "text-emerald-500",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  if (item.type === "issue") {
    if (item.status === "closed" || item.status === "merged") {
      return {
        Icon: IssueClosedIcon,
        className:
          item.status === "merged" ? "text-purple-500" : "text-rose-500",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: IssueOpenedIcon,
      className: "text-emerald-500",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  return {
    Icon: CommentDiscussionIcon,
    className: item.status === "closed" ? "text-rose-500" : "text-sky-500",
    label: `${typeLabel} ${statusLabel}`,
  };
}

export function renderTitleWithInlineCode(title: string | null): ReactNode {
  if (!title) {
    return "Untitled";
  }
  const segments = title.split(/(`[^`]*`)/g);
  let keyCounter = 0;
  return segments.map((segment) => {
    const key = `title-segment-${keyCounter++}`;
    const isCode =
      segment.startsWith("`") && segment.endsWith("`") && segment.length >= 2;
    if (!isCode) {
      return (
        <Fragment key={key}>{segment.length ? segment : "\u00a0"}</Fragment>
      );
    }
    const content = segment.slice(1, -1);
    return (
      <code
        key={key}
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/90"
      >
        {content.length ? content : "\u00a0"}
      </code>
    );
  });
}

export function differenceLabel(
  value: number | null | undefined,
  suffix = "일",
) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value <= 0) {
    return `오늘 (0${suffix})`;
  }
  return `${value.toString()}${suffix}`;
}

export type ActivityMetricEntry = { key: string; content: ReactNode };

export function formatUserHandle(user: ActivityItem["author"]) {
  if (!user) {
    return null;
  }

  const base = user.login ?? user.name ?? user.id;
  if (!base) {
    return null;
  }

  const trimmed = base.trim();
  if (!trimmed.length) {
    return null;
  }

  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function sortByBusinessDays<
  T extends { businessDaysWaiting: number | null | undefined },
>(entries: T[]) {
  return entries.slice().sort((a, b) => {
    const left = a.businessDaysWaiting ?? 0;
    const right = b.businessDaysWaiting ?? 0;
    return right - left;
  });
}

export function buildActivityMetricEntries(
  item: ActivityItem,
): ActivityMetricEntry[] {
  const metrics: ActivityMetricEntry[] = [];

  const ageLabel = differenceLabel(item.businessDaysOpen, "일") ?? "-";
  metrics.push({ key: "age", content: <>Age {ageLabel}</> });

  const idleLabel = differenceLabel(item.businessDaysIdle, "일") ?? "-";
  metrics.push({ key: "idle", content: <>Idle {idleLabel}</> });

  if (
    item.businessDaysSinceInProgress !== undefined &&
    item.businessDaysSinceInProgress !== null
  ) {
    const progressLabel =
      differenceLabel(item.businessDaysSinceInProgress, "일") ?? "-";
    metrics.push({ key: "progress", content: <>Progress {progressLabel}</> });
  }

  if (item.reviewRequestWaits?.length) {
    const reviewWaits = sortByBusinessDays(item.reviewRequestWaits);
    const parts = reviewWaits.map((wait) => {
      const handle = formatUserHandle(wait.reviewer) ?? "-";
      const waitLabel = differenceLabel(wait.businessDaysWaiting, "일") ?? "-";
      return `${handle} ${waitLabel}`;
    });
    metrics.push({
      key: "review",
      content: <>Review {parts.join(", ")}</>,
    });
  }

  if (item.mentionWaits?.length) {
    const mentionWaits = sortByBusinessDays(item.mentionWaits);
    const parts = mentionWaits.map((wait) => {
      const handle = formatUserHandle(wait.user) ?? "-";
      const waitLabel = differenceLabel(wait.businessDaysWaiting, "일") ?? "-";
      return `${handle} ${waitLabel}`;
    });
    metrics.push({
      key: "mention",
      content: <>Mention {parts.join(", ")}</>,
    });
  }

  return metrics;
}

export function formatRelative(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMs = date.getTime() - Date.now();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, unitMs] of units) {
    const valueInUnit = diffMs / unitMs;
    if (Math.abs(valueInUnit) >= 1) {
      return formatter.format(Math.round(valueInUnit), unit);
    }
  }

  return "just now";
}

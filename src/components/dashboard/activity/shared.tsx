import {
  CommentDiscussionIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  type IconProps,
  IssueClosedIcon,
  IssueOpenedIcon,
  LinkIcon,
} from "@primer/octicons-react";
import { type ComponentType, Fragment, type ReactNode } from "react";

import type {
  ActivityItem,
  ActivityLinkedIssue,
  ActivityLinkedPullRequest,
  ActivityLinkedPullRequestStatus,
} from "@/lib/activity/types";

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

const LINKED_PR_STATUS_LABELS: Record<ActivityLinkedPullRequestStatus, string> =
  {
    open: "열림",
    closed: "닫힘",
    merged: "병합됨",
  };

function formatRepositoryReference(
  repositoryNameWithOwner: string | null,
  number: number | null,
) {
  const repoLabel = repositoryNameWithOwner?.trim();
  if (!repoLabel?.length) {
    if (typeof number === "number") {
      return `#${number}`;
    }
    return null;
  }
  if (number === null || number === undefined) {
    return repoLabel;
  }
  return `${repoLabel}#${number}`;
}

function mapIssueStateLabel(state: string | null) {
  if (!state) {
    return null;
  }
  const lowered = state.toLowerCase();
  if (lowered === "open") {
    return "열림";
  }
  if (lowered === "closed") {
    return "닫힘";
  }
  if (lowered === "merged") {
    return "병합됨";
  }
  return state;
}

export function buildLinkedPullRequestSummary(pr: ActivityLinkedPullRequest): {
  id: string;
  url: string | null;
  label: string;
  status: string | null;
  statusKey: ActivityLinkedPullRequestStatus;
} {
  const label =
    formatRepositoryReference(pr.repositoryNameWithOwner, pr.number) ?? pr.id;
  const status = LINKED_PR_STATUS_LABELS[pr.status] ?? pr.status ?? null;
  return {
    id: pr.id,
    url: pr.url ?? null,
    label,
    status,
    statusKey: pr.status,
  };
}

export function buildLinkedIssueSummary(issue: ActivityLinkedIssue): {
  id: string;
  url: string | null;
  label: string;
  status: string | null;
  statusKey: string | null;
} {
  const label =
    formatRepositoryReference(issue.repositoryNameWithOwner, issue.number) ??
    issue.id;
  const status = mapIssueStateLabel(issue.state);
  const statusKey = issue.state ? issue.state.toLowerCase() : null;
  return { id: issue.id, url: issue.url ?? null, label, status, statusKey };
}

export function renderLinkedReferenceInline({
  label,
  type,
  entries,
  maxItems = 2,
}: {
  label: string;
  type: "issue" | "pull_request";
  entries: Array<{
    id: string;
    url: string | null;
    label: string;
    status: string | null;
    statusKey?: string | null;
  }>;
  maxItems?: number;
}): ReactNode {
  if (!entries.length) {
    return null;
  }

  const limited = entries.slice(0, Math.max(1, maxItems));
  const remaining = entries.length - limited.length;
  const resolveStatusIcon = (
    statusKey: string | null | undefined,
  ): { Icon: ComponentType<IconProps>; className: string } => {
    const normalized = statusKey?.toLowerCase() ?? null;
    if (type === "pull_request") {
      if (normalized === "merged") {
        return { Icon: GitMergeIcon, className: "text-github-merged" };
      }
      if (normalized === "closed") {
        return {
          Icon: GitPullRequestClosedIcon,
          className: "text-github-closed",
        };
      }
      if (normalized === "draft") {
        return { Icon: GitPullRequestIcon, className: "text-github-draft" };
      }
      return { Icon: GitPullRequestIcon, className: "text-github-open" };
    }
    if (normalized === "closed" || normalized === "merged") {
      return { Icon: IssueClosedIcon, className: "text-github-merged" };
    }
    return { Icon: IssueOpenedIcon, className: "text-github-open" };
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center justify-center leading-none text-muted-foreground">
        <LinkIcon size={12} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
      {limited.map((entry) => {
        const { Icon: EntryStatusIcon, className } = resolveStatusIcon(
          entry.statusKey,
        );
        return (
          <span
            key={entry.id}
            className="inline-flex items-center gap-1 text-foreground/90"
          >
            <EntryStatusIcon
              size={12}
              className={className}
              aria-hidden="true"
            />
            {entry.url ? (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="reference-link"
              >
                {entry.label}
              </a>
            ) : (
              <span>{entry.label}</span>
            )}
          </span>
        );
      })}
      {remaining > 0 ? (
        <span className="text-muted-foreground">외 {remaining}건</span>
      ) : null}
    </span>
  );
}

export function resolveActivityIcon(
  item: Pick<ActivityItem, "type" | "status">,
): ActivityIconInfo {
  const typeLabel = CATEGORY_LABELS[item.type] ?? "항목";
  const statusLabel = STATUS_LABELS[item.status] ?? item.status;

  if (item.type === "pull_request") {
    if (item.status === "merged") {
      return {
        Icon: GitMergeIcon,
        className: "text-github-merged",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    if (item.status === "closed") {
      return {
        Icon: GitPullRequestClosedIcon,
        className: "text-github-closed",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: GitPullRequestIcon,
      className: "text-github-open",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  if (item.type === "issue") {
    if (item.status === "closed" || item.status === "merged") {
      return {
        Icon: IssueClosedIcon,
        className: "text-github-merged",
        label: `${typeLabel} ${statusLabel}`,
      };
    }
    return {
      Icon: IssueOpenedIcon,
      className: "text-github-open",
      label: `${typeLabel} ${statusLabel}`,
    };
  }

  return {
    Icon: CommentDiscussionIcon,
    className:
      item.status === "closed" ? "text-github-closed" : "text-github-open",
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

export type AttentionBadgeDescriptor = {
  key: string;
  label: string;
  variant: "default" | "manual" | "ai-soft";
  tooltip?: string;
};

export function buildAttentionBadges(
  item: ActivityItem,
  options: { useMentionAi: boolean },
): AttentionBadgeDescriptor[] {
  const badges: AttentionBadgeDescriptor[] = [];
  const push = (
    key: string,
    label: string,
    variant: AttentionBadgeDescriptor["variant"] = "default",
    tooltip?: string,
  ) => {
    badges.push({ key, label, variant, tooltip });
  };

  const hasManualSuppress = item.mentionWaits?.some(
    (wait) => wait.manualRequiresResponse === false,
  );
  const hasAiSoftBadge =
    !options.useMentionAi &&
    item.mentionWaits?.some((wait) => {
      if (wait.manualRequiresResponse === true) {
        return false;
      }
      return wait.requiresResponse === false;
    });

  if (item.attention.unansweredMention) {
    if (hasAiSoftBadge) {
      push(
        "unanswered-mention",
        "응답 없는 멘션",
        "ai-soft",
        "AI는 응답을 요구하지 않은 멘션으로 생각합니다.",
      );
    } else {
      push("unanswered-mention", "응답 없는 멘션");
    }
  }
  if (item.attention.reviewRequestPending) {
    push("review-request", "응답 없는 리뷰 요청");
  }
  if (item.attention.staleOpenPr) {
    push("stale-pr", "오래된 PR");
  }
  if (item.attention.idlePr) {
    push("idle-pr", "업데이트 없는 PR");
  }
  if (item.attention.backlogIssue) {
    push("backlog-issue", "정체된 Backlog 이슈");
  }
  if (item.attention.stalledIssue) {
    push("stalled-issue", "정체된 In Progress 이슈");
  }
  if (hasManualSuppress) {
    push("manual-suppress", "응답 요구가 아님", "manual");
  }

  return badges;
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

  const withoutPrefix = trimmed.startsWith("@")
    ? trimmed.slice(1).trim()
    : trimmed;

  return withoutPrefix.length ? withoutPrefix : trimmed;
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
      const handle =
        formatUserHandle(wait.user) ?? (wait.userId ? `@${wait.userId}` : "-");
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

function toSentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return trimmed;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
      return toSentenceCase(formatter.format(Math.round(valueInUnit), unit));
    }
  }

  return toSentenceCase("just now");
}

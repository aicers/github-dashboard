import type {
  ActivityItem,
  ActivityRepository,
  ActivityUser,
} from "@/lib/activity/types";
import type {
  MentionAttentionItem,
  RepositoryReference,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  ISSUE_RELATION_BADGE_CLASS,
} from "../activity/detail-shared";
import type { AttentionBadgeDescriptor } from "../activity/shared";

export function formatUserCompact(user: UserReference | null): string {
  if (!user) {
    return "-";
  }

  const candidate = user.login ?? user.name ?? user.id;
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "-";
}

export function formatUserListCompact(users: UserReference[]): string {
  const list = users
    .map((user) => formatUserCompact(user))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== "-");
  return list.length > 0 ? list.join(", ") : "-";
}

export function formatRepository(repository: RepositoryReference | null) {
  if (!repository) {
    return "알 수 없음";
  }

  return repository.nameWithOwner ?? repository.name ?? repository.id;
}

export function renderAttentionBadgeElements(
  badges: AttentionBadgeDescriptor[],
  itemId: string,
) {
  return badges.map((badge) => {
    const variantClass =
      badge.variant === "manual"
        ? "border border-slate-300 bg-slate-100 text-slate-700"
        : badge.variant === "ai-soft"
          ? "border border-sky-300 bg-sky-50 text-sky-700 shadow-[0_0_0.65rem_rgba(56,189,248,0.25)]"
          : badge.variant === "answered"
            ? "border border-pink-200 bg-pink-100 text-pink-700"
            : badge.variant === "relation"
              ? ISSUE_RELATION_BADGE_CLASS
              : "bg-amber-100 text-amber-700";
    const tooltipId = badge.tooltip
      ? `${itemId}-${badge.key}-tooltip`
      : undefined;
    return (
      <span
        key={`${itemId}-badge-${badge.key}`}
        className={cn(
          "relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
          variantClass,
          badge.tooltip
            ? "group cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            : "",
        )}
        tabIndex={badge.tooltip ? 0 : undefined}
        aria-describedby={tooltipId}
      >
        {badge.label}
        {badge.tooltip ? (
          <span
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute left-1/2 top-full z-20 w-60 -translate-x-1/2 translate-y-2 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {badge.tooltip}
          </span>
        ) : null}
      </span>
    );
  });
}

export function applyAttentionFlagsFromMap(
  map: Map<string, Partial<ActivityItem["attention"]>>,
  activityItem: ActivityItem,
  ...ids: Array<string | null | undefined>
) {
  ids.forEach((id) => {
    if (!id) {
      return;
    }
    const patch = map.get(id);
    if (!patch) {
      return;
    }
    activityItem.attention = { ...activityItem.attention, ...patch };
  });
}

export function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--일";
  }

  return `${value.toLocaleString()}일`;
}

export function formatTimestamp(
  iso: string,
  timeZone: string,
  displayFormat: DateTimeDisplayFormat,
) {
  return formatDateTime(iso, timeZone, displayFormat);
}

export function formatCount(value: number) {
  return `${value.toLocaleString()}건`;
}

export const FOLLOW_UP_SECTION_ORDER = [
  "backlog-issues",
  "stalled-in-progress-issues",
  "reviewer-unassigned-prs",
  "review-stalled-prs",
  "merge-delayed-prs",
  "stuck-review-requests",
  "unanswered-mentions",
] as const;

export const FOLLOW_UP_SECTION_SET = new Set<string>(FOLLOW_UP_SECTION_ORDER);

export function toActivityUser(
  user: UserReference | null,
): ActivityUser | null {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: null,
  };
}

export function toActivityUsers(users: UserReference[]): ActivityUser[] {
  return users
    .map((user) => toActivityUser(user))
    .filter((user): user is ActivityUser => user !== null);
}

export function toActivityReviewWaits(
  entries: ReviewRequestAttentionItem[],
): NonNullable<ActivityItem["reviewRequestWaits"]> {
  return entries.map((entry) => ({
    id: entry.id,
    reviewer: toActivityUser(entry.reviewer ?? null),
    requestedAt: entry.requestedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
  }));
}

export function toActivityMentionWaits(
  entries: MentionAttentionItem[],
): NonNullable<ActivityItem["mentionWaits"]> {
  return entries.map((entry) => ({
    id: entry.commentId,
    user: toActivityUser(entry.target ?? null),
    userId: entry.target?.id ?? null,
    mentionedAt: entry.mentionedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
    requiresResponse: entry.classification?.requiresResponse ?? null,
    manualRequiresResponse:
      entry.classification?.manualRequiresResponse ?? null,
    manualRequiresResponseAt:
      entry.classification?.manualRequiresResponseAt ?? null,
    manualDecisionIsStale: entry.classification?.manualDecisionIsStale ?? false,
    classifierEvaluatedAt: entry.classification?.lastEvaluatedAt ?? null,
  }));
}

export function toActivityRepository(
  repository: RepositoryReference | null,
): ActivityRepository | null {
  if (!repository) {
    return null;
  }
  return {
    id: repository.id,
    name: repository.name,
    nameWithOwner: repository.nameWithOwner,
  };
}

export function buildAttention(
  overrides: Partial<ActivityItem["attention"]>,
): ActivityItem["attention"] {
  return {
    unansweredMention: false,
    reviewRequestPending: false,
    reviewerUnassignedPr: false,
    reviewStalledPr: false,
    mergeDelayedPr: false,
    backlogIssue: false,
    stalledIssue: false,
    ...overrides,
  };
}

export function createBaseActivityItem({
  id,
  type,
  status = "open",
  number = null,
  title = null,
  url = null,
  repository,
  author,
  createdAt = null,
  updatedAt = null,
  attention = {},
}: {
  id: string;
  type: ActivityItem["type"];
  status?: ActivityItem["status"];
  number?: number | null;
  title?: string | null;
  url?: string | null;
  repository: RepositoryReference | null;
  author: UserReference | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  attention?: Partial<ActivityItem["attention"]>;
}): ActivityItem {
  return {
    id,
    type,
    status,
    number,
    title,
    url,
    state: status,
    issueProjectStatus: null,
    issueProjectStatusSource: "none",
    issueProjectStatusLocked: false,
    issueTodoProjectStatus: null,
    issueTodoProjectStatusAt: null,
    issueTodoProjectPriority: null,
    issueTodoProjectPriorityUpdatedAt: null,
    issueTodoProjectWeight: null,
    issueTodoProjectWeightUpdatedAt: null,
    issueTodoProjectInitiationOptions: null,
    issueTodoProjectInitiationOptionsUpdatedAt: null,
    issueTodoProjectStartDate: null,
    issueTodoProjectStartDateUpdatedAt: null,
    issueActivityStatus: null,
    issueActivityStatusAt: null,
    linkedPullRequests: [],
    linkedIssues: [],
    repository: toActivityRepository(repository),
    author: toActivityUser(author),
    assignees: [],
    reviewers: [],
    mentionedUsers: [],
    commenters: [],
    reactors: [],
    labels: [],
    issueType: null,
    milestone: null,
    hasParentIssue: false,
    hasSubIssues: false,
    createdAt,
    updatedAt,
    closedAt: null,
    mergedAt: null,
    businessDaysOpen: null,
    businessDaysIdle: null,
    businessDaysSinceInProgress: null,
    businessDaysInProgressOpen: null,
    attention: buildAttention(attention),
  };
}

export function buildReferenceLabel(
  repository: RepositoryReference | null,
  number: number | null | undefined,
) {
  const repoLabel = formatRepository(repository);
  if (number === null || number === undefined) {
    return repoLabel;
  }
  return `${repoLabel}#${number.toString()}`;
}

"use client";

import {
  AtSign,
  ChevronRight,
  CircleDot,
  GitPullRequest,
  GitPullRequestDraft,
  LayoutGrid,
  MessageSquare,
  Play,
  RefreshCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchActivityDetail } from "@/lib/activity/client";
import type {
  ActivityItem,
  ActivityItemDetail,
  ActivityMentionWait,
  ActivityRepository,
  ActivityUser,
  IssueProjectStatus,
} from "@/lib/activity/types";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
  RepositoryReference,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import {
  buildFollowUpSummaries,
  type FollowUpSummary,
  formatUser,
  type RankingEntry,
  sortRankingByCount,
  sortRankingByTotal,
} from "@/lib/dashboard/attention-summaries";
import type { DateTimeDisplayFormat } from "@/lib/date-time-format";
import { subscribeToSyncStream } from "@/lib/sync/client-stream";
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "./activity/activity-detail-overlay";
import { ActivityListItemSummary } from "./activity/activity-list-item-summary";
import {
  ActivityCommentSection,
  formatDateOnly,
  formatDateTime,
  formatProjectField,
  ISSUE_MILESTONE_BADGE_CLASS,
  ISSUE_PRIORITY_BADGE_CLASS,
  ISSUE_RELATION_BADGE_CLASS,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_STATUS_OPTIONS,
  ISSUE_TYPE_BADGE_CLASS,
  ISSUE_WEIGHT_BADGE_CLASS,
  MentionOverrideControls,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_BADGE_CLASS,
  PROJECT_FIELD_LABELS,
  ProjectFieldEditor,
  type ProjectFieldKey,
  ReactionSummaryList,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "./activity/detail-shared";
import {
  type AttentionBadgeDescriptor,
  buildActivityMetricEntries,
  buildAttentionBadges,
  buildLinkedIssueSummary,
  buildLinkedPullRequestSummary,
  formatRelative,
  renderLinkedReferenceInline,
  resolveActivityIcon,
} from "./activity/shared";

function formatUserCompact(user: UserReference | null): string {
  if (!user) {
    return "-";
  }

  const candidate = user.login ?? user.name ?? user.id;
  const trimmed = candidate?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "-";
}

function formatUserListCompact(users: UserReference[]): string {
  const list = users
    .map((user) => formatUserCompact(user))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== "-");
  return list.length > 0 ? list.join(", ") : "-";
}

function formatRepository(repository: RepositoryReference | null) {
  if (!repository) {
    return "알 수 없음";
  }

  return repository.nameWithOwner ?? repository.name ?? repository.id;
}

function renderAttentionBadgeElements(
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

function applyAttentionFlagsFromMap(
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

function formatDays(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "--일";
  }

  return `${value.toLocaleString()}일`;
}

function formatTimestamp(
  iso: string,
  timeZone: string,
  displayFormat: DateTimeDisplayFormat,
) {
  return formatDateTime(iso, timeZone, displayFormat);
}

function formatCount(value: number) {
  return `${value.toLocaleString()}건`;
}

const FOLLOW_UP_SECTION_ORDER = [
  "backlog-issues",
  "stalled-in-progress-issues",
  "reviewer-unassigned-prs",
  "review-stalled-prs",
  "merge-delayed-prs",
  "stuck-review-requests",
  "unanswered-mentions",
] as const;

const FOLLOW_UP_SECTION_SET = new Set<string>(FOLLOW_UP_SECTION_ORDER);

function toActivityUser(user: UserReference | null): ActivityUser | null {
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

function toActivityUsers(users: UserReference[]): ActivityUser[] {
  return users
    .map((user) => toActivityUser(user))
    .filter((user): user is ActivityUser => user !== null);
}

function toActivityReviewWaits(
  entries: ReviewRequestAttentionItem[],
): NonNullable<ActivityItem["reviewRequestWaits"]> {
  return entries.map((entry) => ({
    id: entry.id,
    reviewer: toActivityUser(entry.reviewer ?? null),
    requestedAt: entry.requestedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
  }));
}

function toActivityMentionWaits(
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

function toActivityRepository(
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

function buildAttention(
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

function createBaseActivityItem({
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

function buildReferenceLabel(
  repository: RepositoryReference | null,
  number: number | null | undefined,
) {
  const repoLabel = formatRepository(repository);
  if (number === null || number === undefined) {
    return repoLabel;
  }
  return `${repoLabel}#${number.toString()}`;
}

function useActivityDetailState() {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<
    Record<string, ActivityItemDetail | null>
  >({});
  const [loadingDetailIds, setLoadingDetailIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    return () => {
      controllersRef.current.forEach((controller) => {
        controller.abort();
      });
      controllersRef.current.clear();
    };
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id.trim()) {
      return;
    }

    setLoadingDetailIds((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });

    const existing = controllersRef.current.get(id);
    existing?.abort();

    const controller = new AbortController();
    controllersRef.current.set(id, controller);

    try {
      const detail = await fetchActivityDetail(id, {
        signal: controller.signal,
      });
      setDetailMap((current) => ({
        ...current,
        [id]: detail,
      }));
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error(error);
        setDetailMap((current) => ({
          ...current,
          [id]: null,
        }));
      }
    } finally {
      controllersRef.current.delete(id);
      setLoadingDetailIds((current) => {
        if (!current.has(id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const selectItem = useCallback(
    (id: string) => {
      setOpenItemId((current) => {
        if (current === id) {
          const controller = controllersRef.current.get(id);
          controller?.abort();
          controllersRef.current.delete(id);
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(id)) {
              return loadings;
            }
            const next = new Set(loadings);
            next.delete(id);
            return next;
          });
          return null;
        }

        if (current) {
          const controller = controllersRef.current.get(current);
          controller?.abort();
          controllersRef.current.delete(current);
          setLoadingDetailIds((loadings) => {
            if (!loadings.has(current)) {
              return loadings;
            }
            const next = new Set(loadings);
            next.delete(current);
            return next;
          });
        }

        if (!detailMap[id] && !loadingDetailIds.has(id)) {
          void loadDetail(id);
        }

        return id;
      });
    },
    [detailMap, loadDetail, loadingDetailIds],
  );

  const closeItem = useCallback(() => {
    setOpenItemId((current) => {
      if (!current) {
        return current;
      }
      const controller = controllersRef.current.get(current);
      controller?.abort();
      controllersRef.current.delete(current);
      setLoadingDetailIds((loadings) => {
        if (!loadings.has(current)) {
          return loadings;
        }
        const next = new Set(loadings);
        next.delete(current);
        return next;
      });
      return null;
    });
  }, []);

  const updateDetailItem = useCallback((nextItem: ActivityItem) => {
    setDetailMap((current) => {
      const existing = current[nextItem.id];
      if (!existing) {
        return current;
      }
      return {
        ...current,
        [nextItem.id]: { ...existing, item: nextItem },
      };
    });
  }, []);

  return {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
    updateDetailItem,
    loadDetail,
  };
}

export function FollowUpDetailContent({
  item,
  detail,
  isLoading,
  timezone,
  dateTimeFormat,
  isUpdatingStatus,
  isUpdatingProjectFields,
  onUpdateStatus,
  onUpdateProjectField,
  canManageMentions = false,
  pendingMentionOverrideKey = null,
  onUpdateMentionOverride,
}: {
  item: ActivityItem;
  detail: ActivityItemDetail | undefined;
  isLoading: boolean;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  isUpdatingStatus: boolean;
  isUpdatingProjectFields: boolean;
  onUpdateStatus: (item: ActivityItem, status: IssueProjectStatus) => void;
  onUpdateProjectField: (
    item: ActivityItem,
    field: ProjectFieldKey,
    value: string | null,
  ) => Promise<boolean>;
  canManageMentions?: boolean;
  pendingMentionOverrideKey?: string | null;
  onUpdateMentionOverride?: (params: {
    itemId: string;
    commentId: string;
    mentionedUserId: string;
    state: "suppress" | "force" | "clear";
  }) => void;
}) {
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="text-sm text-muted-foreground/80">
        선택한 항목의 내용을 불러오지 못했습니다.
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-sm text-muted-foreground/80">
        내용을 불러오는 중입니다.
      </div>
    );
  }

  const detailItem = detail.item ?? item;
  const currentIssueStatus = detailItem.issueProjectStatus ?? "no_status";
  const formatOptionalDateTime = (
    value: string | null | undefined,
  ): string | null => {
    if (!value) {
      return null;
    }

    return formatDateTime(value, timezone, dateTimeFormat);
  };
  const statusSourceLabel =
    detailItem.issueProjectStatusSource === "todo_project"
      ? "To-do 프로젝트"
      : detailItem.issueProjectStatusSource === "activity"
        ? "Activity"
        : "없음";
  const todoStatusLabel = detailItem.issueTodoProjectStatus
    ? (ISSUE_STATUS_LABEL_MAP.get(detailItem.issueTodoProjectStatus) ??
      detailItem.issueTodoProjectStatus)
    : "-";
  const todoPriorityLabel = formatProjectField(
    detailItem.issueTodoProjectPriority,
  );
  const todoWeightLabel = formatProjectField(detailItem.issueTodoProjectWeight);
  const todoWeightTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectWeightUpdatedAt,
  );
  const todoInitiationLabel = formatProjectField(
    detailItem.issueTodoProjectInitiationOptions,
  );
  const todoInitiationTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectInitiationOptionsUpdatedAt,
  );
  const todoStartDateLabel = formatDateOnly(
    detailItem.issueTodoProjectStartDate,
    timezone,
  );
  const todoStartDateTimestamp = formatOptionalDateTime(
    detailItem.issueTodoProjectStartDateUpdatedAt,
  );
  const canEditStatus =
    detailItem.type === "issue" && !detailItem.issueProjectStatusLocked;
  const sourceStatusTimes =
    detailItem.issueProjectStatusSource === "todo_project"
      ? (detail.todoStatusTimes ?? null)
      : detailItem.issueProjectStatusSource === "activity"
        ? (detail.activityStatusTimes ?? null)
        : null;
  const sourceStatusEntries = SOURCE_STATUS_KEYS.map((statusKey) => {
    const label = ISSUE_STATUS_LABEL_MAP.get(statusKey) ?? statusKey;
    const value = sourceStatusTimes?.[statusKey] ?? null;
    const formatted = formatOptionalDateTime(value) ?? "-";
    return { key: statusKey, label, value: formatted };
  });

  const renderedBody = resolveDetailBodyHtml(detail);
  const renderedContent = renderedBody
    ? renderMarkdownHtml(renderedBody)
    : null;
  const mentionWaits = detailItem.mentionWaits ?? [];
  const commentsList = detail.comments ?? [];
  const commentIdSet = new Set(
    commentsList
      .map((comment) => comment.id?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const mentionWaitsByCommentId = new Map<string, ActivityMentionWait[]>();
  const orphanMentionWaits: ActivityMentionWait[] = [];

  mentionWaits.forEach((wait) => {
    const commentKey = wait.id?.trim();
    if (commentKey && commentIdSet.has(commentKey)) {
      const current = mentionWaitsByCommentId.get(commentKey);
      if (current) {
        current.push(wait);
      } else {
        mentionWaitsByCommentId.set(commentKey, [wait]);
      }
      return;
    }
    orphanMentionWaits.push(wait);
  });

  const mentionControlsProps =
    mentionWaits.length > 0
      ? {
          byCommentId: Object.fromEntries(mentionWaitsByCommentId.entries()),
          canManageMentions,
          pendingOverrideKey: pendingMentionOverrideKey,
          onUpdateMentionOverride,
          detailItemId: detailItem.id,
        }
      : undefined;

  return (
    <div className="space-y-3 text-sm">
      {detailItem.type === "issue" && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground/70">
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground/60">Source:</span>
                <span className="text-foreground">{statusSourceLabel}</span>
              </span>
              {sourceStatusEntries.map(({ key, label, value }) => (
                <span
                  key={`${detailItem.id}-source-${key}`}
                  className="flex items-center gap-1"
                >
                  {label}:<span className="text-foreground">{value}</span>
                </span>
              ))}
              {detailItem.issueProjectStatusLocked && (
                <span className="text-amber-600">
                  To-do 프로젝트 상태({todoStatusLabel})로 잠겨 있어요.
                </span>
              )}
            </div>
            {(isUpdatingStatus || isUpdatingProjectFields) && (
              <span className="text-muted-foreground/70">업데이트 중...</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {ISSUE_STATUS_OPTIONS.map((option) => {
              const optionStatus = option.value as IssueProjectStatus;
              const active = currentIssueStatus === optionStatus;
              return (
                <Button
                  key={`status-action-${option.value}`}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  disabled={
                    isUpdatingStatus ||
                    isUpdatingProjectFields ||
                    !canEditStatus
                  }
                  onClick={() => onUpdateStatus(detailItem, optionStatus)}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-muted-foreground/80">
            <ProjectFieldEditor
              item={detailItem}
              field="priority"
              label="Priority"
              rawValue={detailItem.issueTodoProjectPriority}
              formattedValue={todoPriorityLabel}
              timestamp={null}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="weight"
              label="Weight"
              rawValue={detailItem.issueTodoProjectWeight}
              formattedValue={todoWeightLabel}
              timestamp={todoWeightTimestamp}
              disabled={isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="initiationOptions"
              label="Initiation"
              rawValue={detailItem.issueTodoProjectInitiationOptions}
              formattedValue={todoInitiationLabel}
              timestamp={todoInitiationTimestamp}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
            <ProjectFieldEditor
              item={detailItem}
              field="startDate"
              label="Start"
              rawValue={detailItem.issueTodoProjectStartDate}
              formattedValue={todoStartDateLabel}
              timestamp={todoStartDateTimestamp}
              disabled={detailItem.issueProjectStatusLocked || isUpdatingStatus}
              isUpdating={isUpdatingProjectFields}
              onSubmit={onUpdateProjectField}
            />
          </div>
          {!detailItem.issueProjectStatusLocked &&
            detailItem.issueProjectStatusSource !== "activity" && (
              <p className="mt-2 text-muted-foreground/80">
                Activity 상태는 To-do 프로젝트가 No Status 또는 Todo일 때만
                적용돼요.
              </p>
            )}
        </div>
      )}
      <div className="rounded-md border border-border bg-background px-4 py-3 text-sm">
        {(() => {
          if (!renderedBody) {
            return (
              <div className="text-muted-foreground/80">내용이 없습니다.</div>
            );
          }
          if (!renderedContent) {
            return (
              <div className="text-muted-foreground/80">
                내용을 표시할 수 없습니다.
              </div>
            );
          }
          return (
            <div className="space-y-4 leading-relaxed [&_a]:text-slate-700 [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold [&_.user-mention]:text-sky-700">
              {renderedContent}
            </div>
          );
        })()}
        <ReactionSummaryList reactions={detail.reactions} className="mt-3" />
      </div>
      {orphanMentionWaits.length > 0 && (
        <div className="rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
          <h4 className="text-sm font-semibold text-foreground">
            응답 없는 멘션
          </h4>
          <div className="mt-2 space-y-3">
            {orphanMentionWaits.map((wait, index) => {
              const mentionUserId = wait.user?.id ?? wait.userId ?? "";
              const mentionHandle =
                wait.user?.name ??
                (wait.user?.login ? `@${wait.user.login}` : mentionUserId);
              const aiStatus =
                wait.requiresResponse === false
                  ? "AI 판단: 응답 요구 아님"
                  : wait.requiresResponse === true
                    ? "AI 판단: 응답 필요"
                    : "AI 판단: 정보 없음";
              const aiStatusClass =
                wait.requiresResponse === false
                  ? "text-amber-600"
                  : "text-muted-foreground/70";
              const manualState =
                wait.manualRequiresResponse === false
                  ? "suppress"
                  : wait.manualRequiresResponse === true
                    ? "force"
                    : null;
              const manualTimestamp = formatOptionalDateTime(
                wait.manualRequiresResponseAt,
              );
              const mentionKey = `${wait.id}::${mentionUserId}`;
              const pendingOverride = pendingMentionOverrideKey === mentionKey;

              return (
                <div
                  key={`${wait.id}-${mentionUserId || index}`}
                  className="rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 text-foreground">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">
                        대상: {mentionHandle || "알 수 없음"}
                      </span>
                      <span className="text-muted-foreground/70">
                        언급일:{" "}
                        {formatOptionalDateTime(wait.mentionedAt) ?? "-"}
                      </span>
                    </div>
                    <span className={cn("text-xs font-medium", aiStatusClass)}>
                      {aiStatus}
                    </span>
                  </div>
                  {wait.manualDecisionIsStale && (
                    <p className="mt-1 text-[11px] text-amber-600">
                      최근 분류 이후 관리자 설정이 다시 필요합니다.
                    </p>
                  )}
                  {manualTimestamp && !wait.manualDecisionIsStale && (
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      관리자 설정: {manualTimestamp}
                    </p>
                  )}
                  {canManageMentions &&
                  onUpdateMentionOverride &&
                  mentionUserId ? (
                    <div className="mt-2">
                      <MentionOverrideControls
                        value={manualState}
                        pending={pendingOverride}
                        onChange={(next) => {
                          onUpdateMentionOverride({
                            itemId: detailItem.id,
                            commentId: wait.id,
                            mentionedUserId: mentionUserId,
                            state: next,
                          });
                        }}
                      />
                    </div>
                  ) : null}
                  {!mentionUserId && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      멘션된 사용자를 확인할 수 없어 관리자 설정을 적용할 수
                      없습니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ActivityCommentSection
        comments={detail.comments}
        timezone={timezone}
        dateTimeFormat={dateTimeFormat}
        mentionControls={mentionControlsProps}
        commentContext={detailItem.type}
      />
      {detailItem.type === "issue" &&
      detailItem.linkedPullRequests.length > 0 ? (
        <div className="space-y-2 text-xs">
          <h4 className="font-semibold text-muted-foreground/85">연결된 PR</h4>
          <ul className="space-y-1">
            {detailItem.linkedPullRequests.map((linked) => {
              const summary = buildLinkedPullRequestSummary(linked);
              return (
                <li key={`follow-up-linked-pr-${linked.id}`}>
                  {linked.url ? (
                    <a
                      href={linked.url}
                      target="_blank"
                      rel="noreferrer"
                      className="reference-link"
                    >
                      {summary.label}
                    </a>
                  ) : (
                    <span>{summary.label}</span>
                  )}
                  {summary.status ? (
                    <span className="text-muted-foreground/70">
                      {` · ${summary.status}`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {detailItem.type === "pull_request" &&
      detailItem.linkedIssues.length > 0 ? (
        <div className="space-y-2 text-xs">
          <h4 className="font-semibold text-muted-foreground/85">
            연결된 이슈
          </h4>
          <ul className="space-y-1">
            {detailItem.linkedIssues.map((linked) => {
              const summary = buildLinkedIssueSummary(linked);
              return (
                <li key={`follow-up-linked-issue-${linked.id}`}>
                  {linked.url ? (
                    <a
                      href={linked.url}
                      target="_blank"
                      rel="noreferrer"
                      className="reference-link"
                    >
                      {summary.label}
                    </a>
                  ) : (
                    <span>{summary.label}</span>
                  )}
                  {summary.status ? (
                    <span className="text-muted-foreground/70">
                      {` · ${summary.status}`}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {(detail.parentIssues.length > 0 || detail.subIssues.length > 0) && (
        <div className="space-y-4 text-xs">
          {detail.parentIssues.length > 0 && (
            <div>
              <h4 className="font-semibold text-muted-foreground/85">
                상위 이슈
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.parentIssues.map((linked) => {
                  const referenceParts: string[] = [];
                  if (linked.repositoryNameWithOwner) {
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
                  const displayLabel = referenceLabel
                    ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                    : titleLabel;
                  return (
                    <li key={`parent-${linked.id}`}>
                      {linked.url ? (
                        <a
                          href={linked.url}
                          target="_blank"
                          rel="noreferrer"
                          className="reference-link"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {detail.subIssues.length > 0 && (
            <div>
              <h4 className="font-semibold text-muted-foreground/85">
                하위 이슈
              </h4>
              <ul className="mt-1 space-y-1">
                {detail.subIssues.map((linked) => {
                  const referenceParts: string[] = [];
                  if (linked.repositoryNameWithOwner) {
                    referenceParts.push(linked.repositoryNameWithOwner);
                  }
                  if (typeof linked.number === "number") {
                    referenceParts.push(`#${linked.number}`);
                  }
                  const referenceLabel =
                    referenceParts.length > 0 ? referenceParts.join("") : null;
                  const titleLabel = linked.title ?? linked.state ?? linked.id;
                  const displayLabel = referenceLabel
                    ? `${referenceLabel}${titleLabel ? ` — ${titleLabel}` : ""}`
                    : titleLabel;
                  return (
                    <li key={`sub-${linked.id}`}>
                      {linked.url ? (
                        <a
                          href={linked.url}
                          target="_blank"
                          rel="noreferrer"
                          className="reference-link"
                        >
                          {displayLabel ?? linked.id}
                        </a>
                      ) : (
                        <span>{displayLabel ?? linked.id}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankingCard({
  title,
  entries,
  valueFormatter,
  emptyText,
}: {
  title: string;
  entries: RankingEntry[];
  valueFormatter: (entry: RankingEntry) => string;
  emptyText: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-background p-3">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {entries.length ? (
        <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
          {entries.map((entry, index) => (
            <li
              key={entry.key}
              className="flex items-center justify-between gap-3"
            >
              <span>
                <span className="font-medium text-foreground">
                  {index + 1}.
                </span>{" "}
                {formatUser(entry.user)}
              </span>
              <span className="font-medium text-foreground">
                {valueFormatter(entry)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

function FollowUpOverview({
  summaries,
  onSelect,
}: {
  summaries: FollowUpSummary[];
  onSelect: (id: string) => void;
}) {
  const summaryMap = new Map(summaries.map((summary) => [summary.id, summary]));
  const orderedSummaries = FOLLOW_UP_SECTION_ORDER.map((summaryId) =>
    summaryMap.get(summaryId),
  ).filter((summary): summary is FollowUpSummary => Boolean(summary));
  const remainingSummaries = summaries.filter(
    (summary) => !FOLLOW_UP_SECTION_SET.has(summary.id),
  );
  const visibleSummaries =
    remainingSummaries.length === 0
      ? orderedSummaries
      : [...orderedSummaries, ...remainingSummaries];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {visibleSummaries.map((summary) => (
          <div
            key={summary.id}
            className="bg-white border border-slate-200 rounded-[14px] p-6"
            data-testid={`follow-up-summary-${summary.id}`}
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-foreground mb-1">
                  {summary.title}
                </h3>
                <p className="text-xs text-foreground/75">
                  {summary.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelect(summary.id)}
                className="flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-2 shrink-0"
              >
                바로 보기
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/70">항목 수</span>
                <span className="text-2xl font-bold text-foreground">
                  {formatCount(summary.count)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/70">
                  누적 경과일수
                </span>
                <span className="text-2xl font-bold text-foreground">
                  {formatDays(summary.totalMetric)}
                </span>
              </div>
            </div>

            {summary.highlights.length ? (
              <div className="border-t border-slate-200 pt-3 mt-3">
                <div className="space-y-1">
                  {summary.highlights.map((line) => (
                    <p
                      key={`${summary.id}-${line}`}
                      className="text-xs text-foreground/80"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PullRequestList({
  items,
  emptyText,
  showUpdated,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  attentionOverride,
  primaryUserRole = "author",
  secondaryUserRole = "reviewer",
  reviewWaitMap,
  mentionWaitMap,
  attentionFlagMap,
  repositoryMaintainersByRepository = {},
  timezone,
  dateTimeFormat,
  segmented = false,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: PullRequestAttentionItem[];
  emptyText: string;
  showUpdated?: boolean;
  metricKey?: "ageDays" | "inactivityDays" | "waitingDays";
  metricLabel?: string;
  attentionOverride?: Partial<ActivityItem["attention"]>;
  primaryUserRole?: "author" | "reviewer" | "assignee" | "repositoryMaintainer";
  secondaryUserRole?:
    | "author"
    | "reviewer"
    | "assignee"
    | "repositoryMaintainer";
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  repositoryMaintainersByRepository?: Record<string, UserReference[]>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [secondaryFilter, setSecondaryFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const roleLabelMap: Record<
    NonNullable<typeof primaryUserRole>,
    "작성자" | "리뷰어" | "담당자" | "저장소 책임자"
  > = {
    author: "작성자",
    reviewer: "리뷰어",
    assignee: "담당자",
    repositoryMaintainer: "저장소 책임자",
  };

  const resolveUsersForRole = useCallback(
    (
      item: PullRequestAttentionItem,
      role: NonNullable<typeof primaryUserRole>,
    ) => {
      if (role === "author") {
        return item.author ? [item.author] : [];
      }
      if (role === "reviewer") {
        return item.reviewers ?? [];
      }
      if (role === "assignee") {
        return item.assignees ?? [];
      }
      const repoId = item.repository?.id;
      if (!repoId) {
        return [];
      }
      return repositoryMaintainersByRepository[repoId] ?? [];
    },
    [repositoryMaintainersByRepository],
  );

  const aggregation = useMemo(() => {
    const primaryMap = new Map<string, RankingEntry>();
    const secondaryMap = new Map<string, RankingEntry>();

    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : metricKey === "waitingDays"
          ? (item.waitingDays ?? item.ageDays ?? 0)
          : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      resolveUsersForRole(item, primaryUserRole).forEach((user) => {
        const entry = primaryMap.get(user.id) ?? {
          key: user.id,
          user,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        primaryMap.set(user.id, entry);
      });

      resolveUsersForRole(item, secondaryUserRole).forEach((user) => {
        const entry = secondaryMap.get(user.id) ?? {
          key: user.id,
          user,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        secondaryMap.set(user.id, entry);
      });
    });

    return {
      primary: Array.from(primaryMap.values()),
      secondary: Array.from(secondaryMap.values()),
    };
  }, [
    items,
    metricKey,
    primaryUserRole,
    resolveUsersForRole,
    secondaryUserRole,
  ]);

  const primaryOptions = useMemo(() => {
    return aggregation.primary
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.primary]);

  const secondaryOptions = useMemo(() => {
    return aggregation.secondary
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.secondary]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const primaryUsers = resolveUsersForRole(item, primaryUserRole);
      const secondaryUsers = resolveUsersForRole(item, secondaryUserRole);

      const primaryMatch =
        primaryFilter === "all" ||
        primaryUsers.some((user) => user.id === primaryFilter);

      const secondaryMatch =
        secondaryFilter === "all" ||
        secondaryUsers.some((user) => user.id === secondaryFilter);

      return primaryMatch && secondaryMatch;
    });
  }, [
    items,
    primaryFilter,
    primaryUserRole,
    resolveUsersForRole,
    secondaryFilter,
    secondaryUserRole,
  ]);

  const sortedItems = useMemo(() => {
    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : metricKey === "waitingDays"
          ? (item.waitingDays ?? item.ageDays ?? 0)
          : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => getMetric(b) - getMetric(a));
  }, [filteredItems, metricKey]);

  const primaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.primary);
  }, [aggregation.primary]);

  const primaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.primary);
  }, [aggregation.primary]);

  const secondaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.secondary);
  }, [aggregation.secondary]);

  const secondaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.secondary);
  }, [aggregation.secondary]);

  const primaryRoleLabel = roleLabelMap[primaryUserRole];
  const secondaryRoleLabel = roleLabelMap[secondaryUserRole];

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`${primaryRoleLabel} ${metricLabel} 합계 순위`}
        entries={primaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${primaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${primaryRoleLabel} 건수 순위`}
        entries={primaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${primaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${secondaryRoleLabel} ${metricLabel} 합계 순위`}
        entries={secondaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${secondaryRoleLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${secondaryRoleLabel} 건수 순위`}
        entries={secondaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${secondaryRoleLabel} 데이터가 없습니다.`}
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {primaryRoleLabel} 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={primaryFilter}
          onChange={(event) => setPrimaryFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {primaryOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {secondaryRoleLabel} 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={secondaryFilter}
          onChange={(event) => setSecondaryFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {secondaryOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map((item) => {
        const attentionFlags = attentionOverride ?? {};
        const activityItem = createBaseActivityItem({
          id: item.id,
          type: "pull_request",
          number: item.number,
          title: item.title,
          url: item.url,
          repository: item.repository,
          author: item.author,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          attention: attentionFlags,
        });
        activityItem.reviewers = toActivityUsers(item.reviewers);
        activityItem.businessDaysOpen =
          metricKey === "waitingDays"
            ? (item.waitingDays ?? item.ageDays ?? null)
            : (item.ageDays ?? null);
        if (metricKey === "inactivityDays" || showUpdated) {
          activityItem.businessDaysIdle = item.inactivityDays ?? null;
        }
        activityItem.linkedIssues = item.linkedIssues ?? [];
        applyAttentionFlagsFromMap(attentionFlagMap, activityItem, item.id);
        const reviewWaitDetails = reviewWaitMap.get(item.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }
        const linkedPullRequestsInline =
          activityItem.linkedPullRequests.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 PR",
                type: "pull_request",
                entries: activityItem.linkedPullRequests.map((pr) =>
                  buildLinkedPullRequestSummary(pr),
                ),
                maxItems: 2,
              })
            : null;

        const detail = detailMap[item.id] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const displayItem = overlayItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = buildAttentionBadges(displayItem, {
          useMentionAi: true,
        });
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone, dateTimeFormat)
          : "-";
        const linkedIssuesInline =
          activityItem.linkedIssues.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 이슈",
                type: "issue",
                entries: activityItem.linkedIssues.map((issue) =>
                  buildLinkedIssueSummary(issue),
                ),
                maxItems: 2,
              })
            : null;
        const referenceLine =
          linkedPullRequestsInline || linkedIssuesInline ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {linkedPullRequestsInline}
              {linkedIssuesInline}
            </div>
          ) : null;
        const metadata = (
          <div className="flex flex-col gap-1 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.author && (
                <span>작성자 {formatUserCompact(item.author)}</span>
              )}
              {item.reviewers.length > 0 && (
                <span>리뷰어 {formatUserListCompact(item.reviewers)}</span>
              )}
              {renderAttentionBadgeElements(badges, item.id)}
              {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                <span
                  key={label.key}
                  className="rounded-md bg-muted px-2 py-0.5"
                >
                  {label.name ?? label.key}
                </span>
              ))}
            </div>
            {referenceLine}
          </div>
        );

        return (
          <li key={item.id}>
            <div
              className={cn(
                "group rounded-md border bg-background p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                isSelected
                  ? "border-primary/60 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
              )}
            >
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "text-primary"
                    : "text-foreground group-hover:text-primary",
                )}
                onClick={() => selectItem(item.id)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.url ?? undefined}
                    title={item.title}
                    metadata={metadata}
                  />
                  {item.updatedAt ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                      {updatedRelativeLabel ? (
                        <span className="font-medium text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span title={timezoneTitle}>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={overlayItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  timezone={timezone}
                  dateTimeFormat={dateTimeFormat}
                  onClose={closeItem}
                  onResync={
                    typeof onResyncItem === "function"
                      ? () => onResyncItem(overlayItem.id)
                      : undefined
                  }
                  isResyncing={resyncingIds?.has(overlayItem.id) ?? false}
                  resyncDisabled={resyncDisabled}
                  resyncDisabledReason={
                    resyncDisabled ? resyncDisabledReason : null
                  }
                >
                  <FollowUpDetailContent
                    item={overlayItem}
                    detail={detail}
                    isLoading={isDetailLoading}
                    timezone={timezone}
                    dateTimeFormat={dateTimeFormat}
                    isUpdatingStatus={false}
                    isUpdatingProjectFields={false}
                    onUpdateStatus={() => {
                      /* no-op for pull requests */
                    }}
                    onUpdateProjectField={async () => false}
                  />
                </ActivityDetailOverlay>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyText}</p>
  );

  if (segmented) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {rankingGrid}
        </section>
        <section className="space-y-4 rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {filterControls}
          {listContent}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {rankingGrid}
        {filterControls}
      </div>
      {listContent}
    </div>
  );
}

function ReviewRequestList({
  items,
  emptyText,
  reviewWaitMap,
  mentionWaitMap,
  attentionFlagMap,
  timezone,
  dateTimeFormat,
  segmented = false,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: ReviewRequestAttentionItem[];
  emptyText: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  type AggregatedReviewRequest = {
    selectionId: string;
    representative: ReviewRequestAttentionItem;
    reviewRequests: ReviewRequestAttentionItem[];
  };

  const aggregatedItems = useMemo<AggregatedReviewRequest[]>(() => {
    const map = new Map<
      string,
      {
        representative: ReviewRequestAttentionItem;
        reviewRequests: ReviewRequestAttentionItem[];
      }
    >();

    items.forEach((item) => {
      const pullRequestId = (item.pullRequest.id ?? "").trim();
      const key = pullRequestId.length ? pullRequestId : item.id;
      const existing = map.get(key);
      if (existing) {
        existing.reviewRequests.push(item);
        if (item.waitingDays > existing.representative.waitingDays) {
          existing.representative = item;
        }
      } else {
        map.set(key, {
          representative: item,
          reviewRequests: [item],
        });
      }
    });

    return Array.from(map.entries()).map(([selectionId, value]) => ({
      selectionId,
      representative: value.representative,
      reviewRequests: value.reviewRequests,
    }));
  }, [items]);

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    aggregatedItems.forEach(({ representative, reviewRequests }) => {
      const metricValue = representative.waitingDays;

      const author = representative.pullRequest.author;
      if (author) {
        const authorEntry = authorMap.get(author.id) ?? {
          key: author.id,
          user: author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(author.id, authorEntry);
      }

      reviewRequests.forEach((request) => {
        const reviewer = request.reviewer;
        if (!reviewer) {
          return;
        }
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += request.waitingDays;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      });
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [aggregatedItems]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const reviewerOptions = useMemo(() => {
    return aggregation.reviewers
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.reviewers]);

  const filteredItems = useMemo(() => {
    return aggregatedItems.filter(({ representative, reviewRequests }) => {
      const authorMatch =
        authorFilter === "all" ||
        representative.pullRequest.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" ||
        reviewRequests.some(
          (request) => request.reviewer?.id === reviewerFilter,
        );

      return authorMatch && reviewerMatch;
    });
  }, [aggregatedItems, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems
      .slice()
      .sort(
        (a, b) => b.representative.waitingDays - a.representative.waitingDays,
      );
  }, [filteredItems]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const reviewerRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.reviewers);
  }, [aggregation.reviewers]);

  const reviewerRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.reviewers);
  }, [aggregation.reviewers]);

  const hasReviewerFilter = reviewerOptions.length > 0;
  const metricLabel = "대기일수";

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`작성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="작성자 데이터가 없습니다."
      />
      <RankingCard
        title="작성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="작성자 데이터가 없습니다."
      />
      <RankingCard
        title={`리뷰어 ${metricLabel} 합계 순위`}
        entries={reviewerRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="리뷰어 데이터가 없습니다."
      />
      <RankingCard
        title="리뷰어 건수 순위"
        entries={reviewerRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="리뷰어 데이터가 없습니다."
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        작성자 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {authorOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {hasReviewerFilter ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          리뷰어 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reviewerFilter}
            onChange={(event) => setReviewerFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {reviewerOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map(
        ({ selectionId, representative: item, reviewRequests }) => {
          const pullRequest = item.pullRequest;
          const pullRequestId = (pullRequest.id ?? "").trim();
          const resolvedSelectionId = pullRequestId.length
            ? pullRequestId
            : selectionId;
          const activityItem = createBaseActivityItem({
            id: resolvedSelectionId,
            type: "pull_request",
            number: pullRequest.number,
            title: pullRequest.title,
            url: pullRequest.url,
            repository: pullRequest.repository,
            author: pullRequest.author,
            attention: { reviewRequestPending: true },
          });
          activityItem.reviewers = toActivityUsers(pullRequest.reviewers);
          activityItem.businessDaysOpen = item.pullRequestAgeDays ?? null;
          activityItem.businessDaysIdle =
            item.pullRequestInactivityDays ?? item.waitingDays ?? null;
          activityItem.linkedIssues = pullRequest.linkedIssues ?? [];
          applyAttentionFlagsFromMap(
            attentionFlagMap,
            activityItem,
            pullRequestId || resolvedSelectionId,
            item.id,
          );
          const reviewWaitDetails =
            (pullRequestId.length
              ? reviewWaitMap.get(pullRequestId)
              : undefined) ?? reviewRequests;
          if (reviewWaitDetails.length) {
            activityItem.reviewRequestWaits =
              toActivityReviewWaits(reviewWaitDetails);
          }
          const mentionDetails =
            (pullRequestId.length
              ? mentionWaitMap.get(pullRequestId)
              : undefined) ?? [];
          if (mentionDetails.length) {
            activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
          }

          const detail = detailMap[resolvedSelectionId] ?? undefined;
          const overlayItem = detail?.item ?? activityItem;
          const displayItem = overlayItem;
          const iconInfo = resolveActivityIcon(overlayItem);
          const referenceLabel = buildReferenceLabel(
            pullRequest.repository,
            pullRequest.number,
          );
          const isSelected = openItemId === resolvedSelectionId;
          const isDetailLoading = loadingDetailIds.has(resolvedSelectionId);
          const badges = buildAttentionBadges(displayItem, {
            useMentionAi: true,
          });
          const metrics = buildActivityMetricEntries(activityItem);
          const linkedIssuesInline =
            activityItem.linkedIssues.length > 0
              ? renderLinkedReferenceInline({
                  label: "연결된 이슈",
                  type: "issue",
                  entries: activityItem.linkedIssues.map((issue) =>
                    buildLinkedIssueSummary(issue),
                  ),
                  maxItems: 2,
                })
              : null;
          const updatedRelativeLabel = item.pullRequestUpdatedAt
            ? formatRelative(item.pullRequestUpdatedAt)
            : null;
          const updatedAbsoluteLabel = item.pullRequestUpdatedAt
            ? formatTimestamp(
                item.pullRequestUpdatedAt,
                timezone,
                dateTimeFormat,
              )
            : "-";
          const referenceLine = linkedIssuesInline ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {linkedIssuesInline}
            </div>
          ) : null;
          const metadata = (
            <div className="flex flex-col gap-1 text-xs text-foreground/90">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {metrics.map((metric) => (
                  <span key={metric.key}>{metric.content}</span>
                ))}
                {pullRequest.author && (
                  <span>작성자 {formatUserCompact(pullRequest.author)}</span>
                )}
                {renderAttentionBadgeElements(badges, resolvedSelectionId)}
                {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                  <span
                    key={label.key}
                    className="rounded-md bg-muted px-2 py-0.5"
                  >
                    {label.name ?? label.key}
                  </span>
                ))}
              </div>
              {referenceLine}
            </div>
          );

          return (
            <li key={resolvedSelectionId}>
              <div
                className={cn(
                  "group rounded-md border bg-background p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                  isSelected
                    ? "border-primary/60 shadow-md shadow-primary/10"
                    : "border-border hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
                )}
              >
                <button
                  type="button"
                  aria-expanded={isSelected}
                  className={cn(
                    "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isSelected
                      ? "text-primary"
                      : "text-foreground group-hover:text-primary",
                  )}
                  onClick={() => selectItem(resolvedSelectionId)}
                >
                  <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                    <ActivityListItemSummary
                      iconInfo={iconInfo}
                      referenceLabel={referenceLabel}
                      referenceUrl={pullRequest.url ?? undefined}
                      title={pullRequest.title}
                      metadata={metadata}
                    />
                    {item.pullRequestUpdatedAt ? (
                      <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                        {updatedRelativeLabel ? (
                          <span className="font-medium text-foreground">
                            {updatedRelativeLabel}
                          </span>
                        ) : null}
                        <span title={timezoneTitle}>
                          {updatedAbsoluteLabel}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </button>
                {isSelected ? (
                  <ActivityDetailOverlay
                    item={overlayItem}
                    iconInfo={iconInfo}
                    badges={badges}
                    timezone={timezone}
                    dateTimeFormat={dateTimeFormat}
                    onClose={closeItem}
                    onResync={
                      typeof onResyncItem === "function"
                        ? () => onResyncItem(overlayItem.id)
                        : undefined
                    }
                    isResyncing={resyncingIds?.has(overlayItem.id) ?? false}
                    resyncDisabled={resyncDisabled}
                    resyncDisabledReason={
                      resyncDisabled ? resyncDisabledReason : null
                    }
                  >
                    <FollowUpDetailContent
                      item={overlayItem}
                      detail={detail}
                      isLoading={isDetailLoading}
                      timezone={timezone}
                      dateTimeFormat={dateTimeFormat}
                      isUpdatingStatus={false}
                      isUpdatingProjectFields={false}
                      onUpdateStatus={() => {
                        /* no-op for review requests */
                      }}
                      onUpdateProjectField={async () => false}
                    />
                  </ActivityDetailOverlay>
                ) : null}
              </div>
            </li>
          );
        },
      )}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyText}</p>
  );

  if (segmented) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {rankingGrid}
        </section>
        <section className="space-y-4 rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {filterControls}
          {listContent}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {rankingGrid}
        {filterControls}
      </div>
      {listContent}
    </div>
  );
}

function IssueList({
  items,
  emptyText,
  highlightInProgress,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  primaryUserRole = "author",
  showMaintainerControls = false,
  maintainerOptionsOverride,
  repositoryMaintainersByRepository = {},
  mentionWaitMap,
  attentionFlagMap,
  timezone,
  dateTimeFormat,
  segmented = false,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
  metricKey?: "ageDays" | "inProgressAgeDays";
  metricLabel?: string;
  primaryUserRole?: "author" | "repositoryMaintainer";
  showMaintainerControls?: boolean;
  maintainerOptionsOverride?: UserReference[];
  repositoryMaintainersByRepository?: Record<string, UserReference[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [primaryFilter, setPrimaryFilter] = useState("all");
  const [maintainerFilter, setMaintainerFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingProjectFieldIds, setUpdatingProjectFieldIds] = useState<
    Set<string>
  >(() => new Set<string>());
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const primaryLabel =
    primaryUserRole === "repositoryMaintainer" ? "저장소 책임자" : "작성자";
  const resolveItemMaintainers = useCallback(
    (item: IssueAttentionItem) => {
      if (item.repositoryMaintainers?.length) {
        return item.repositoryMaintainers;
      }
      const repoId = item.repository?.id;
      if (repoId) {
        const fallback = repositoryMaintainersByRepository[repoId];
        if (fallback?.length) {
          return fallback;
        }
      }
      return [];
    },
    [repositoryMaintainersByRepository],
  );
  const resolvePrimaryUser = useCallback(
    (item: IssueAttentionItem) =>
      primaryUserRole === "repositoryMaintainer"
        ? (item.repositoryMaintainers ?? [])
        : item.author
          ? [item.author]
          : [],
    [primaryUserRole],
  );

  const aggregation = useMemo(() => {
    const primaryMap = new Map<string, RankingEntry>();
    const maintainerMap = new Map<string, RankingEntry>();
    const assigneeMap = new Map<string, RankingEntry>();

    const getMetric = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);
      const primaryUsers = resolvePrimaryUser(item);

      primaryUsers.forEach((primaryUser) => {
        const entry = primaryMap.get(primaryUser.id) ?? {
          key: primaryUser.id,
          user: primaryUser,
          total: 0,
          count: 0,
        };
        entry.total += metricValue;
        entry.count += 1;
        primaryMap.set(primaryUser.id, entry);
      });

      if (showMaintainerControls) {
        const maintainers = resolveItemMaintainers(item);
        maintainers.forEach((maintainer) => {
          const entry = maintainerMap.get(maintainer.id) ?? {
            key: maintainer.id,
            user: maintainer,
            total: 0,
            count: 0,
          };
          entry.total += metricValue;
          entry.count += 1;
          maintainerMap.set(maintainer.id, entry);
        });
      }

      item.assignees.forEach((assignee) => {
        const assigneeEntry = assigneeMap.get(assignee.id) ?? {
          key: assignee.id,
          user: assignee,
          total: 0,
          count: 0,
        };
        assigneeEntry.total += metricValue;
        assigneeEntry.count += 1;
        assigneeMap.set(assignee.id, assigneeEntry);
      });
    });

    return {
      primary: Array.from(primaryMap.values()),
      maintainers: Array.from(maintainerMap.values()),
      assignees: Array.from(assigneeMap.values()),
    };
  }, [
    items,
    metricKey,
    resolveItemMaintainers,
    resolvePrimaryUser,
    showMaintainerControls,
  ]);

  const primaryOptions = useMemo(() => {
    return aggregation.primary
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.primary]);

  const maintainerOptions = useMemo(() => {
    if (
      Array.isArray(maintainerOptionsOverride) &&
      maintainerOptionsOverride.length
    ) {
      return maintainerOptionsOverride
        .map((user) => ({ key: user.id, label: formatUser(user) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return aggregation.maintainers
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.maintainers, maintainerOptionsOverride]);

  const assigneeOptions = useMemo(() => {
    return aggregation.assignees
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.assignees]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const primaryUsers = resolvePrimaryUser(item);
      const primaryMatch =
        primaryFilter === "all" ||
        primaryUsers.some((primaryUser) => primaryUser.id === primaryFilter);

      const maintainerMatch =
        !showMaintainerControls ||
        maintainerFilter === "all" ||
        resolveItemMaintainers(item).some(
          (maintainer) => maintainer.id === maintainerFilter,
        );

      const assigneeMatch =
        assigneeFilter === "all" ||
        item.assignees.some((assignee) => assignee.id === assigneeFilter);

      return primaryMatch && maintainerMatch && assigneeMatch;
    });
  }, [
    items,
    assigneeFilter,
    maintainerFilter,
    primaryFilter,
    resolveItemMaintainers,
    resolvePrimaryUser,
    showMaintainerControls,
  ]);

  const sortedItems = useMemo(() => {
    const metricFor = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => metricFor(b) - metricFor(a));
  }, [filteredItems, metricKey]);

  const primaryRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.primary);
  }, [aggregation.primary]);

  const primaryRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.primary);
  }, [aggregation.primary]);

  const maintainerRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.maintainers);
  }, [aggregation.maintainers]);

  const maintainerRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.maintainers);
  }, [aggregation.maintainers]);

  const assigneeRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.assignees);
  }, [aggregation.assignees]);

  const assigneeRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.assignees);
  }, [aggregation.assignees]);

  const maintainerFilterEnabled = showMaintainerControls;
  const hasAssigneeFilter = assigneeOptions.length > 0;

  useEffect(() => {
    setPrimaryFilter("all");
  }, []);
  useEffect(() => {
    if (showMaintainerControls) {
      setMaintainerFilter("all");
      return;
    }
    setMaintainerFilter("all");
  }, [showMaintainerControls]);

  const {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
    updateDetailItem,
  } = useActivityDetailState();

  const handleUpdateIssueStatus = useCallback(
    async (activityItem: ActivityItem, nextStatus: IssueProjectStatus) => {
      if (activityItem.type !== "issue") {
        return;
      }

      const currentStatus = activityItem.issueProjectStatus ?? "no_status";
      if (currentStatus === nextStatus && nextStatus !== "no_status") {
        return;
      }

      setUpdatingStatusIds((current) => {
        if (current.has(activityItem.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(activityItem.id);
        return next;
      });

      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(activityItem.id)}/status`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              status: nextStatus,
              expectedStatus: currentStatus,
            }),
          },
        );

        let payload:
          | {
              item?: ActivityItem;
              error?: string;
              todoStatus?: IssueProjectStatus;
            }
          | undefined;

        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          payload = undefined;
        }

        if (!response.ok) {
          if (payload?.item) {
            updateDetailItem(payload.item);
          }
          if (payload?.error) {
            console.warn(payload.error);
          }
          return;
        }

        const updatedItem = payload?.item ?? activityItem;
        updateDetailItem(updatedItem);
        const label =
          ISSUE_STATUS_LABEL_MAP.get(
            updatedItem.issueProjectStatus ?? "no_status",
          ) ?? "No Status";
        console.info(`상태를 ${label}로 업데이트했어요.`);
      } catch (error) {
        console.error("Failed to update issue status", error);
      } finally {
        setUpdatingStatusIds((current) => {
          if (!current.has(activityItem.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activityItem.id);
          return next;
        });
      }
    },
    [updateDetailItem],
  );

  const handleUpdateProjectField = useCallback(
    async (
      activityItem: ActivityItem,
      field: ProjectFieldKey,
      nextValue: string | null,
    ) => {
      if (activityItem.type !== "issue") {
        return false;
      }

      const currentValue = (() => {
        switch (field) {
          case "priority":
            return activityItem.issueTodoProjectPriority;
          case "weight":
            return activityItem.issueTodoProjectWeight;
          case "initiationOptions":
            return activityItem.issueTodoProjectInitiationOptions;
          case "startDate":
            return activityItem.issueTodoProjectStartDate;
          default:
            return null;
        }
      })();
      const currentUpdatedAt = (() => {
        switch (field) {
          case "priority":
            return activityItem.issueTodoProjectPriorityUpdatedAt;
          case "weight":
            return activityItem.issueTodoProjectWeightUpdatedAt;
          case "initiationOptions":
            return activityItem.issueTodoProjectInitiationOptionsUpdatedAt;
          case "startDate":
            return activityItem.issueTodoProjectStartDateUpdatedAt;
          default:
            return null;
        }
      })();

      const normalizedCurrent = normalizeProjectFieldForComparison(
        field,
        currentValue,
      );
      const normalizedNext = normalizeProjectFieldForComparison(
        field,
        nextValue,
      );

      if (normalizedCurrent === normalizedNext) {
        return true;
      }

      setUpdatingProjectFieldIds((current) => {
        if (current.has(activityItem.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(activityItem.id);
        return next;
      });

      try {
        const payload = {
          [field]: nextValue,
          expected: {
            [field]: {
              value: currentValue,
              updatedAt: currentUpdatedAt,
            },
          },
        } as Record<string, unknown>;

        const response = await fetch(
          `/api/activity/${encodeURIComponent(activityItem.id)}/project-fields`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        let payloadResponse:
          | {
              item?: ActivityItem;
              error?: string;
              todoStatus?: IssueProjectStatus;
            }
          | undefined;
        try {
          payloadResponse = (await response.json()) as typeof payloadResponse;
        } catch {
          payloadResponse = undefined;
        }

        if (!response.ok) {
          if (payloadResponse?.item) {
            updateDetailItem(payloadResponse.item);
          }
          if (payloadResponse?.error) {
            console.warn(payloadResponse.error);
          }
          return false;
        }

        const updatedItem = payloadResponse?.item ?? activityItem;
        updateDetailItem(updatedItem);
        const label = PROJECT_FIELD_LABELS[field];
        console.info(`${label} 값을 업데이트했어요.`);
        return true;
      } catch (error) {
        console.error("Failed to update project field", error);
        return false;
      } finally {
        setUpdatingProjectFieldIds((current) => {
          if (!current.has(activityItem.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activityItem.id);
          return next;
        });
      }
    },
    [updateDetailItem],
  );

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`담당자 ${metricLabel} 합계 순위`}
        entries={assigneeRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="담당자 데이터가 없습니다."
      />
      <RankingCard
        title="담당자 건수 순위"
        entries={assigneeRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="담당자 데이터가 없습니다."
      />
      {showMaintainerControls ? (
        <>
          <RankingCard
            title={`저장소 책임자 ${metricLabel} 합계 순위`}
            entries={maintainerRankingByTotal}
            valueFormatter={(entry) => formatDays(entry.total)}
            emptyText="저장소 책임자 데이터가 없습니다."
          />
          <RankingCard
            title="저장소 책임자 건수 순위"
            entries={maintainerRankingByCount}
            valueFormatter={(entry) => formatCount(entry.count)}
            emptyText="저장소 책임자 데이터가 없습니다."
          />
        </>
      ) : null}
      <RankingCard
        title={`${primaryLabel} ${metricLabel} 합계 순위`}
        entries={primaryRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText={`${primaryLabel} 데이터가 없습니다.`}
      />
      <RankingCard
        title={`${primaryLabel} 건수 순위`}
        entries={primaryRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText={`${primaryLabel} 데이터가 없습니다.`}
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      {hasAssigneeFilter ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          담당자 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {assigneeOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {maintainerFilterEnabled ? (
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground min-w-[220px]">
          저장소 책임자 필터
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={maintainerFilter}
            onChange={(event) => setMaintainerFilter(event.target.value)}
          >
            <option value="all">미적용</option>
            {maintainerOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        {primaryLabel} 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={primaryFilter}
          onChange={(event) => setPrimaryFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {primaryOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map((item) => {
        const attentionFlags = highlightInProgress
          ? { stalledIssue: true }
          : { backlogIssue: true };
        const activityItem = createBaseActivityItem({
          id: item.id,
          type: "issue",
          number: item.number,
          title: item.title,
          url: item.url,
          repository: item.repository,
          author: item.author,
          attention: attentionFlags,
        });
        activityItem.issueType = item.issueType ?? null;
        activityItem.milestone = item.milestone ?? null;
        activityItem.assignees = toActivityUsers(item.assignees);
        activityItem.linkedPullRequests = item.linkedPullRequests ?? [];
        activityItem.labels = item.labels ?? [];
        activityItem.businessDaysOpen = item.ageDays ?? null;
        activityItem.businessDaysIdle = item.inactivityDays ?? null;
        if (item.inProgressAgeDays !== undefined) {
          activityItem.businessDaysSinceInProgress =
            item.inProgressAgeDays ?? null;
          activityItem.businessDaysInProgressOpen =
            item.inProgressAgeDays ?? null;
        }
        if (item.issueTodoProjectStatus) {
          activityItem.issueTodoProjectStatus = item.issueTodoProjectStatus;
          activityItem.issueProjectStatus =
            item.issueProjectStatus ?? item.issueTodoProjectStatus;
          activityItem.issueProjectStatusSource =
            item.issueProjectStatusSource ?? "todo_project";
          activityItem.issueProjectStatusLocked =
            item.issueProjectStatusLocked ??
            (item.issueTodoProjectStatus === "in_progress" ||
              item.issueTodoProjectStatus === "done" ||
              item.issueTodoProjectStatus === "pending");
        } else {
          activityItem.issueProjectStatus = item.issueProjectStatus ?? null;
          activityItem.issueProjectStatusSource =
            item.issueProjectStatusSource ?? "none";
          activityItem.issueProjectStatusLocked =
            item.issueProjectStatusLocked ?? false;
        }
        activityItem.issueTodoProjectPriority =
          item.issueTodoProjectPriority ?? null;
        activityItem.issueTodoProjectWeight =
          item.issueTodoProjectWeight ?? null;
        activityItem.issueTodoProjectInitiationOptions =
          item.issueTodoProjectInitiationOptions ?? null;
        activityItem.issueTodoProjectStartDate =
          item.issueTodoProjectStartDate ?? null;
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }
        applyAttentionFlagsFromMap(attentionFlagMap, activityItem, item.id);

        const detail = detailMap[item.id] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const displayItem = overlayItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = buildAttentionBadges(displayItem, {
          useMentionAi: true,
        });
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone, dateTimeFormat)
          : "-";
        const linkedPullRequestsInline =
          displayItem.linkedPullRequests.length > 0
            ? renderLinkedReferenceInline({
                label: "연결된 PR",
                type: "pull_request",
                entries: displayItem.linkedPullRequests.map((pr) =>
                  buildLinkedPullRequestSummary(pr),
                ),
                maxItems: 2,
              })
            : null;
        const displayStatusValue =
          displayItem.issueProjectStatus ?? "no_status";
        const displayStatusLabel =
          displayStatusValue !== "no_status"
            ? (ISSUE_STATUS_LABEL_MAP.get(displayStatusValue) ??
              displayStatusValue)
            : null;
        const todoPriorityLabel = formatProjectField(
          displayItem.issueTodoProjectPriority,
        );
        const issueWeightLabel = formatProjectField(
          displayItem.issueTodoProjectWeight,
        );
        const referenceLine = linkedPullRequestsInline ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {linkedPullRequestsInline}
          </div>
        ) : null;
        const overlayBadgeExtras =
          displayItem.type === "issue" ? (
            <>
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {issueWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {issueWeightLabel}
                </span>
              ) : null}
            </>
          ) : null;
        const metadata = (
          <div className="flex flex-col gap-1 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.author && (
                <span>작성자 {formatUserCompact(item.author)}</span>
              )}
              {item.assignees.length > 0 && (
                <span>담당자 {formatUserListCompact(item.assignees)}</span>
              )}
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {displayItem.type === "issue" && displayStatusLabel ? (
                <span className={PROJECT_FIELD_BADGE_CLASS}>
                  {displayStatusLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && issueWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {issueWeightLabel}
                </span>
              ) : null}
              {renderAttentionBadgeElements(badges, item.id)}
              {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                <span
                  key={label.key}
                  className="rounded-md bg-muted px-2 py-0.5"
                >
                  {label.name ?? label.key}
                </span>
              ))}
            </div>
            {referenceLine}
          </div>
        );

        return (
          <li key={item.id}>
            <div
              className={cn(
                "group rounded-md border bg-background p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                isSelected
                  ? "border-primary/60 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
              )}
            >
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "text-primary"
                    : "text-foreground group-hover:text-primary",
                )}
                onClick={() => selectItem(item.id)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.url ?? undefined}
                    title={item.title}
                    metadata={metadata}
                  />
                  {item.updatedAt ? (
                    <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                      {updatedRelativeLabel ? (
                        <span className="font-medium text-foreground">
                          {updatedRelativeLabel}
                        </span>
                      ) : null}
                      <span title={timezoneTitle}>{updatedAbsoluteLabel}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={overlayItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  badgeExtras={overlayBadgeExtras}
                  timezone={timezone}
                  dateTimeFormat={dateTimeFormat}
                  onClose={closeItem}
                  onResync={
                    typeof onResyncItem === "function"
                      ? () => onResyncItem(overlayItem.id)
                      : undefined
                  }
                  isResyncing={resyncingIds?.has(overlayItem.id) ?? false}
                  resyncDisabled={resyncDisabled}
                  resyncDisabledReason={
                    resyncDisabled ? resyncDisabledReason : null
                  }
                >
                  <FollowUpDetailContent
                    item={overlayItem}
                    detail={detail}
                    isLoading={isDetailLoading}
                    timezone={timezone}
                    dateTimeFormat={dateTimeFormat}
                    isUpdatingStatus={updatingStatusIds.has(item.id)}
                    isUpdatingProjectFields={updatingProjectFieldIds.has(
                      item.id,
                    )}
                    onUpdateStatus={handleUpdateIssueStatus}
                    onUpdateProjectField={handleUpdateProjectField}
                  />
                </ActivityDetailOverlay>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyText}</p>
  );

  if (segmented) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {rankingGrid}
        </section>
        <section className="space-y-4 rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {filterControls}
          {listContent}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {rankingGrid}
        {filterControls}
      </div>
      {listContent}
    </div>
  );
}

function MentionList({
  items,
  emptyText,
  timezone,
  dateTimeFormat,
  segmented = false,
  isAdmin,
  pendingOverrideKey,
  setPendingOverrideKey,
  onOverrideSuccess,
  mentionWaitMap,
  attentionFlagMap,
  issueProjectInfoMap,
  onResyncItem,
  resyncingIds,
  resyncDisabled = false,
  resyncDisabledReason = null,
}: {
  items: MentionAttentionItem[];
  emptyText: string;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
  isAdmin: boolean;
  pendingOverrideKey: string | null;
  setPendingOverrideKey: (key: string | null) => void;
  onOverrideSuccess: (params: {
    commentId: string;
    mentionedUserId: string;
    suppress: boolean;
    classification: {
      manualRequiresResponse: boolean | null;
      manualRequiresResponseAt: string | null;
      manualDecisionIsStale: boolean;
      requiresResponse: boolean | null;
      lastEvaluatedAt: string | null;
    };
  }) => void;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  attentionFlagMap: Map<string, Partial<ActivityItem["attention"]>>;
  issueProjectInfoMap: Map<
    string,
    {
      issueProjectStatus: IssueProjectStatus | null;
      issueProjectStatusSource: ActivityItem["issueProjectStatusSource"];
      issueProjectStatusLocked: boolean;
      issueTodoProjectStatus: IssueProjectStatus | null;
      issueTodoProjectPriority: string | null;
      issueTodoProjectWeight: string | null;
      issueTodoProjectInitiationOptions: string | null;
      issueTodoProjectStartDate: string | null;
    }
  >;
  onResyncItem?: (id: string) => void;
  resyncingIds?: Set<string>;
  resyncDisabled?: boolean;
  resyncDisabledReason?: string | null;
}) {
  const [targetFilter, setTargetFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  type AggregatedMention = {
    selectionId: string;
    representative: MentionAttentionItem;
    mentions: MentionAttentionItem[];
  };

  const aggregatedItems = useMemo<AggregatedMention[]>(() => {
    const map = new Map<
      string,
      { representative: MentionAttentionItem; mentions: MentionAttentionItem[] }
    >();
    items.forEach((mention) => {
      const containerId = mention.container.id ?? null;
      const key =
        containerId && containerId.length > 0 ? containerId : mention.commentId;
      if (!key) {
        return;
      }
      const entry = map.get(key);
      if (entry) {
        entry.mentions.push(mention);
        if (mention.waitingDays > entry.representative.waitingDays) {
          entry.representative = mention;
        }
      } else {
        map.set(key, { representative: mention, mentions: [mention] });
      }
    });

    return Array.from(map.entries()).map(([selectionId, value]) => ({
      selectionId,
      representative: value.representative,
      mentions: value.mentions,
    }));
  }, [items]);

  const aggregation = useMemo(() => {
    const targetMap = new Map<string, RankingEntry>();
    const authorMap = new Map<string, RankingEntry>();

    aggregatedItems.forEach(({ representative }) => {
      const metricValue = representative.waitingDays;
      const target = representative.target;
      const author = representative.author;

      if (target) {
        const targetEntry = targetMap.get(target.id) ?? {
          key: target.id,
          user: target,
          total: 0,
          count: 0,
        };
        targetEntry.total += metricValue;
        targetEntry.count += 1;
        targetMap.set(target.id, targetEntry);
      }

      if (author) {
        const authorEntry = authorMap.get(author.id) ?? {
          key: author.id,
          user: author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(author.id, authorEntry);
      }
    });

    return {
      targets: Array.from(targetMap.values()),
      authors: Array.from(authorMap.values()),
    };
  }, [aggregatedItems]);

  const targetOptions = useMemo(() => {
    return aggregation.targets
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.targets]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const filteredItems = useMemo(() => {
    return aggregatedItems.filter(({ representative }) => {
      const targetMatch =
        targetFilter === "all" || representative.target?.id === targetFilter;

      const authorMatch =
        authorFilter === "all" || representative.author?.id === authorFilter;

      return targetMatch && authorMatch;
    });
  }, [aggregatedItems, targetFilter, authorFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems
      .slice()
      .sort(
        (a, b) => b.representative.waitingDays - a.representative.waitingDays,
      );
  }, [filteredItems]);

  const targetRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.targets);
  }, [aggregation.targets]);

  const targetRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.targets);
  }, [aggregation.targets]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const metricLabel = "경과일수";

  const {
    openItemId,
    detailMap,
    loadingDetailIds,
    selectItem,
    closeItem,
    updateDetailItem,
  } = useActivityDetailState();

  if (!aggregatedItems.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`멘션 대상 ${metricLabel} 합계 순위`}
        entries={targetRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="멘션 대상 데이터가 없습니다."
      />
      <RankingCard
        title="멘션 대상 건수 순위"
        entries={targetRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="멘션 대상 데이터가 없습니다."
      />
      <RankingCard
        title={`요청자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="요청자 데이터가 없습니다."
      />
      <RankingCard
        title="요청자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="요청자 데이터가 없습니다."
      />
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        멘션 대상 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={targetFilter}
          onChange={(event) => setTargetFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {targetOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        요청자 필터
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
        >
          <option value="all">미적용</option>
          {authorOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const listContent = sortedItems.length ? (
    <ul className="space-y-4">
      {sortedItems.map(({ selectionId, representative: item, mentions }) => {
        const containerId = item.container.id ?? null;
        const activityType: ActivityItem["type"] =
          item.container.type === "pull_request"
            ? "pull_request"
            : item.container.type === "discussion"
              ? "discussion"
              : "issue";
        const activityItem = createBaseActivityItem({
          id: selectionId,
          type: activityType,
          number: item.container.number ?? null,
          title: item.container.title,
          url: item.container.url,
          repository: item.container.repository,
          author: item.author,
          attention: { unansweredMention: true },
        });
        if (activityType === "issue") {
          const projectKey =
            containerId && containerId.length > 0 ? containerId : selectionId;
          const fallbackProjectInfo =
            item.issueProjectStatus !== undefined ||
            item.issueProjectStatusSource !== undefined ||
            item.issueProjectStatusLocked !== undefined ||
            item.issueTodoProjectStatus !== undefined ||
            item.issueTodoProjectPriority !== undefined ||
            item.issueTodoProjectWeight !== undefined ||
            item.issueTodoProjectInitiationOptions !== undefined ||
            item.issueTodoProjectStartDate !== undefined
              ? {
                  issueProjectStatus: item.issueProjectStatus ?? null,
                  issueProjectStatusSource:
                    item.issueProjectStatusSource ?? "none",
                  issueProjectStatusLocked:
                    item.issueProjectStatusLocked ?? false,
                  issueTodoProjectStatus: item.issueTodoProjectStatus ?? null,
                  issueTodoProjectPriority:
                    item.issueTodoProjectPriority ?? null,
                  issueTodoProjectWeight: item.issueTodoProjectWeight ?? null,
                  issueTodoProjectInitiationOptions:
                    item.issueTodoProjectInitiationOptions ?? null,
                  issueTodoProjectStartDate:
                    item.issueTodoProjectStartDate ?? null,
                }
              : null;
          const projectInfo =
            issueProjectInfoMap.get(projectKey) ?? fallbackProjectInfo;
          if (projectInfo) {
            activityItem.issueProjectStatus = projectInfo.issueProjectStatus;
            activityItem.issueProjectStatusSource =
              projectInfo.issueProjectStatusSource ?? "none";
            activityItem.issueProjectStatusLocked =
              projectInfo.issueProjectStatusLocked;
            activityItem.issueTodoProjectStatus =
              projectInfo.issueTodoProjectStatus;
            activityItem.issueTodoProjectPriority =
              projectInfo.issueTodoProjectPriority;
            activityItem.issueTodoProjectWeight =
              projectInfo.issueTodoProjectWeight;
            activityItem.issueTodoProjectInitiationOptions =
              projectInfo.issueTodoProjectInitiationOptions;
            activityItem.issueTodoProjectStartDate =
              projectInfo.issueTodoProjectStartDate;
          }
        }
        activityItem.businessDaysOpen = item.waitingDays ?? null;
        activityItem.businessDaysIdle = item.waitingDays ?? null;
        const mentionDetails =
          (containerId && containerId.length > 0
            ? mentionWaitMap.get(containerId)
            : undefined) ?? mentions;
        activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        applyAttentionFlagsFromMap(
          attentionFlagMap,
          activityItem,
          containerId ?? null,
          selectionId,
        );

        const detail = detailMap[selectionId] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const displayItem = overlayItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = `${buildReferenceLabel(
          item.container.repository,
          item.container.number ?? null,
        )} 코멘트`;
        const isSelected = openItemId === selectionId;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = buildAttentionBadges(displayItem, {
          useMentionAi: true,
        });
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.mentionedAt
          ? formatRelative(item.mentionedAt)
          : null;
        const updatedAbsoluteLabel = item.mentionedAt
          ? formatTimestamp(item.mentionedAt, timezone, dateTimeFormat)
          : "-";
        const displayStatusValue =
          displayItem.issueProjectStatus ?? "no_status";
        const displayStatusLabel =
          displayStatusValue !== "no_status"
            ? (ISSUE_STATUS_LABEL_MAP.get(displayStatusValue) ??
              displayStatusValue)
            : null;
        const todoPriorityLabel = formatProjectField(
          displayItem.issueTodoProjectPriority,
        );
        const mentionWeightLabel = formatProjectField(
          displayItem.issueTodoProjectWeight,
        );
        const metadata = (
          <div className="flex flex-col gap-2 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.author && (
                <span>요청자 {formatUserCompact(item.author)}</span>
              )}
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {displayItem.type === "issue" && displayStatusLabel ? (
                <span className={PROJECT_FIELD_BADGE_CLASS}>
                  {displayStatusLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {displayItem.type === "issue" && mentionWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {mentionWeightLabel}
                </span>
              ) : null}
              {renderAttentionBadgeElements(badges, selectionId)}
              {(displayItem.labels ?? []).slice(0, 2).map((label) => (
                <span
                  key={label.key}
                  className="rounded-md bg-muted px-2 py-0.5"
                >
                  {label.name ?? label.key}
                </span>
              ))}
            </div>
            {item.commentExcerpt ? (
              <div className="text-muted-foreground/70">
                “{item.commentExcerpt}”
              </div>
            ) : null}
          </div>
        );
        const overlayBadgeExtras =
          displayItem.type === "issue" ? (
            <>
              {displayItem.issueType ? (
                <span className={ISSUE_TYPE_BADGE_CLASS}>
                  {displayItem.issueType.name ?? displayItem.issueType.id}
                </span>
              ) : null}
              {displayItem.milestone ? (
                <span className={ISSUE_MILESTONE_BADGE_CLASS}>
                  Milestone{" "}
                  {displayItem.milestone.title ?? displayItem.milestone.id}
                </span>
              ) : null}
              {todoPriorityLabel !== "-" ? (
                <span className={ISSUE_PRIORITY_BADGE_CLASS}>
                  {todoPriorityLabel}
                </span>
              ) : null}
              {mentionWeightLabel !== "-" ? (
                <span className={ISSUE_WEIGHT_BADGE_CLASS}>
                  {mentionWeightLabel}
                </span>
              ) : null}
            </>
          ) : null;
        const primaryMention = overlayItem.mentionWaits?.find(
          (wait) => wait.id && (wait.user?.id ?? wait.userId),
        );
        const primaryMentionUserId =
          primaryMention?.user?.id ?? primaryMention?.userId ?? null;
        const mentionSuppressed =
          primaryMention?.manualRequiresResponse === false;

        const handleMentionToggle = async (
          nextState: "suppress" | "force" | "clear",
        ) => {
          if (!primaryMention?.id) {
            return;
          }
          const user = primaryMention.user;
          const userId = user?.id ?? primaryMentionUserId;
          if (!userId) {
            return;
          }
          const key = `${primaryMention.id}::${userId}`;
          setPendingOverrideKey(key);
          try {
            const response = await fetch(
              "/api/attention/unanswered-mentions/manual",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  commentId: primaryMention.id,
                  mentionedUserId: userId,
                  state: nextState,
                }),
              },
            );

            let payload: unknown;
            try {
              payload = await response.json();
            } catch {
              payload = {};
            }

            const result = (payload as {
              success?: boolean;
              result?: {
                manualRequiresResponse: boolean | null;
                manualRequiresResponseAt: string | null;
                manualDecisionIsStale: boolean;
                requiresResponse: boolean | null;
                lastEvaluatedAt: string | null;
              };
              message?: string;
            }) ?? { success: false };

            if (!response.ok || !result.success || !result.result) {
              throw new Error(
                result.message ??
                  "응답 없는 멘션 상태를 업데이트하지 못했습니다.",
              );
            }

            const classification = result.result;
            const manualEffective = classification.manualDecisionIsStale
              ? null
              : classification.manualRequiresResponse;

            const nextOverlayItem: ActivityItem = {
              ...overlayItem,
              attention: {
                ...overlayItem.attention,
                unansweredMention:
                  manualEffective === false
                    ? false
                    : manualEffective === true
                      ? true
                      : (classification.requiresResponse ??
                        overlayItem.attention.unansweredMention),
              },
              mentionWaits:
                overlayItem.mentionWaits?.map((wait) => {
                  const waitUserId = wait.user?.id ?? wait.userId;
                  if (wait.id === primaryMention.id && waitUserId === userId) {
                    return {
                      ...wait,
                      manualRequiresResponse: manualEffective,
                      manualRequiresResponseAt:
                        classification.manualRequiresResponseAt ?? null,
                      manualDecisionIsStale:
                        classification.manualDecisionIsStale ?? false,
                      classifierEvaluatedAt:
                        classification.lastEvaluatedAt ?? null,
                      requiresResponse: classification.requiresResponse ?? null,
                    } satisfies NonNullable<
                      ActivityItem["mentionWaits"]
                    >[number];
                  }
                  return wait;
                }) ?? undefined,
            } satisfies ActivityItem;

            updateDetailItem(nextOverlayItem);

            onOverrideSuccess({
              commentId: primaryMention.id,
              mentionedUserId: userId,
              suppress: nextState === "suppress",
              classification: {
                manualRequiresResponse: manualEffective,
                manualRequiresResponseAt:
                  classification.manualRequiresResponseAt ?? null,
                manualDecisionIsStale:
                  classification.manualDecisionIsStale ?? false,
                requiresResponse: classification.requiresResponse ?? null,
                lastEvaluatedAt: classification.lastEvaluatedAt ?? null,
              },
            });

            if (nextState === "suppress" && !mentionSuppressed) {
              closeItem();
            }
          } catch (error) {
            console.error(
              "[unanswered-mentions] Failed to update manual override",
              error,
            );
          } finally {
            setPendingOverrideKey(null);
          }
        };

        return (
          <li key={selectionId}>
            <div
              className={cn(
                "group rounded-md border bg-background p-3 transition focus-within:border-primary/60 focus-within:shadow-md focus-within:shadow-primary/10",
                isSelected
                  ? "border-primary/60 shadow-md shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-muted/20 hover:shadow-md hover:shadow-primary/10",
              )}
            >
              <button
                type="button"
                aria-expanded={isSelected}
                className={cn(
                  "block w-full cursor-pointer bg-transparent p-0 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isSelected
                    ? "text-primary"
                    : "text-foreground group-hover:text-primary",
                )}
                onClick={() => selectItem(selectionId)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.url ?? undefined}
                    title={item.container.title}
                    metadata={metadata}
                  />
                  <div className="mt-2 flex flex-col gap-1 text-xs text-foreground/90 sm:mt-0 sm:w-[180px] sm:shrink-0 sm:text-right">
                    {updatedRelativeLabel ? (
                      <span className="font-medium text-foreground">
                        {updatedRelativeLabel}
                      </span>
                    ) : null}
                    <span title={timezoneTitle}>{updatedAbsoluteLabel}</span>
                  </div>
                </div>
              </button>
              {isSelected ? (
                <ActivityDetailOverlay
                  item={overlayItem}
                  iconInfo={iconInfo}
                  badges={badges}
                  badgeExtras={overlayBadgeExtras}
                  timezone={timezone}
                  dateTimeFormat={dateTimeFormat}
                  onClose={closeItem}
                  onResync={
                    typeof onResyncItem === "function"
                      ? () => onResyncItem(overlayItem.id)
                      : undefined
                  }
                  isResyncing={resyncingIds?.has(overlayItem.id) ?? false}
                  resyncDisabled={resyncDisabled}
                  resyncDisabledReason={
                    resyncDisabled ? resyncDisabledReason : null
                  }
                >
                  <FollowUpDetailContent
                    item={overlayItem}
                    detail={detail}
                    isLoading={isDetailLoading}
                    timezone={timezone}
                    dateTimeFormat={dateTimeFormat}
                    isUpdatingStatus={false}
                    isUpdatingProjectFields={false}
                    onUpdateStatus={() => {
                      /* no-op for mentions */
                    }}
                    onUpdateProjectField={async () => false}
                    canManageMentions={isAdmin}
                    pendingMentionOverrideKey={pendingOverrideKey}
                    onUpdateMentionOverride={(next) => {
                      if (!next) {
                        return;
                      }
                      void handleMentionToggle(next.state);
                    }}
                  />
                </ActivityDetailOverlay>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyText}</p>
  );

  if (segmented) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {rankingGrid}
        </section>
        <section className="space-y-4 rounded-lg border border-border/50 bg-background p-4 shadow-sm">
          {filterControls}
          {listContent}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {rankingGrid}
        {filterControls}
      </div>
      {listContent}
    </div>
  );
}

type FollowUpSection = {
  id: string;
  menuLabel: string;
  menuDescription: string;
  title: string;
  description: string;
  content: ReactNode;
};

export function AttentionView({
  insights: initialInsights,
  isAdmin = false,
}: {
  insights: AttentionInsights;
  isAdmin?: boolean;
}) {
  const [insights, setInsights] = useState(initialInsights);
  const latestSyncRef = useRef<string | null>(
    initialInsights.generatedAt ?? null,
  );
  const trimmedTimezone = insights.timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const generatedAtLabel = formatTimestamp(
    insights.generatedAt,
    insights.timezone,
    insights.dateTimeFormat,
  );
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [pendingMentionOverrideKey, setPendingMentionOverrideKey] = useState<
    string | null
  >(null);
  const [notification, setNotification] = useState<string | null>(null);
  const notificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [automaticSyncActive, setAutomaticSyncActive] = useState(false);
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const autoSyncRunIdsRef = useRef(new Set<number>());
  const resyncDisabledMessage =
    "자동 동기화 중이므로 완료 후 실행할 수 있어요.";

  useEffect(() => {
    latestSyncRef.current = insights.generatedAt ?? null;
  }, [insights.generatedAt]);

  useEffect(() => {
    return () => {
      if (notificationTimerRef.current) {
        clearTimeout(notificationTimerRef.current);
      }
    };
  }, []);

  const showNotification = useCallback((message: string) => {
    setNotification(message);
    if (notificationTimerRef.current) {
      clearTimeout(notificationTimerRef.current);
    }
    notificationTimerRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    const updateAutoSyncState = () => {
      setAutomaticSyncActive(autoSyncRunIdsRef.current.size > 0);
    };
    const unsubscribe = subscribeToSyncStream((event) => {
      if (event.type === "run-started" && event.runType === "automatic") {
        if (!autoSyncRunIdsRef.current.has(event.runId)) {
          autoSyncRunIdsRef.current.add(event.runId);
          updateAutoSyncState();
        }
      } else if (event.type === "run-status") {
        if (
          autoSyncRunIdsRef.current.has(event.runId) &&
          event.status !== "running"
        ) {
          autoSyncRunIdsRef.current.delete(event.runId);
          updateAutoSyncState();
        }
      } else if (
        event.type === "run-completed" ||
        event.type === "run-failed"
      ) {
        if (autoSyncRunIdsRef.current.delete(event.runId)) {
          updateAutoSyncState();
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let canceled = false;
    const loadInitialSyncState = async () => {
      try {
        const response = await fetch("/api/sync/status");
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          success?: boolean;
          status?: {
            runs?: Array<{
              id: number;
              runType?: string;
              status?: string;
            }>;
          };
        };
        if (!payload?.success || !payload.status?.runs || canceled) {
          return;
        }
        const ids = new Set<number>();
        payload.status.runs.forEach((run) => {
          if (run.runType === "automatic" && run.status === "running") {
            const runId = Number(run.id);
            if (Number.isFinite(runId)) {
              ids.add(runId);
            }
          }
        });
        if (!canceled) {
          autoSyncRunIdsRef.current = ids;
          setAutomaticSyncActive(ids.size > 0);
        }
      } catch {
        // ignore failures
      }
    };
    void loadInitialSyncState();
    return () => {
      canceled = true;
    };
  }, []);

  const handleMentionOverrideSuccess = useCallback(
    (params: {
      commentId: string;
      mentionedUserId: string;
      suppress: boolean;
      classification: {
        manualRequiresResponse: boolean | null;
        manualRequiresResponseAt: string | null;
        manualDecisionIsStale: boolean;
        requiresResponse: boolean | null;
        lastEvaluatedAt: string | null;
      };
    }) => {
      const { commentId, mentionedUserId, classification } = params;
      setInsights((current) => {
        const nextUnanswered: MentionAttentionItem[] = [];
        current.unansweredMentions.forEach((entry) => {
          if (
            entry.commentId === commentId &&
            entry.target?.id === mentionedUserId
          ) {
            const manualEffective = classification.manualDecisionIsStale
              ? null
              : classification.manualRequiresResponse;
            const requiresValue = classification.requiresResponse;
            const shouldInclude =
              manualEffective === false
                ? false
                : manualEffective === true
                  ? true
                  : requiresValue === true;
            if (!shouldInclude) {
              return;
            }
            nextUnanswered.push({
              ...entry,
              classification: {
                requiresResponse: requiresValue ?? null,
                manualRequiresResponse: manualEffective,
                manualRequiresResponseAt:
                  classification.manualRequiresResponseAt ?? null,
                manualDecisionIsStale:
                  classification.manualDecisionIsStale ?? false,
                lastEvaluatedAt: classification.lastEvaluatedAt ?? null,
              },
            });
          } else {
            nextUnanswered.push(entry);
          }
        });

        return {
          ...current,
          unansweredMentions: nextUnanswered,
        } satisfies AttentionInsights;
      });
    },
    [],
  );

  const handleResyncItem = useCallback(
    async (itemId: string) => {
      if (!itemId) {
        return;
      }
      setResyncingIds((current) => {
        if (current.has(itemId)) {
          return current;
        }
        const next = new Set(current);
        next.add(itemId);
        return next;
      });
      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(itemId)}/resync`,
          {
            method: "POST",
          },
        );
        if (!response.ok) {
          let message = "GitHub에서 다시 불러오지 못했어요.";
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload?.error) {
              message = payload.error;
            }
          } catch {
            // ignore JSON parse errors
          }
          showNotification(message);
          return;
        }
        showNotification("GitHub에서 다시 불러왔어요.");
        startTransition(() => {
          router.refresh();
        });
      } catch (error) {
        console.error("Failed to re-import activity item", error);
        showNotification("GitHub에서 다시 불러오지 못했어요.");
      } finally {
        setResyncingIds((current) => {
          if (!current.has(itemId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(itemId);
          return next;
        });
      }
    },
    [router, showNotification],
  );

  const reviewWaitMap = useMemo(() => {
    const map = new Map<string, ReviewRequestAttentionItem[]>();
    insights.stuckReviewRequests.forEach((item) => {
      const prId = item.pullRequest.id;
      if (!prId) {
        return;
      }
      const existing = map.get(prId) ?? [];
      existing.push(item);
      map.set(prId, existing);
    });
    return map;
  }, [insights.stuckReviewRequests]);

  const mentionWaitMap = useMemo(() => {
    const map = new Map<string, MentionAttentionItem[]>();
    insights.unansweredMentions.forEach((item) => {
      const containerId = item.container.id;
      if (!containerId) {
        return;
      }
      const existing = map.get(containerId) ?? [];
      existing.push(item);
      map.set(containerId, existing);
    });
    return map;
  }, [insights.unansweredMentions]);

  const attentionFlagMap = useMemo(() => {
    const map = new Map<string, Partial<ActivityItem["attention"]>>();
    const merge = (
      id: string | null | undefined,
      patch: Partial<ActivityItem["attention"]>,
    ) => {
      if (!id) {
        return;
      }
      const existing = map.get(id);
      map.set(id, existing ? { ...existing, ...patch } : { ...patch });
    };

    insights.reviewerUnassignedPrs.forEach((item) => {
      merge(item.id, { reviewerUnassignedPr: true });
    });
    insights.reviewStalledPrs.forEach((item) => {
      merge(item.id, { reviewStalledPr: true });
    });
    insights.mergeDelayedPrs.forEach((item) => {
      merge(item.id, { mergeDelayedPr: true });
    });
    insights.stuckReviewRequests.forEach((item) => {
      const prId = item.pullRequest.id;
      merge(prId ?? item.id, { reviewRequestPending: true });
    });
    insights.backlogIssues.forEach((item) => {
      merge(item.id, { backlogIssue: true });
    });
    insights.stalledInProgressIssues.forEach((item) => {
      merge(item.id, { stalledIssue: true });
    });
    insights.unansweredMentions.forEach((item) => {
      merge(item.container.id, { unansweredMention: true });
    });

    return map;
  }, [
    insights.backlogIssues,
    insights.mergeDelayedPrs,
    insights.reviewStalledPrs,
    insights.reviewerUnassignedPrs,
    insights.stalledInProgressIssues,
    insights.stuckReviewRequests,
    insights.unansweredMentions,
  ]);

  const issueProjectInfoMap = useMemo(() => {
    const map = new Map<
      string,
      {
        issueProjectStatus: IssueProjectStatus | null;
        issueProjectStatusSource: ActivityItem["issueProjectStatusSource"];
        issueProjectStatusLocked: boolean;
        issueTodoProjectStatus: IssueProjectStatus | null;
        issueTodoProjectPriority: string | null;
        issueTodoProjectWeight: string | null;
        issueTodoProjectInitiationOptions: string | null;
        issueTodoProjectStartDate: string | null;
      }
    >();
    const store = (item: IssueAttentionItem) => {
      map.set(item.id, {
        issueProjectStatus: item.issueProjectStatus ?? null,
        issueProjectStatusSource: item.issueProjectStatusSource ?? "none",
        issueProjectStatusLocked: item.issueProjectStatusLocked ?? false,
        issueTodoProjectStatus: item.issueTodoProjectStatus ?? null,
        issueTodoProjectPriority: item.issueTodoProjectPriority ?? null,
        issueTodoProjectWeight: item.issueTodoProjectWeight ?? null,
        issueTodoProjectInitiationOptions:
          item.issueTodoProjectInitiationOptions ?? null,
        issueTodoProjectStartDate: item.issueTodoProjectStartDate ?? null,
      });
    };
    insights.backlogIssues.forEach(store);
    insights.stalledInProgressIssues.forEach(store);
    insights.unansweredMentions.forEach((mention) => {
      if (mention.container.type !== "issue") {
        return;
      }
      const id = mention.container.id;
      if (!id || map.has(id)) {
        return;
      }
      const hasProjectInfo =
        mention.issueProjectStatus !== undefined ||
        mention.issueProjectStatusSource !== undefined ||
        mention.issueProjectStatusLocked !== undefined ||
        mention.issueTodoProjectStatus !== undefined ||
        mention.issueTodoProjectPriority !== undefined ||
        mention.issueTodoProjectWeight !== undefined ||
        mention.issueTodoProjectInitiationOptions !== undefined ||
        mention.issueTodoProjectStartDate !== undefined;
      if (!hasProjectInfo) {
        return;
      }
      map.set(id, {
        issueProjectStatus: mention.issueProjectStatus ?? null,
        issueProjectStatusSource: mention.issueProjectStatusSource ?? "none",
        issueProjectStatusLocked: mention.issueProjectStatusLocked ?? false,
        issueTodoProjectStatus: mention.issueTodoProjectStatus ?? null,
        issueTodoProjectPriority: mention.issueTodoProjectPriority ?? null,
        issueTodoProjectWeight: mention.issueTodoProjectWeight ?? null,
        issueTodoProjectInitiationOptions:
          mention.issueTodoProjectInitiationOptions ?? null,
        issueTodoProjectStartDate: mention.issueTodoProjectStartDate ?? null,
      });
    });
    return map;
  }, [
    insights.backlogIssues,
    insights.stalledInProgressIssues,
    insights.unansweredMentions,
  ]);

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const sections: FollowUpSection[] = [
    {
      id: "backlog-issues",
      menuLabel: "정체된 Backlog 이슈",
      menuDescription: "40일 이상 In Progress로 이동하지 않은 이슈",
      title: "40일 이상 (주말과 공휴일 제외) In Progress로 이동하지 않은 이슈",
      description:
        "프로젝트에 추가되었지만 주말과 공휴일을 제외한 40일 이상 진행 상태로 전환되지 않은 이슈입니다.",
      content: (
        <IssueList
          items={insights.backlogIssues}
          emptyText="현재 조건을 만족하는 이슈가 없습니다."
          metricLabel="경과일수"
          showMaintainerControls
          maintainerOptionsOverride={insights.organizationMaintainers ?? []}
          repositoryMaintainersByRepository={
            insights.repositoryMaintainersByRepository ?? {}
          }
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "stalled-in-progress-issues",
      menuLabel: "정체된 In Progress 이슈",
      menuDescription: "In Progress에서 20일 이상 머문 이슈",
      title: "In Progress에서 20일 이상 (주말과 공휴일 제외) 정체된 이슈",
      description:
        "In Progress 상태로 전환된 후 주말과 공휴일을 제외한 20일 이상 종료되지 않은 이슈입니다.",
      content: (
        <IssueList
          items={insights.stalledInProgressIssues}
          emptyText="현재 조건을 만족하는 이슈가 없습니다."
          highlightInProgress
          metricKey="inProgressAgeDays"
          metricLabel="In Progress 경과일수"
          primaryUserRole="repositoryMaintainer"
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "reviewer-unassigned-prs",
      menuLabel: "리뷰어 미지정 PR",
      menuDescription: "2 업무일 이상 리뷰어 미지정 PR",
      title: "2 업무일 이상 리뷰어가 지정되지 않은 PR",
      description:
        "PR 생성 이후 2 업무일 이상 리뷰어가 지정되지 않은 PR입니다 (저장소 책임자 기준).",
      content: (
        <PullRequestList
          items={insights.reviewerUnassignedPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          metricKey="waitingDays"
          metricLabel="기준 경과일수"
          attentionOverride={{ reviewerUnassignedPr: true }}
          primaryUserRole="repositoryMaintainer"
          secondaryUserRole="author"
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          repositoryMaintainersByRepository={
            insights.repositoryMaintainersByRepository ?? {}
          }
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "review-stalled-prs",
      menuLabel: "리뷰 정체 PR",
      menuDescription: "2 업무일 이상 리뷰 정체 PR",
      title: "2 업무일 이상 리뷰가 정체된 PR",
      description:
        "리뷰어가 지정된 이후 2 업무일 이상 리뷰어 활동이 없는 PR입니다 (리뷰어 기준, 모든 리뷰어 충족).",
      content: (
        <PullRequestList
          items={insights.reviewStalledPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          metricKey="waitingDays"
          metricLabel="기준 경과일수"
          attentionOverride={{ reviewStalledPr: true }}
          primaryUserRole="reviewer"
          secondaryUserRole="repositoryMaintainer"
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          repositoryMaintainersByRepository={
            insights.repositoryMaintainersByRepository ?? {}
          }
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "merge-delayed-prs",
      menuLabel: "머지 지연 PR",
      menuDescription: "2 업무일 이상 머지 지연 PR",
      title: "2 업무일 이상 머지가 지연된 PR",
      description:
        "유효한 최근 approval 이후 2 업무일이 지났는데도 머지되지 않은 PR입니다 (저장소 책임자 기준).",
      content: (
        <PullRequestList
          items={insights.mergeDelayedPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          metricKey="waitingDays"
          metricLabel="기준 경과일수"
          attentionOverride={{ mergeDelayedPr: true }}
          primaryUserRole="assignee"
          secondaryUserRole="repositoryMaintainer"
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          repositoryMaintainersByRepository={
            insights.repositoryMaintainersByRepository ?? {}
          }
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "stuck-review-requests",
      menuLabel: "응답 없는 리뷰 요청",
      menuDescription:
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 리뷰 요청",
      description:
        "주말과 공휴일을 제외하고 5일 이상 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 리뷰 요청을 모았습니다.",
      content: (
        <ReviewRequestList
          items={insights.stuckReviewRequests}
          emptyText="현재 조건을 만족하는 리뷰 요청이 없습니다."
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          attentionFlagMap={attentionFlagMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
    {
      id: "unanswered-mentions",
      menuLabel: "응답 없는 멘션",
      menuDescription:
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 멘션",
      title: "5일 이상 (주말과 공휴일 제외) 응답이 없는 멘션",
      description:
        "주말과 공휴일을 제외하고 5일 넘게 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 멘션을 모았습니다.",
      content: (
        <MentionList
          items={insights.unansweredMentions}
          emptyText="현재 조건을 만족하는 멘션이 없습니다."
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
          isAdmin={isAdmin}
          pendingOverrideKey={pendingMentionOverrideKey}
          setPendingOverrideKey={setPendingMentionOverrideKey}
          onOverrideSuccess={handleMentionOverrideSuccess}
          mentionWaitMap={mentionWaitMap}
          issueProjectInfoMap={issueProjectInfoMap}
          attentionFlagMap={attentionFlagMap}
          onResyncItem={handleResyncItem}
          resyncingIds={resyncingIds}
          resyncDisabled={automaticSyncActive}
          resyncDisabledReason={
            automaticSyncActive ? resyncDisabledMessage : null
          }
        />
      ),
    },
  ];

  const summaries = useMemo<FollowUpSummary[]>(() => {
    return buildFollowUpSummaries(insights);
  }, [insights]);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const activeSection = activeSectionId
    ? sections.find((section) => section.id === activeSectionId)
    : undefined;
  const overviewMenuDescription =
    "전체 하위 메뉴의 요약 통계를 한눈에 확인합니다.";
  const activeMenuDescription =
    activeSectionId === null
      ? overviewMenuDescription
      : activeSection?.menuDescription;
  const useFollowUpLayout =
    activeSection && FOLLOW_UP_SECTION_SET.has(activeSection.id);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <p className="text-sm text-muted-foreground">
            정체된 작업이나 요청을 확인하세요.
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
              통계 생성 시각:
              <span
                className="font-semibold text-foreground/80"
                title={timezoneTitle}
              >
                {generatedAtLabel}
              </span>
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70",
              )}
              aria-label="Follow-ups 통계 새로 고침"
            >
              <RefreshCcw
                className={cn("h-4 w-4", isRefreshing ? "animate-spin" : "")}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>
      {notification ? (
        <div className="rounded-md border border-border/60 bg-muted px-3 py-2 text-xs text-muted-foreground">
          {notification}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <nav
          className="border-b border-slate-200"
          aria-label="Follow-ups 하위 메뉴"
        >
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setActiveSectionId(null)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeSectionId === null
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={activeSectionId === null ? "true" : undefined}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Overview
            </button>
            {sections.map((section) => {
              const selected = section.id === activeSectionId;

              // 각 섹션별 아이콘 매핑
              const getIcon = () => {
                switch (section.id) {
                  case "reviewer-unassigned-prs":
                    return <GitPullRequestDraft className="h-3.5 w-3.5" />;
                  case "review-stalled-prs":
                    return <GitPullRequest className="h-3.5 w-3.5" />;
                  case "merge-delayed-prs":
                    return <GitPullRequest className="h-3.5 w-3.5" />;
                  case "stuck-review-requests":
                    return <MessageSquare className="h-3.5 w-3.5" />;
                  case "backlog-issues":
                    return <CircleDot className="h-3.5 w-3.5" />;
                  case "stalled-in-progress-issues":
                    return <Play className="h-3.5 w-3.5" />;
                  case "unanswered-mentions":
                    return <AtSign className="h-3.5 w-3.5" />;
                  default:
                    return <CircleDot className="h-3.5 w-3.5" />;
                }
              };

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selected
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={selected ? "true" : undefined}
                >
                  {getIcon()}
                  {section.menuLabel}
                </button>
              );
            })}
          </div>
          {activeMenuDescription ? (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30">
              {activeMenuDescription}
            </div>
          ) : null}
        </nav>

        <div className="flex-1">
          {activeSection ? (
            useFollowUpLayout ? (
              activeSection.content
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{activeSection.title}</CardTitle>
                  <CardDescription>{activeSection.description}</CardDescription>
                </CardHeader>
                <CardContent>{activeSection.content}</CardContent>
              </Card>
            )
          ) : (
            <FollowUpOverview
              summaries={summaries}
              onSelect={(id) => setActiveSectionId(id)}
            />
          )}
        </div>
      </div>
    </section>
  );
}

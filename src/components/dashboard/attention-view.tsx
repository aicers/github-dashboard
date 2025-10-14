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
import { cn } from "@/lib/utils";
import { ActivityDetailOverlay } from "./activity/activity-detail-overlay";
import { ActivityListItemSummary } from "./activity/activity-list-item-summary";
import {
  ActivityCommentSection,
  formatDateOnly,
  formatDateTime,
  formatProjectField,
  ISSUE_STATUS_LABEL_MAP,
  ISSUE_STATUS_OPTIONS,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_BADGE_CLASS,
  PROJECT_FIELD_LABELS,
  ProjectFieldEditor,
  type ProjectFieldKey,
  renderMarkdownHtml,
  resolveDetailBodyHtml,
  SOURCE_STATUS_KEYS,
} from "./activity/detail-shared";
import {
  buildActivityMetricEntries,
  formatRelative,
  resolveActivityIcon,
} from "./activity/shared";

function formatUserList(users: UserReference[]) {
  if (!users.length) {
    return "없음";
  }

  return users.map((user) => formatUser(user)).join(", ");
}

function formatRepository(repository: RepositoryReference | null) {
  if (!repository) {
    return "알 수 없음";
  }

  return repository.nameWithOwner ?? repository.name ?? repository.id;
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
  "stale-open-prs",
  "idle-open-prs",
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
    mentionedAt: entry.mentionedAt ?? null,
    businessDaysWaiting: entry.waitingDays ?? null,
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
    staleOpenPr: false,
    idlePr: false,
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
  };
}

function FollowUpDetailContent({
  item,
  detail,
  isLoading,
  timezone,
  dateTimeFormat,
  isUpdatingStatus,
  isUpdatingProjectFields,
  onUpdateStatus,
  onUpdateProjectField,
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
            <div className="space-y-4 leading-relaxed [&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.user-mention]:font-semibold">
              {renderedContent}
            </div>
          );
        })()}
      </div>
      <ActivityCommentSection
        comments={detail.comments}
        timezone={timezone}
        dateTimeFormat={dateTimeFormat}
      />
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
                          className="text-primary hover:underline"
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
                          className="text-primary hover:underline"
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
  reviewWaitMap,
  mentionWaitMap,
  timezone,
  dateTimeFormat,
  segmented = false,
}: {
  items: PullRequestAttentionItem[];
  emptyText: string;
  showUpdated?: boolean;
  metricKey?: "ageDays" | "inactivityDays";
  metricLabel?: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      if (item.author) {
        const authorKey = item.author.id;
        const authorEntry = authorMap.get(authorKey) ?? {
          key: authorKey,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(authorKey, authorEntry);
      }

      item.reviewers.forEach((reviewer) => {
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += metricValue;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      });
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [items, metricKey]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const reviewerOptions = useMemo(() => {
    return aggregation.reviewers
      .map((entry) => ({
        key: entry.key,
        label: formatUser(entry.user),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.reviewers]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" ||
        item.reviewers.some((reviewer) => reviewer.id === reviewerFilter);

      return authorMatch && reviewerMatch;
    });
  }, [items, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    const getMetric = (item: PullRequestAttentionItem) =>
      metricKey === "inactivityDays"
        ? (item.inactivityDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => getMetric(b) - getMetric(a));
  }, [filteredItems, metricKey]);

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

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  const rankingGrid = (
    <div className="grid gap-4 md:grid-cols-2">
      <RankingCard
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
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
        생성자 필터
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
      {sortedItems.map((item) => {
        const attentionFlags = showUpdated
          ? { idlePr: true }
          : { staleOpenPr: true };
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
        activityItem.businessDaysOpen = item.ageDays ?? null;
        if (item.inactivityDays !== undefined) {
          activityItem.businessDaysIdle = item.inactivityDays ?? null;
        }
        const reviewWaitDetails = reviewWaitMap.get(item.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const detail = detailMap[item.id] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = [showUpdated ? "업데이트 없는 PR" : "오래된 PR"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone, dateTimeFormat)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.author && <span>작성자 {formatUser(item.author)}</span>}
            {item.reviewers.length > 0 && (
              <span>리뷰어 {formatUserList(item.reviewers)}</span>
            )}
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
                  onClose={closeItem}
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
  timezone,
  dateTimeFormat,
  segmented = false,
}: {
  items: ReviewRequestAttentionItem[];
  emptyText: string;
  reviewWaitMap: Map<string, ReviewRequestAttentionItem[]>;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [reviewerFilter, setReviewerFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const reviewerMap = new Map<string, RankingEntry>();

    items.forEach((item) => {
      const metricValue = item.waitingDays;

      const author = item.pullRequest.author;
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

      const reviewer = item.reviewer;
      if (reviewer) {
        const reviewerEntry = reviewerMap.get(reviewer.id) ?? {
          key: reviewer.id,
          user: reviewer,
          total: 0,
          count: 0,
        };
        reviewerEntry.total += metricValue;
        reviewerEntry.count += 1;
        reviewerMap.set(reviewer.id, reviewerEntry);
      }
    });

    return {
      authors: Array.from(authorMap.values()),
      reviewers: Array.from(reviewerMap.values()),
    };
  }, [items]);

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
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.pullRequest.author?.id === authorFilter;

      const reviewerMatch =
        reviewerFilter === "all" || item.reviewer?.id === reviewerFilter;

      return authorMatch && reviewerMatch;
    });
  }, [items, authorFilter, reviewerFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems.slice().sort((a, b) => b.waitingDays - a.waitingDays);
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
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
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
        생성자 필터
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
      {sortedItems.map((item) => {
        const selectionId = item.pullRequest.id?.trim().length
          ? item.pullRequest.id
          : item.id;
        const activityItem = createBaseActivityItem({
          id: selectionId,
          type: "pull_request",
          number: item.pullRequest.number,
          title: item.pullRequest.title,
          url: item.pullRequest.url,
          repository: item.pullRequest.repository,
          author: item.pullRequest.author,
          attention: { reviewRequestPending: true },
        });
        activityItem.reviewers = toActivityUsers(item.pullRequest.reviewers);
        activityItem.businessDaysOpen = item.pullRequestAgeDays ?? null;
        activityItem.businessDaysIdle =
          item.pullRequestInactivityDays ?? item.waitingDays ?? null;
        const reviewWaitDetails = reviewWaitMap.get(item.pullRequest.id) ?? [];
        if (reviewWaitDetails.length) {
          activityItem.reviewRequestWaits =
            toActivityReviewWaits(reviewWaitDetails);
        } else {
          activityItem.reviewRequestWaits = toActivityReviewWaits([item]);
        }
        const mentionDetails = mentionWaitMap.get(item.pullRequest.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const detail = detailMap[selectionId] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.pullRequest.repository,
          item.pullRequest.number,
        );
        const isSelected = openItemId === selectionId;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = ["응답 없는 리뷰 요청"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.pullRequestUpdatedAt
          ? formatRelative(item.pullRequestUpdatedAt)
          : null;
        const updatedAbsoluteLabel = item.pullRequestUpdatedAt
          ? formatTimestamp(item.pullRequestUpdatedAt, timezone, dateTimeFormat)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.pullRequest.author && (
              <span>생성자 {formatUser(item.pullRequest.author)}</span>
            )}
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
                onClick={() => selectItem(selectionId)}
              >
                <div className="sm:flex sm:items-start sm:justify-between sm:gap-4">
                  <ActivityListItemSummary
                    iconInfo={iconInfo}
                    referenceLabel={referenceLabel}
                    referenceUrl={item.pullRequest.url ?? undefined}
                    title={item.pullRequest.title}
                    metadata={metadata}
                  />
                  {item.pullRequestUpdatedAt ? (
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
                  onClose={closeItem}
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

function IssueList({
  items,
  emptyText,
  highlightInProgress,
  metricKey = "ageDays",
  metricLabel = "경과일수",
  mentionWaitMap,
  timezone,
  dateTimeFormat,
  segmented = false,
}: {
  items: IssueAttentionItem[];
  emptyText: string;
  highlightInProgress?: boolean;
  metricKey?: "ageDays" | "inProgressAgeDays";
  metricLabel?: string;
  mentionWaitMap: Map<string, MentionAttentionItem[]>;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
}) {
  const [authorFilter, setAuthorFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingProjectFieldIds, setUpdatingProjectFieldIds] = useState<
    Set<string>
  >(() => new Set<string>());
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const aggregation = useMemo(() => {
    const authorMap = new Map<string, RankingEntry>();
    const assigneeMap = new Map<string, RankingEntry>();

    const getMetric = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    items.forEach((item) => {
      const metricValue = getMetric(item);

      if (item.author) {
        const authorEntry = authorMap.get(item.author.id) ?? {
          key: item.author.id,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(item.author.id, authorEntry);
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
      authors: Array.from(authorMap.values()),
      assignees: Array.from(assigneeMap.values()),
    };
  }, [items, metricKey]);

  const authorOptions = useMemo(() => {
    return aggregation.authors
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.authors]);

  const assigneeOptions = useMemo(() => {
    return aggregation.assignees
      .map((entry) => ({ key: entry.key, label: formatUser(entry.user) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [aggregation.assignees]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      const assigneeMatch =
        assigneeFilter === "all" ||
        item.assignees.some((assignee) => assignee.id === assigneeFilter);

      return authorMatch && assigneeMatch;
    });
  }, [items, authorFilter, assigneeFilter]);

  const sortedItems = useMemo(() => {
    const metricFor = (item: IssueAttentionItem) =>
      metricKey === "inProgressAgeDays"
        ? (item.inProgressAgeDays ?? item.ageDays ?? 0)
        : (item.ageDays ?? 0);

    return filteredItems.slice().sort((a, b) => metricFor(b) - metricFor(a));
  }, [filteredItems, metricKey]);

  const authorRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.authors);
  }, [aggregation.authors]);

  const authorRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.authors);
  }, [aggregation.authors]);

  const assigneeRankingByTotal = useMemo(() => {
    return sortRankingByTotal(aggregation.assignees);
  }, [aggregation.assignees]);

  const assigneeRankingByCount = useMemo(() => {
    return sortRankingByCount(aggregation.assignees);
  }, [aggregation.assignees]);

  const hasAssigneeFilter = assigneeOptions.length > 0;

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
        title={`생성자 ${metricLabel} 합계 순위`}
        entries={authorRankingByTotal}
        valueFormatter={(entry) => formatDays(entry.total)}
        emptyText="생성자 데이터가 없습니다."
      />
      <RankingCard
        title="생성자 건수 순위"
        entries={authorRankingByCount}
        valueFormatter={(entry) => formatCount(entry.count)}
        emptyText="생성자 데이터가 없습니다."
      />
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
    </div>
  );

  const filterControls = (
    <div className="flex flex-wrap gap-4">
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        생성자 필터
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
        activityItem.assignees = toActivityUsers(item.assignees);
        activityItem.businessDaysOpen = item.ageDays ?? null;
        if (item.inProgressAgeDays !== undefined) {
          activityItem.businessDaysSinceInProgress =
            item.inProgressAgeDays ?? null;
          activityItem.businessDaysInProgressOpen =
            item.inProgressAgeDays ?? null;
        }
        const mentionDetails = mentionWaitMap.get(item.id) ?? [];
        if (mentionDetails.length) {
          activityItem.mentionWaits = toActivityMentionWaits(mentionDetails);
        }

        const detail = detailMap[item.id] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = buildReferenceLabel(
          item.repository,
          item.number,
        );
        const isSelected = openItemId === item.id;
        const isDetailLoading = loadingDetailIds.has(item.id);
        const badges = [
          highlightInProgress
            ? "정체된 In Progress 이슈"
            : "정체된 Backlog 이슈",
        ];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.updatedAt
          ? formatRelative(item.updatedAt)
          : null;
        const updatedAbsoluteLabel = item.updatedAt
          ? formatTimestamp(item.updatedAt, timezone, dateTimeFormat)
          : "-";
        const detailItem = detail?.item;
        const todoStatusLabel = detailItem?.issueTodoProjectStatus
          ? (ISSUE_STATUS_LABEL_MAP.get(detailItem.issueTodoProjectStatus) ??
            detailItem.issueTodoProjectStatus)
          : null;
        const todoPriorityLabel = detailItem
          ? formatProjectField(detailItem.issueTodoProjectPriority)
          : "-";
        const metadata = (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground/90">
            {metrics.map((metric) => (
              <span key={metric.key}>{metric.content}</span>
            ))}
            {item.author && <span>생성자 {formatUser(item.author)}</span>}
            {item.assignees.length > 0 && (
              <span>담당자 {formatUserList(item.assignees)}</span>
            )}
            {detailItem?.type === "issue" && todoStatusLabel ? (
              <span className={PROJECT_FIELD_BADGE_CLASS}>
                {todoStatusLabel}
              </span>
            ) : null}
            {detailItem?.type === "issue" && todoPriorityLabel !== "-" ? (
              <span className={PROJECT_FIELD_BADGE_CLASS}>
                {todoPriorityLabel}
              </span>
            ) : null}
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
                  onClose={closeItem}
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
}: {
  items: MentionAttentionItem[];
  emptyText: string;
  timezone: string;
  dateTimeFormat: DateTimeDisplayFormat;
  segmented?: boolean;
}) {
  const [targetFilter, setTargetFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const trimmedTimezone = timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;

  const aggregation = useMemo(() => {
    const targetMap = new Map<string, RankingEntry>();
    const authorMap = new Map<string, RankingEntry>();

    items.forEach((item) => {
      const metricValue = item.waitingDays;

      if (item.target) {
        const targetEntry = targetMap.get(item.target.id) ?? {
          key: item.target.id,
          user: item.target,
          total: 0,
          count: 0,
        };
        targetEntry.total += metricValue;
        targetEntry.count += 1;
        targetMap.set(item.target.id, targetEntry);
      }

      if (item.author) {
        const authorEntry = authorMap.get(item.author.id) ?? {
          key: item.author.id,
          user: item.author,
          total: 0,
          count: 0,
        };
        authorEntry.total += metricValue;
        authorEntry.count += 1;
        authorMap.set(item.author.id, authorEntry);
      }
    });

    return {
      targets: Array.from(targetMap.values()),
      authors: Array.from(authorMap.values()),
    };
  }, [items]);

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
    return items.filter((item) => {
      const targetMatch =
        targetFilter === "all" || item.target?.id === targetFilter;

      const authorMatch =
        authorFilter === "all" || item.author?.id === authorFilter;

      return targetMatch && authorMatch;
    });
  }, [items, targetFilter, authorFilter]);

  const sortedItems = useMemo(() => {
    return filteredItems.slice().sort((a, b) => b.waitingDays - a.waitingDays);
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

  const { openItemId, detailMap, loadingDetailIds, selectItem, closeItem } =
    useActivityDetailState();

  if (!items.length && !segmented) {
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
      {sortedItems.map((item, index) => {
        const containerId = item.container.id?.trim();
        const selectionId =
          containerId && containerId.length > 0 ? containerId : item.commentId;
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
        activityItem.businessDaysOpen = item.waitingDays ?? null;
        activityItem.businessDaysIdle = item.waitingDays ?? null;
        activityItem.mentionWaits = toActivityMentionWaits([item]);

        const detail = detailMap[selectionId] ?? undefined;
        const overlayItem = detail?.item ?? activityItem;
        const iconInfo = resolveActivityIcon(overlayItem);
        const referenceLabel = `${buildReferenceLabel(
          item.container.repository,
          item.container.number ?? null,
        )} 코멘트`;
        const isSelected = openItemId === selectionId;
        const isDetailLoading = loadingDetailIds.has(selectionId);
        const badges = ["응답 없는 멘션"];
        const metrics = buildActivityMetricEntries(activityItem);
        const updatedRelativeLabel = item.mentionedAt
          ? formatRelative(item.mentionedAt)
          : null;
        const updatedAbsoluteLabel = item.mentionedAt
          ? formatTimestamp(item.mentionedAt, timezone, dateTimeFormat)
          : "-";
        const metadata = (
          <div className="flex flex-col gap-2 text-xs text-foreground/90">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {metrics.map((metric) => (
                <span key={metric.key}>{metric.content}</span>
              ))}
              {item.target && <span>멘션 대상 {formatUser(item.target)}</span>}
              {item.author && <span>요청자 {formatUser(item.author)}</span>}
            </div>
            {item.commentExcerpt ? (
              <div className="text-muted-foreground/70">
                “{item.commentExcerpt}”
              </div>
            ) : null}
          </div>
        );

        return (
          <li
            key={`${item.commentId}:${item.target?.id ?? "unknown"}:${index}`}
          >
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
                  onClose={closeItem}
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

export function AttentionView({ insights }: { insights: AttentionInsights }) {
  const trimmedTimezone = insights.timezone.trim();
  const timezoneTitle = trimmedTimezone.length ? trimmedTimezone : undefined;
  const generatedAtLabel = formatTimestamp(
    insights.generatedAt,
    insights.timezone,
    insights.dateTimeFormat,
  );
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

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
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
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
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
        />
      ),
    },
    {
      id: "stale-open-prs",
      menuLabel: "오래된 PR",
      menuDescription: "20일 이상 머지되지 않은 PR",
      title: "20일 이상 (주말과 공휴일 제외) 머지되지 않은 PR",
      description:
        "열린 상태로 주말과 공휴일을 제외한 20일 이상 유지되고 있는 PR 목록입니다.",
      content: (
        <PullRequestList
          items={insights.staleOpenPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
        />
      ),
    },
    {
      id: "idle-open-prs",
      menuLabel: "업데이트 없는 PR",
      menuDescription: "10일 이상 업데이트가 없는 열린 PR",
      title: "10일 이상 (주말과 공휴일 제외) 업데이트가 없는 열린 PR",
      description:
        "최근 업데이트가 주말과 공휴일을 제외한 10일 이상 없었던 열린 PR을 보여줍니다.",
      content: (
        <PullRequestList
          items={insights.idleOpenPrs}
          emptyText="현재 조건을 만족하는 PR이 없습니다."
          showUpdated
          metricKey="inactivityDays"
          metricLabel="미업데이트 경과일수"
          reviewWaitMap={reviewWaitMap}
          mentionWaitMap={mentionWaitMap}
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
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
          timezone={insights.timezone}
          dateTimeFormat={insights.dateTimeFormat}
          segmented
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

      <div className="flex flex-col gap-6">
        <nav
          className="border-b border-slate-200"
          aria-label="Follow-ups 하위 메뉴"
        >
          <div className="flex gap-1 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveSectionId(null)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                activeSectionId === null
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={activeSectionId === null ? "true" : undefined}
            >
              <LayoutGrid className="h-4 w-4" />
              Overview
            </button>
            {sections.map((section) => {
              const selected = section.id === activeSectionId;

              // 각 섹션별 아이콘 매핑
              const getIcon = () => {
                switch (section.id) {
                  case "stale-open-prs":
                    return <GitPullRequest className="h-4 w-4" />;
                  case "idle-open-prs":
                    return <GitPullRequestDraft className="h-4 w-4" />;
                  case "stuck-review-requests":
                    return <MessageSquare className="h-4 w-4" />;
                  case "backlog-issues":
                    return <CircleDot className="h-4 w-4" />;
                  case "stalled-in-progress-issues":
                    return <Play className="h-4 w-4" />;
                  case "unanswered-mentions":
                    return <AtSign className="h-4 w-4" />;
                  default:
                    return <CircleDot className="h-4 w-4" />;
                }
              };

              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSectionId(section.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium transition border-b-2 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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

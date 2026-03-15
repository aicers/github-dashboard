"use client";

import {
  AtSign,
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
import { useSyncStream } from "@/components/dashboard/hooks/use-sync-stream";
import {
  isUnauthorizedResponse,
  retryOnceAfterUnauthorized,
} from "@/components/dashboard/post-login-auth-recovery";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ActivityItem, IssueProjectStatus } from "@/lib/activity/types";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  ReviewRequestAttentionItem,
} from "@/lib/dashboard/attention";
import {
  buildFollowUpSummaries,
  type FollowUpSummary,
} from "@/lib/dashboard/attention-summaries";
import { cn } from "@/lib/utils";
import {
  FOLLOW_UP_SECTION_SET,
  formatTimestamp,
} from "./attention/attention-utils";
import { IssueList } from "./attention/issue-list";
import { MentionList } from "./attention/mention-list";
import {
  FollowUpOverview,
  PullRequestList,
  ReviewRequestList,
} from "./attention/pr-review-lists";

export { FollowUpDetailContent } from "./attention/follow-up-detail-content";

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
  const retryAfterUnauthorized = useCallback(
    (execute: () => Promise<Response>) =>
      retryOnceAfterUnauthorized({
        execute,
        refresh: () => {
          router.refresh();
        },
        shouldRetry: isUnauthorizedResponse,
      }),
    [router],
  );
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

  useSyncStream(
    useCallback((event) => {
      const updateAutoSyncState = () => {
        setAutomaticSyncActive(autoSyncRunIdsRef.current.size > 0);
      };
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
    }, []),
  );

  useEffect(() => {
    let canceled = false;
    const loadInitialSyncState = async () => {
      try {
        const response = await retryAfterUnauthorized(() =>
          fetch("/api/sync/status", {
            cache: "no-store",
          }),
        );
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
  }, [retryAfterUnauthorized]);

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
        "2일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      title: "2일 이상 (주말과 공휴일 제외) 응답이 없는 리뷰 요청",
      description:
        "주말과 공휴일을 제외하고 2일 이상 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 리뷰 요청을 모았습니다.",
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
        "2일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 멘션",
      title: "2일 이상 (주말과 공휴일 제외) 응답이 없는 멘션",
      description:
        "주말과 공휴일을 제외하고 2일 넘게 리뷰 제출, 댓글, 리액션 중 어떤 응답도 없었던 멘션을 모았습니다.",
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

"use client";

import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import {
  ISSUE_STATUS_LABEL_MAP,
  normalizeProjectFieldForComparison,
  PROJECT_FIELD_LABELS,
  type ProjectFieldKey,
} from "@/components/dashboard/activity/detail-shared";
import type { ActivityFilterState as FilterState } from "@/lib/activity/filter-state";
import type {
  ActivityItem,
  ActivityListResult,
  ActivityMentionWait,
  IssueProjectStatus,
} from "@/lib/activity/types";

type UseActivityItemActionsParams = {
  applied: FilterState;
  fetchActivity: (
    filters: FilterState,
    options?: { jumpToDate?: string | null; previousSync?: string | null },
  ) => Promise<void>;
  loadDetail: (id: string) => void;
  showNotification: (message: string) => void;
  updateDetailItem: (
    itemOrUpdater:
      | ActivityItem
      | { id: string; updater: (item: ActivityItem) => ActivityItem },
  ) => void;
  setListData: Dispatch<SetStateAction<ActivityListResult>>;
};

export function useActivityItemActions({
  applied,
  fetchActivity,
  loadDetail,
  showNotification,
  updateDetailItem,
  setListData,
}: UseActivityItemActionsParams) {
  const [updatingStatusIds, setUpdatingStatusIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [updatingProjectFieldIds, setUpdatingProjectFieldIds] = useState<
    Set<string>
  >(() => new Set<string>());
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  const handleResyncItem = useCallback(
    async (item: ActivityItem) => {
      const targetId = item.id;
      if (!targetId) {
        return;
      }
      setResyncingIds((current) => {
        if (current.has(targetId)) {
          return current;
        }
        const next = new Set(current);
        next.add(targetId);
        return next;
      });
      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(targetId)}/resync`,
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
        void fetchActivity(applied);
        void loadDetail(targetId);
      } catch (resyncError) {
        console.error("Failed to re-import activity item", resyncError);
        showNotification("GitHub에서 다시 불러오지 못했어요.");
      } finally {
        setResyncingIds((current) => {
          if (!current.has(targetId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(targetId);
          return next;
        });
      }
    },
    [applied, fetchActivity, loadDetail, showNotification],
  );

  const handleUpdateIssueStatus = useCallback(
    async (item: ActivityItem, nextStatus: IssueProjectStatus) => {
      if (item.type !== "issue") {
        return;
      }

      const currentStatus = item.issueProjectStatus ?? "no_status";
      if (currentStatus === nextStatus && nextStatus !== "no_status") {
        return;
      }

      setUpdatingStatusIds((current) => {
        if (current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(item.id);
        return next;
      });

      try {
        const response = await fetch(
          `/api/activity/${encodeURIComponent(item.id)}/status`,
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

        const payload = (await response.json()) as {
          item?: ActivityItem;
          error?: string;
          todoStatus?: IssueProjectStatus;
        };

        if (!response.ok) {
          if (payload.item) {
            const conflictItem = payload.item;
            setListData((current) => ({
              ...current,
              items: current.items.map((existing) =>
                existing.id === conflictItem.id ? conflictItem : existing,
              ),
            }));
            updateDetailItem(conflictItem);
          }

          let message = "상태를 변경하지 못했어요.";
          if (response.status === 409 && payload.todoStatus) {
            const todoLabel =
              ISSUE_STATUS_LABEL_MAP.get(payload.todoStatus) ??
              payload.todoStatus;
            message = `To-do 프로젝트 상태(${todoLabel})를 우선 적용하고 있어요.`;
          } else if (
            typeof payload.error === "string" &&
            payload.error.trim()
          ) {
            message = payload.error;
          }
          showNotification(message);
          return;
        }

        const updatedItem = payload.item ?? item;

        setListData((current) => ({
          ...current,
          items: current.items.map((existing) =>
            existing.id === updatedItem.id ? updatedItem : existing,
          ),
        }));
        updateDetailItem(updatedItem);

        const label =
          ISSUE_STATUS_LABEL_MAP.get(
            updatedItem.issueProjectStatus ?? "no_status",
          ) ?? "No Status";
        showNotification(`상태를 ${label}로 업데이트했어요.`);
      } catch (statusError) {
        console.error(statusError);
        showNotification("상태를 변경하지 못했어요.");
      } finally {
        setUpdatingStatusIds((current) => {
          if (!current.has(item.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [showNotification, updateDetailItem, setListData],
  );

  const handleUpdateProjectField = useCallback(
    async (
      item: ActivityItem,
      field: ProjectFieldKey,
      nextValue: string | null,
    ) => {
      if (item.type !== "issue") {
        return false;
      }

      const currentValue = (() => {
        switch (field) {
          case "priority":
            return item.issueTodoProjectPriority;
          case "weight":
            return item.issueTodoProjectWeight;
          case "initiationOptions":
            return item.issueTodoProjectInitiationOptions;
          case "startDate":
            return item.issueTodoProjectStartDate;
          default:
            return null;
        }
      })();
      const currentUpdatedAt = (() => {
        switch (field) {
          case "priority":
            return item.issueTodoProjectPriorityUpdatedAt;
          case "weight":
            return item.issueTodoProjectWeightUpdatedAt;
          case "initiationOptions":
            return item.issueTodoProjectInitiationOptionsUpdatedAt;
          case "startDate":
            return item.issueTodoProjectStartDateUpdatedAt;
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
        if (current.has(item.id)) {
          return current;
        }
        const next = new Set(current);
        next.add(item.id);
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
          `/api/activity/${encodeURIComponent(item.id)}/project-fields`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const payloadResponse = (await response.json()) as {
          item?: ActivityItem;
          error?: string;
          todoStatus?: IssueProjectStatus;
        };

        if (!response.ok) {
          if (payloadResponse.item) {
            const conflictItem = payloadResponse.item;
            setListData((current) => ({
              ...current,
              items: current.items.map((existing) =>
                existing.id === conflictItem.id ? conflictItem : existing,
              ),
            }));
            updateDetailItem(conflictItem);
          }

          let message = "값을 업데이트하지 못했어요.";
          if (response.status === 409 && payloadResponse.todoStatus) {
            const todoLabel =
              ISSUE_STATUS_LABEL_MAP.get(payloadResponse.todoStatus) ??
              payloadResponse.todoStatus;
            message = `To-do 프로젝트 상태(${todoLabel})를 우선 적용하고 있어요.`;
          } else if (
            typeof payloadResponse.error === "string" &&
            payloadResponse.error.trim()
          ) {
            message = payloadResponse.error;
          }
          showNotification(message);
          return false;
        }

        const updatedItem = payloadResponse.item ?? item;

        setListData((current) => ({
          ...current,
          items: current.items.map((existing) =>
            existing.id === updatedItem.id ? updatedItem : existing,
          ),
        }));
        updateDetailItem(updatedItem);

        const label = PROJECT_FIELD_LABELS[field];
        showNotification(`${label} 값을 업데이트했어요.`);
        return true;
      } catch (error) {
        console.error(error);
        showNotification("값을 업데이트하지 못했어요.");
        return false;
      } finally {
        setUpdatingProjectFieldIds((current) => {
          if (!current.has(item.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    },
    [showNotification, updateDetailItem, setListData],
  );

  const [pendingMentionOverrideKey, setPendingMentionOverrideKey] = useState<
    string | null
  >(null);

  const handleMentionOverride = useCallback(
    async (params: {
      itemId: string;
      commentId: string;
      mentionedUserId: string;
      state: "suppress" | "force" | "clear";
    }) => {
      const { itemId, commentId, mentionedUserId, state } = params;
      const overrideKey = `${commentId}::${mentionedUserId}`;
      setPendingMentionOverrideKey(overrideKey);

      try {
        const response = await fetch(
          "/api/attention/unanswered-mentions/manual",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              commentId,
              mentionedUserId,
              state,
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
            result.message ?? "응답 없는 멘션 상태를 업데이트하지 못했습니다.",
          );
        }

        const classification = result.result;
        const manualEffective = classification.manualDecisionIsStale
          ? null
          : classification.manualRequiresResponse;

        const computeNextAttention = (fallback: boolean) => {
          if (manualEffective === false) {
            return false;
          }
          if (manualEffective === true) {
            return true;
          }
          if (classification.requiresResponse !== null) {
            return classification.requiresResponse;
          }
          return fallback;
        };

        const updateMentionWait = (
          wait: ActivityMentionWait,
        ): ActivityMentionWait => {
          const waitUserId = wait.user?.id ?? wait.userId;
          if (wait.id !== commentId || waitUserId !== mentionedUserId) {
            return wait;
          }

          return {
            ...wait,
            manualRequiresResponse: manualEffective,
            manualRequiresResponseAt:
              classification.manualRequiresResponseAt ?? null,
            manualDecisionIsStale: classification.manualDecisionIsStale,
            classifierEvaluatedAt: classification.lastEvaluatedAt ?? null,
            requiresResponse:
              classification.requiresResponse ?? wait.requiresResponse,
          } satisfies ActivityMentionWait;
        };

        updateDetailItem({
          id: itemId,
          updater: (prev) =>
            ({
              ...prev,
              attention: {
                ...prev.attention,
                unansweredMention: computeNextAttention(
                  prev.attention.unansweredMention,
                ),
              },
              mentionWaits: prev.mentionWaits?.map((wait) =>
                updateMentionWait(wait),
              ),
            }) satisfies ActivityItem,
        });

        setListData((current) => ({
          ...current,
          items: current.items.map((listItem) => {
            if (listItem.id !== itemId) {
              return listItem;
            }
            return {
              ...listItem,
              attention: {
                ...listItem.attention,
                unansweredMention: computeNextAttention(
                  listItem.attention.unansweredMention,
                ),
              },
              mentionWaits: listItem.mentionWaits?.map((wait) =>
                updateMentionWait(wait),
              ),
            } satisfies ActivityItem;
          }),
        }));

        showNotification(
          state === "suppress"
            ? "이 멘션을 응답 필요 목록에서 제외했습니다."
            : state === "force"
              ? "이 멘션을 응답 필요 목록으로 고정했습니다."
              : "이 멘션에 대한 응답 필요 수동 설정을 해제했습니다.",
        );

        void fetchActivity(applied);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "응답 없는 멘션 상태를 업데이트하지 못했습니다.";
        showNotification(message);
      } finally {
        setPendingMentionOverrideKey(null);
      }
    },
    [applied, fetchActivity, showNotification, updateDetailItem, setListData],
  );

  return {
    updatingStatusIds,
    updatingProjectFieldIds,
    resyncingIds,
    pendingMentionOverrideKey,
    handleResyncItem,
    handleUpdateIssueStatus,
    handleUpdateProjectField,
    handleMentionOverride,
  };
}

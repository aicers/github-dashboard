"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchActivityDetail } from "@/lib/activity/client";
import type { ActivityItem, ActivityItemDetail } from "@/lib/activity/types";

export type ActivityDetailFetchOptions = {
  useMentionAi?: boolean;
};

export type ActivityDetailState = {
  openItemId: string | null;
  detailMap: Record<string, ActivityItemDetail | null>;
  loadingDetailIds: Set<string>;
  selectItem: (id: string) => void;
  closeItem: () => void;
  updateDetailItem: (
    nextItemOrUpdater:
      | ActivityItem
      | { id: string; updater: (item: ActivityItem) => ActivityItem },
  ) => void;
  loadDetail: (id: string) => Promise<void>;
  /** Remove cached details and loading entries for items not in `validIds`. */
  pruneStaleItems: (validIds: Set<string>) => void;
};

/**
 * Manages the detail-overlay lifecycle: fetching detail data, tracking
 * loading state per item, toggling the open item, and cleaning up
 * in-flight requests on close or unmount.
 */
export function useActivityDetailState(
  fetchOptions?: ActivityDetailFetchOptions,
): ActivityDetailState {
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

  const useMentionAi = fetchOptions?.useMentionAi;

  const loadDetail = useCallback(
    async (id: string) => {
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
          useMentionAi,
        });
        setDetailMap((current) => ({
          ...current,
          [id]: detail,
        }));
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        console.error(error);
        setDetailMap((current) => ({
          ...current,
          [id]: null,
        }));
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
    },
    [useMentionAi],
  );

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

  const updateDetailItem = useCallback(
    (
      nextItemOrUpdater:
        | ActivityItem
        | { id: string; updater: (item: ActivityItem) => ActivityItem },
    ) => {
      if ("updater" in nextItemOrUpdater) {
        const { id, updater } = nextItemOrUpdater;
        setDetailMap((current) => {
          const existing = current[id];
          if (!existing?.item) {
            return current;
          }
          return {
            ...current,
            [id]: { ...existing, item: updater(existing.item) },
          };
        });
      } else {
        const nextItem = nextItemOrUpdater;
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
      }
    },
    [],
  );

  const pruneStaleItems = useCallback((validIds: Set<string>) => {
    setOpenItemId((current) => {
      if (current && !validIds.has(current)) {
        const controller = controllersRef.current.get(current);
        controller?.abort();
        controllersRef.current.delete(current);
        return null;
      }
      return current;
    });

    setDetailMap((current) => {
      const entries = Object.entries(current);
      if (!entries.length) {
        return current;
      }
      let changed = false;
      const next: Record<string, ActivityItemDetail | null> = {};
      for (const [id, detail] of entries) {
        if (validIds.has(id)) {
          next[id] = detail;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });

    setLoadingDetailIds((current) => {
      if (!current.size) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
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
    pruneStaleItems,
  };
}

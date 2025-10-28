"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCcw } from "lucide-react";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  SyncLogStatus,
  SyncRunStatus,
  SyncRunStrategy,
  SyncRunSummaryEvent,
  SyncRunType,
  SyncStreamEvent,
} from "@/lib/sync/events";
import { cn } from "@/lib/utils";

type ConnectionState = "connecting" | "open" | "retrying";

type ResourceStatus = {
  logId: number;
  resource: string;
  status: SyncLogStatus;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type RunState = {
  runId: number;
  runType: SyncRunType;
  strategy: SyncRunStrategy;
  status: SyncRunStatus;
  since: string | null;
  until: string | null;
  startedAt: string;
  completedAt: string | null;
  summary?: SyncRunSummaryEvent;
  resources: Map<number, ResourceStatus>;
  resourceOrder: number[];
  updatedAt: string;
};

type ApiRunLog = {
  id: number;
  resource: string;
  status: SyncLogStatus;
  message?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

type ApiRun = {
  id: number;
  runType: SyncRunType;
  strategy: SyncRunStrategy;
  status: SyncRunStatus;
  since?: string | null;
  until?: string | null;
  startedAt: string;
  completedAt?: string | null;
  logs?: ApiRunLog[];
};

type ApiConfig = {
  unanswered_mentions_last_started_at?: unknown;
  unanswered_mentions_last_completed_at?: unknown;
  unanswered_mentions_last_success_at?: unknown;
  unanswered_mentions_last_status?: unknown;
  unanswered_mentions_last_error?: unknown;
};

type ApiStatusResponse = {
  success: boolean;
  status?: {
    runs?: ApiRun[];
    logs?: Array<{
      id: number;
      resource: string;
      status: SyncLogStatus;
      message?: string | null;
      started_at?: string | null;
      finished_at?: string | null;
    }>;
    config?: ApiConfig;
  };
  message?: string;
};

type MentionStatusValue =
  | "running"
  | "success"
  | "failed"
  | "partial"
  | "skipped";

type MentionBatchState = {
  status: "queued" | "success" | "failed";
  batchSize: number;
  commentIds: string[];
  timestamp: string;
  error?: string | null;
};

type MentionStatusState = {
  status: MentionStatusValue;
  startedAt?: string | null;
  completedAt?: string | null;
  successAt?: string | null;
  message?: string | null;
  totals?: {
    totalCandidates: number;
    attempted: number;
    updated: number;
    errors: number;
    skipped: number;
  };
  lastBatch?: MentionBatchState;
};

const RUN_TYPE_LABELS: Record<SyncRunType, string> = {
  automatic: "Automatic Sync",
  manual: "Manual Sync",
  backfill: "Backfill",
};

const STRATEGY_LABELS: Record<SyncRunStrategy, string> = {
  incremental: "Incremental",
  backfill: "Backfill",
};

const STATUS_LABELS: Record<SyncRunStatus, string> = {
  running: "In progress",
  success: "Completed",
  failed: "Failed",
};

const STATUS_STYLES: Record<SyncRunStatus, string> = {
  running:
    "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/50 dark:bg-amber-500/10 dark:text-amber-200",
  success:
    "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-200",
  failed:
    "border border-red-200 bg-red-50 text-red-700 dark:border-red-400/60 dark:bg-red-500/10 dark:text-red-200",
};

const LOG_STATUS_ICONS: Record<SyncLogStatus, JSX.Element> = {
  running: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  success: <CheckCircle2 className="h-3.5 w-3.5" />,
  failed: <AlertCircle className="h-3.5 w-3.5" />,
};

const LOG_STATUS_STYLES: Record<SyncLogStatus, string> = {
  running: "text-amber-600 dark:text-amber-300",
  success: "text-emerald-600 dark:text-emerald-300",
  failed: "text-red-600 dark:text-red-300",
};

const MENTION_STATUS_LABELS: Record<MentionStatusValue, string> = {
  running: "Running",
  success: "Success",
  failed: "Failed",
  partial: "Partial",
  skipped: "Skipped",
};

function normalizeTimestampValue(value: unknown): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function isMentionStatusValue(value: unknown): value is MentionStatusValue {
  return (
    typeof value === "string" &&
    ["running", "success", "failed", "partial", "skipped"].includes(value)
  );
}

const STALE_RUN_TIMEOUT_MS = 5 * 60 * 1000;

function toResourceStatus(log: ApiRunLog): ResourceStatus {
  return {
    logId: log.id,
    resource: log.resource,
    status: log.status,
    message: log.message ?? null,
    startedAt: log.startedAt ?? null,
    finishedAt: log.finishedAt ?? null,
  };
}

function formatTimestamp(value: string | null, fallback = "-") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date.toLocaleString();
}

function formatDuration(start: string | null, end: string | null) {
  if (!start) {
    return null;
  }

  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes >= 1) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function createRunState(run: ApiRun): RunState {
  const resources = new Map<number, ResourceStatus>();
  const resourceOrder: number[] = [];

  for (const log of run.logs ?? []) {
    const entry = toResourceStatus(log);
    resources.set(entry.logId, entry);
    resourceOrder.push(entry.logId);
  }

  return {
    runId: run.id,
    runType: run.runType,
    strategy: run.strategy,
    status: run.status,
    since: run.since ?? null,
    until: run.until ?? null,
    startedAt: run.startedAt,
    completedAt: run.completedAt ?? null,
    resources,
    resourceOrder,
    updatedAt: run.completedAt ?? run.startedAt,
  };
}

function mergeResource(
  existing: ResourceStatus | undefined,
  update: ResourceStatus,
) {
  if (!existing) {
    return update;
  }

  return {
    ...existing,
    ...update,
  };
}

export function SyncStatusPanel() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [runs, setRuns] = useState<Map<number, RunState>>(new Map());
  const [runOrder, setRunOrder] = useState<number[]>([]);
  const [orphanLogs, setOrphanLogs] = useState<ResourceStatus[]>([]);
  const [mentionStatus, setMentionStatus] = useState<MentionStatusState | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const upsertRun = useCallback(
    (runId: number, updater: (current: RunState | null) => RunState | null) => {
      setRuns((previous) => {
        const current = previous.get(runId) ?? null;
        const nextValue = updater(current);
        if (nextValue === current) {
          return previous;
        }

        const clone = new Map(previous);
        if (nextValue) {
          clone.set(runId, nextValue);
        } else {
          clone.delete(runId);
        }
        return clone;
      });
    },
    [],
  );

  const ensureRunOrder = useCallback((runId: number) => {
    setRunOrder((previous) => {
      const filtered = previous.filter((value) => value !== runId);
      return [runId, ...filtered].slice(0, 5);
    });
  }, []);

  const appendOrphanLog = useCallback((log: ResourceStatus) => {
    setOrphanLogs((previous) => {
      const filtered = previous.filter((entry) => entry.logId !== log.logId);
      return [log, ...filtered].slice(0, 10);
    });
  }, []);

  const fetchInitialStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/sync/status", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch sync status (${response.status})`);
      }

      const payload = (await response.json()) as ApiStatusResponse;
      if (!payload.success || !payload.status) {
        throw new Error(payload.message ?? "Unable to load sync status.");
      }

      const nextRuns = new Map<number, RunState>();
      const nextOrder: number[] = [];
      for (const run of payload.status.runs ?? []) {
        const state = createRunState(run);
        nextRuns.set(run.id, state);
        nextOrder.push(run.id);
      }

      setRuns(nextRuns);
      setRunOrder(nextOrder);

      const orphanEntries: ResourceStatus[] = [];
      for (const log of payload.status.logs ?? []) {
        orphanEntries.push({
          logId: log.id,
          resource: log.resource,
          status: log.status,
          message: log.message ?? null,
          startedAt: log.started_at ?? null,
          finishedAt: log.finished_at ?? null,
        });
      }

      setOrphanLogs(orphanEntries.slice(0, 10));

      if (payload.status.config) {
        const config = payload.status.config;
        const startedAt = normalizeTimestampValue(
          config.unanswered_mentions_last_started_at,
        );
        const completedAt = normalizeTimestampValue(
          config.unanswered_mentions_last_completed_at,
        );
        const successAt = normalizeTimestampValue(
          config.unanswered_mentions_last_success_at,
        );
        const statusValue = isMentionStatusValue(
          config.unanswered_mentions_last_status,
        )
          ? config.unanswered_mentions_last_status
          : undefined;
        const message =
          typeof config.unanswered_mentions_last_error === "string"
            ? config.unanswered_mentions_last_error
            : null;

        if (statusValue || startedAt || completedAt || successAt || message) {
          setMentionStatus((previous) => ({
            status: statusValue ?? previous?.status ?? "skipped",
            startedAt: startedAt ?? previous?.startedAt ?? null,
            completedAt: completedAt ?? previous?.completedAt ?? null,
            successAt: successAt ?? previous?.successAt ?? null,
            message: message ?? previous?.message ?? null,
            totals: previous?.totals,
            lastBatch: previous?.lastBatch,
          }));
        }
      }
    } catch (cause) {
      console.error("[sync-status-panel] Failed to load initial status", cause);
      setError(
        cause instanceof Error ? cause.message : "Could not load sync status.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleStreamEvent = useCallback(
    (event: SyncStreamEvent) => {
      if (event.type === "heartbeat") {
        setLastHeartbeat(event.timestamp);
        return;
      }

      if (event.type === "unanswered-mentions-status") {
        setMentionStatus((previous) => ({
          status: event.status,
          startedAt: event.startedAt ?? previous?.startedAt ?? null,
          completedAt: event.completedAt ?? previous?.completedAt ?? null,
          successAt: event.successAt ?? previous?.successAt ?? null,
          message: event.message ?? previous?.message ?? null,
          totals: event.totals ?? previous?.totals,
          lastBatch: previous?.lastBatch,
        }));
        return;
      }

      if (event.type === "unanswered-mentions-batch") {
        setMentionStatus((previous) => ({
          status: previous?.status ?? "running",
          startedAt: previous?.startedAt ?? null,
          completedAt: previous?.completedAt ?? null,
          successAt: previous?.successAt ?? null,
          message: previous?.message ?? null,
          totals: previous?.totals,
          lastBatch: {
            status: event.status,
            batchSize: event.batchSize,
            commentIds: event.commentIds,
            timestamp: event.timestamp,
            error: event.error ?? null,
          },
        }));
        return;
      }

      if (event.type === "run-started") {
        upsertRun(event.runId, () => ({
          runId: event.runId,
          runType: event.runType,
          strategy: event.strategy,
          status: event.status,
          since: event.since ?? null,
          until: event.until ?? null,
          startedAt: event.startedAt,
          completedAt: null,
          resources: new Map(),
          resourceOrder: [],
          updatedAt: event.startedAt,
        }));
        ensureRunOrder(event.runId);
        return;
      }

      if (event.type === "run-status") {
        upsertRun(event.runId, (current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            status: event.status,
            completedAt: event.completedAt ?? current.completedAt,
            updatedAt: event.completedAt ?? current.updatedAt,
          };
        });
        ensureRunOrder(event.runId);
        return;
      }

      if (event.type === "run-completed") {
        upsertRun(event.runId, (current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            status: "success",
            completedAt: event.completedAt,
            summary: event.summary,
            updatedAt: event.completedAt,
          };
        });
        ensureRunOrder(event.runId);
        return;
      }

      if (event.type === "run-failed") {
        upsertRun(event.runId, (current) => {
          if (!current) {
            return current;
          }
          return {
            ...current,
            status: "failed",
            completedAt: event.finishedAt,
            updatedAt: event.finishedAt,
          };
        });
        ensureRunOrder(event.runId);
        appendOrphanLog({
          logId: Number.MAX_SAFE_INTEGER - event.runId,
          resource: "run",
          status: "failed",
          message: event.error,
          startedAt: null,
          finishedAt: event.finishedAt,
        });
        return;
      }

      if (event.type === "log-started") {
        if (event.runId === null) {
          appendOrphanLog({
            logId: event.logId,
            resource: event.resource,
            status: event.status,
            message: event.message ?? null,
            startedAt: event.startedAt,
            finishedAt: null,
          });
          return;
        }

        upsertRun(event.runId, (current) => {
          if (!current) {
            return current;
          }

          const resource = mergeResource(current.resources.get(event.logId), {
            logId: event.logId,
            resource: event.resource,
            status: event.status,
            message: event.message ?? null,
            startedAt: event.startedAt,
            finishedAt: null,
          });

          const nextResources = new Map(current.resources);
          nextResources.set(event.logId, resource);
          const nextOrder = current.resourceOrder.includes(event.logId)
            ? [...current.resourceOrder]
            : [event.logId, ...current.resourceOrder];

          return {
            ...current,
            resources: nextResources,
            resourceOrder: nextOrder,
            updatedAt: event.startedAt,
          };
        });
        return;
      }

      if (event.type === "log-updated") {
        if (event.runId === null) {
          appendOrphanLog({
            logId: event.logId,
            resource: event.resource,
            status: event.status,
            message: event.message ?? null,
            startedAt: null,
            finishedAt: event.finishedAt,
          });
          return;
        }

        upsertRun(event.runId, (current) => {
          if (!current) {
            return current;
          }

          const existing = current.resources.get(event.logId);
          const resource = mergeResource(existing, {
            logId: event.logId,
            resource: event.resource,
            status: event.status,
            message: event.message ?? null,
            startedAt: existing?.startedAt ?? null,
            finishedAt: event.finishedAt ?? null,
          });

          const nextResources = new Map(current.resources);
          nextResources.set(event.logId, resource);

          return {
            ...current,
            resources: nextResources,
            updatedAt: event.finishedAt,
          };
        });
      }
    },
    [appendOrphanLog, ensureRunOrder, upsertRun],
  );

  useEffect(() => {
    void fetchInitialStatus();
  }, [fetchInitialStatus]);

  useEffect(() => {
    let isActive = true;
    let source: EventSource | null = null;

    const connect = () => {
      if (!isActive) {
        return;
      }

      if (source) {
        source.close();
      }

      setConnectionState("connecting");
      source = new EventSource("/api/sync/stream");

      source.onopen = () => {
        if (!isActive) {
          return;
        }
        setConnectionState("open");
        void fetchInitialStatus();
      };

      source.onerror = () => {
        if (!isActive) {
          return;
        }

        setConnectionState("retrying");
        // EventSource will automatically retry; no explicit reconnect needed.
      };

      const syncListener = (event: MessageEvent<string>) => {
        if (!isActive) {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as SyncStreamEvent;
          handleStreamEvent(payload);
        } catch (cause) {
          console.error("[sync-status-panel] Failed to parse sync event", {
            cause,
            data: event.data,
          });
        }
      };

      const heartbeatListener = (event: MessageEvent<string>) => {
        if (!isActive) {
          return;
        }
        try {
          const payload = JSON.parse(event.data) as { timestamp?: string };
          if (payload?.timestamp) {
            setLastHeartbeat(payload.timestamp);
          }
        } catch (cause) {
          console.error("[sync-status-panel] Failed to parse heartbeat event", {
            cause,
            data: event.data,
          });
        }
      };

      source.addEventListener("sync", syncListener);
      source.addEventListener("heartbeat", heartbeatListener);
    };

    connect();

    return () => {
      isActive = false;
      if (source) {
        source.close();
        source = null;
      }
    };
  }, [fetchInitialStatus, handleStreamEvent]);

  const activeRun = useMemo(() => {
    for (const runId of runOrder) {
      const run = runs.get(runId);
      if (run?.status === "running") {
        return run;
      }
    }
    return null;
  }, [runOrder, runs]);

  useEffect(() => {
    if (!activeRun) {
      setIsExpanded(false);
    }
  }, [activeRun]);

  const heartbeatLabel = useMemo(() => {
    if (!lastHeartbeat) {
      return "waiting for heartbeat";
    }

    const date = new Date(lastHeartbeat);
    if (Number.isNaN(date.getTime())) {
      return "heartbeat received";
    }

    const diffMs = Date.now() - date.getTime();
    if (diffMs < 30_000) {
      return "live";
    }
    return `last heartbeat ${Math.round(diffMs / 1000)}s ago`;
  }, [lastHeartbeat]);

  const connectionLabel = useMemo(() => {
    if (connectionState === "open") {
      return "Connected";
    }
    if (connectionState === "retrying") {
      return "Reconnecting…";
    }
    return "Connecting…";
  }, [connectionState]);

  const progressSummary = useMemo(() => {
    if (!activeRun) {
      return "Preparing sync…";
    }
    const total = activeRun.resourceOrder.length;
    if (total === 0) {
      return "Waiting for resource updates…";
    }

    let completed = 0;
    let failed = 0;
    let running = 0;
    for (const logId of activeRun.resourceOrder) {
      const entry = activeRun.resources.get(logId);
      if (!entry) {
        continue;
      }
      if (entry.status === "success") {
        completed += 1;
      } else if (entry.status === "failed") {
        failed += 1;
      } else {
        running += 1;
      }
    }

    const parts = [`${completed}/${total} completed`];
    if (running > 0) {
      parts.push(`${running} running`);
    }
    if (failed > 0) {
      parts.push(`${failed} failed`);
    }
    return parts.join(" · ");
  }, [activeRun]);

  const secondaryLabel = useMemo(() => {
    return `${connectionLabel} · ${heartbeatLabel}`;
  }, [connectionLabel, heartbeatLabel]);

  const runLastUpdateTime = useMemo(() => {
    if (!activeRun) {
      return null;
    }
    const timestamp =
      activeRun.updatedAt ?? activeRun.completedAt ?? activeRun.startedAt;
    const parsed = timestamp ? new Date(timestamp) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }, [activeRun]);

  const isRunFresh = useMemo(() => {
    if (!runLastUpdateTime) {
      return false;
    }
    return Date.now() - runLastUpdateTime.getTime() <= STALE_RUN_TIMEOUT_MS;
  }, [runLastUpdateTime]);

  if (!activeRun || !isRunFresh) {
    return null;
  }

  return (
    <section className="mb-6">
      <div className="rounded-lg border border-border/60 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-slate-800"
          aria-expanded={isExpanded}
        >
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-primary/10 p-2 text-primary">
              <RefreshCcw className="h-4 w-4 animate-spin" aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                Sync in progress
              </span>
              <span className="text-xs text-muted-foreground">
                {secondaryLabel} · {progressSummary}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary",
                isExpanded ? "opacity-80" : "opacity-100",
              )}
            >
              {isExpanded ? "Hide details" : "View details"}
            </span>
          </div>
        </button>
        {isExpanded ? (
          <div className="border-t border-border/60 px-4 py-4 dark:border-slate-700">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {connectionLabel} · {heartbeatLabel}
              </span>
              <span>Started {formatTimestamp(activeRun.startedAt)}</span>
            </div>
            {error ? (
              <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200">
                {error}
              </p>
            ) : null}
            {isLoading ? (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading sync status…
              </div>
            ) : null}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-foreground">
                    {RUN_TYPE_LABELS[activeRun.runType]}
                    <span className="text-muted-foreground">
                      {" "}
                      · {STRATEGY_LABELS[activeRun.strategy]}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Elapsed {formatDuration(activeRun.startedAt, null) ?? "-"}
                  </span>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    STATUS_STYLES[activeRun.status],
                  )}
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {STATUS_LABELS[activeRun.status]}
                </span>
              </div>
              <div className="rounded-md border border-border/50 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                {activeRun.resourceOrder.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Waiting for resource updates…
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeRun.resourceOrder.map((logId) => {
                      const resource = activeRun.resources.get(logId);
                      if (!resource) {
                        return null;
                      }
                      const icon = LOG_STATUS_ICONS[resource.status];
                      return (
                        <li
                          key={logId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/40 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-950/40"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                LOG_STATUS_STYLES[resource.status],
                                "flex items-center gap-1 font-medium",
                              )}
                            >
                              {icon}
                              {resource.resource}
                            </span>
                            <span className="text-muted-foreground">
                              {resource.status === "running"
                                ? "processing…"
                                : resource.status === "success"
                                  ? "completed"
                                  : "failed"}
                            </span>
                          </div>
                          <div className="flex flex-col text-right text-muted-foreground">
                            <span>
                              {resource.startedAt
                                ? `Started ${formatTimestamp(resource.startedAt)}`
                                : ""}
                            </span>
                            {resource.finishedAt ? (
                              <span>
                                Finished {formatTimestamp(resource.finishedAt)}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {mentionStatus ? (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs text-primary dark:border-primary/30 dark:bg-primary/10">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-primary">
                    <span className="font-semibold">
                      Unanswered mentions ·{" "}
                      {MENTION_STATUS_LABELS[mentionStatus.status]}
                    </span>
                    <span className="text-muted-foreground">
                      Started {formatTimestamp(mentionStatus.startedAt ?? null)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-col gap-1 text-muted-foreground">
                    <span>
                      Last success:{" "}
                      {formatTimestamp(mentionStatus.successAt ?? null)}
                    </span>
                    <span>
                      Last completed:{" "}
                      {formatTimestamp(mentionStatus.completedAt ?? null)}
                    </span>
                    {mentionStatus.totals ? (
                      <span>
                        Totals · candidates{" "}
                        {mentionStatus.totals.totalCandidates}, attempted{" "}
                        {mentionStatus.totals.attempted}, updated{" "}
                        {mentionStatus.totals.updated}, errors{" "}
                        {mentionStatus.totals.errors}, skipped{" "}
                        {mentionStatus.totals.skipped}
                      </span>
                    ) : null}
                    {mentionStatus.lastBatch ? (
                      <span>
                        Last batch ({mentionStatus.lastBatch.batchSize}){" "}
                        {mentionStatus.lastBatch.status}
                        {" · "}
                        {formatTimestamp(mentionStatus.lastBatch.timestamp)}
                        {mentionStatus.lastBatch.error
                          ? ` · ${mentionStatus.lastBatch.error}`
                          : ""}
                      </span>
                    ) : null}
                    {mentionStatus.message ? (
                      <span className="text-red-600 dark:text-red-300">
                        {mentionStatus.message}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {activeRun.summary ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <span className="font-medium">Totals:</span>{" "}
                  {[
                    ["Issues", activeRun.summary.counts.issues],
                    ["Discussions", activeRun.summary.counts.discussions],
                    ["Pull Requests", activeRun.summary.counts.pullRequests],
                    ["Reviews", activeRun.summary.counts.reviews],
                    ["Comments", activeRun.summary.counts.comments],
                  ]
                    .filter(([, count]) => Number(count) > 0)
                    .map(([label, count]) => `${label} ${count}`)
                    .join(" · ") || "No changes recorded."}
                </div>
              ) : null}
            </div>
            {orphanLogs.length > 0 ? (
              <div className="mt-4 border-t border-border/40 pt-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent log updates
                </span>
                <ul className="mt-2 flex flex-col gap-2">
                  {orphanLogs.map((log) => (
                    <li
                      key={log.logId}
                      className="flex items-center justify-between rounded border border-border/40 bg-slate-50 px-3 py-2 text-xs text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            LOG_STATUS_STYLES[log.status],
                            "flex items-center gap-1 font-medium",
                          )}
                        >
                          {LOG_STATUS_ICONS[log.status]}
                          {log.resource}
                        </span>
                        {log.message ? (
                          <span className="truncate max-w-[14rem]">
                            {log.message}
                          </span>
                        ) : null}
                      </div>
                      <span>
                        {log.finishedAt
                          ? formatTimestamp(log.finishedAt)
                          : log.startedAt
                            ? formatTimestamp(log.startedAt)
                            : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

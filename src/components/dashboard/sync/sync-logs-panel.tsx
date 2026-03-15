"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type DateTimeDisplayFormat,
  formatDateTime as formatDateTimeDisplay,
} from "@/lib/date-time-format";
import type { SyncStatus } from "@/lib/sync/service";

type RunLogEntry = {
  id: number;
  resource: string;
  status: "success" | "failed" | "running";
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type RunGroup = {
  id: string;
  runId: number | null;
  runType: "automatic" | "manual" | "backfill" | "legacy";
  strategy: string | null;
  status: "success" | "failed" | "running";
  since: string | null;
  until: string | null;
  startedAt: string | null;
  completedAt: string | null;
  logs: RunLogEntry[];
};

const RUN_TYPE_LABELS: Record<RunGroup["runType"], string> = {
  automatic: "자동 동기화",
  manual: "수동 동기화",
  backfill: "백필",
  legacy: "이전 로그",
};

const statusColors: Record<string, string> = {
  success: "text-emerald-600",
  failed: "text-red-600",
  running: "text-amber-600",
};

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function compareAsc(a: string | null, b: string | null) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  const aTime = Number.isNaN(new Date(a).getTime()) ? 0 : new Date(a).getTime();
  const bTime = Number.isNaN(new Date(b).getTime()) ? 0 : new Date(b).getTime();
  return aTime - bTime;
}

function compareDesc(a: string | null, b: string | null) {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  const aTime = Number.isNaN(new Date(a).getTime()) ? 0 : new Date(a).getTime();
  const bTime = Number.isNaN(new Date(b).getTime()) ? 0 : new Date(b).getTime();
  return bTime - aTime;
}

function buildRunGroups(status: SyncStatus): RunGroup[] {
  const groups: RunGroup[] = [];
  const coveredLogIds = new Set<number>();

  for (const run of status.runs ?? []) {
    const logs = [...(run.logs ?? [])]
      .map((log) => ({
        id: log.id,
        resource: log.resource,
        status: log.status,
        message: log.message ?? null,
        startedAt: log.startedAt ?? null,
        finishedAt: log.finishedAt ?? null,
      }))
      .sort((a, b) => compareAsc(a.startedAt, b.startedAt));

    for (const log of logs) {
      coveredLogIds.add(log.id);
    }

    groups.push({
      id: `run-${run.id}`,
      runId: run.id,
      runType: run.runType,
      strategy: run.strategy,
      status: run.status,
      since: run.since ?? null,
      until: run.until ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      logs,
    });
  }

  const legacyBuckets = new Map<
    string,
    { runId: number | null; logs: RunLogEntry[] }
  >();

  for (const log of status.logs ?? []) {
    if (coveredLogIds.has(log.id)) {
      continue;
    }

    const key =
      log.run_id !== null && log.run_id !== undefined
        ? `run-${log.run_id}`
        : `legacy-${log.id}`;
    const bucket = legacyBuckets.get(key) ?? {
      runId: log.run_id ?? null,
      logs: [],
    };

    bucket.logs.push({
      id: log.id,
      resource: log.resource,
      status: log.status,
      message: log.message ?? null,
      startedAt: log.started_at ?? null,
      finishedAt: log.finished_at ?? null,
    });
    legacyBuckets.set(key, bucket);
  }

  let legacyCounter = 0;
  for (const bucket of legacyBuckets.values()) {
    const logs = bucket.logs.sort((a, b) =>
      compareAsc(a.startedAt, b.startedAt),
    );
    let status: RunGroup["status"] = "success";
    if (logs.some((log) => log.status === "failed")) {
      status = "failed";
    } else if (logs.some((log) => log.status === "running")) {
      status = "running";
    }

    const startedAt = logs.find((log) => log.startedAt)?.startedAt ?? null;
    const completedAt =
      [...logs].reverse().find((log) => log.finishedAt)?.finishedAt ?? null;

    groups.push({
      id: `legacy-${legacyCounter++}`,
      runId: bucket.runId,
      runType: bucket.runId ? "automatic" : "legacy",
      strategy: bucket.runId ? "incremental" : null,
      status,
      since: null,
      until: null,
      startedAt,
      completedAt,
      logs,
    });
  }

  groups.sort((a, b) => compareDesc(a.startedAt, b.startedAt));
  return groups;
}

type SyncLogsPanelProps = {
  status: SyncStatus;
  timeZone: string | null;
  dateTimeFormat: DateTimeDisplayFormat;
};

export function SyncLogsPanel({
  status,
  timeZone,
  dateTimeFormat,
}: SyncLogsPanelProps) {
  const runGroups = useMemo(() => buildRunGroups(status), [status]);

  const formatDateTime = useMemo(() => {
    return (value?: string | null) =>
      formatDateTimeDisplay(value, timeZone ?? undefined, dateTimeFormat);
  }, [dateTimeFormat, timeZone]);

  function formatRange(startIso: string | null, endIso: string | null) {
    const start = formatDateTime(startIso);
    const end = formatDateTime(endIso);

    if (start && end) {
      return `${start} → ${end}`;
    }

    if (start) {
      return `${start} → -`;
    }

    if (end) {
      return `- → ${end}`;
    }

    return "-";
  }

  return (
    <section
      id="logs-section"
      className="mt-4 space-y-4"
      aria-labelledby="sync-logs-heading"
    >
      <h3 id="sync-logs-heading" className="sr-only">
        동기화 로그
      </h3>
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle>최근 동기화 로그</CardTitle>
          <CardDescription>
            각 리소스의 실행 상태와 메시지를 확인합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {runGroups.length === 0 ? (
            <p className="text-muted-foreground">로그가 없습니다.</p>
          ) : (
            runGroups.map((run) => (
              <div
                key={run.id}
                className="space-y-3 rounded-lg border border-border/60 bg-background px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">
                      {RUN_TYPE_LABELS[run.runType] ?? "동기화"} •{" "}
                      {formatRange(run.startedAt, run.completedAt)}
                    </span>
                    {run.since || run.until ? (
                      <span className="text-xs text-muted-foreground">
                        실행 범위: {formatRange(run.since, run.until)}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`text-xs font-semibold ${statusColors[run.status] ?? ""}`}
                  >
                    {capitalize(run.status)}
                  </span>
                </div>
                <div className="space-y-2">
                  {run.logs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      리소스 로그가 없습니다.
                    </p>
                  ) : (
                    run.logs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-md border border-border/50 bg-muted/10 px-3 py-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase text-muted-foreground">
                            {log.resource}
                          </span>
                          <span
                            className={`text-xs font-semibold ${statusColors[log.status] ?? ""}`}
                          >
                            {capitalize(log.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatRange(log.startedAt, log.finishedAt)}
                        </p>
                        {log.message ? (
                          <p className="mt-1 text-sm text-foreground">
                            {log.message}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

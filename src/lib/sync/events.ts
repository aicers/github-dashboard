export type SyncRunStatus = "running" | "success" | "failed";
export type SyncRunType = "automatic" | "manual" | "backfill";
export type SyncRunStrategy = "incremental" | "backfill";
export type SyncLogStatus = "running" | "success" | "failed";

export type SyncRunSummaryEvent = {
  counts: {
    issues: number;
    discussions: number;
    pullRequests: number;
    reviews: number;
    comments: number;
  };
  timestamps?: Record<string, string | null>;
};

export type SyncStreamEvent =
  | {
      type: "run-started";
      runId: number;
      runType: SyncRunType;
      strategy: SyncRunStrategy;
      status: SyncRunStatus;
      since: string | null;
      until: string | null;
      startedAt: string;
    }
  | {
      type: "run-status";
      runId: number;
      status: SyncRunStatus;
      completedAt: string | null;
    }
  | {
      type: "run-completed";
      runId: number;
      status: "success";
      completedAt: string;
      summary: SyncRunSummaryEvent;
    }
  | {
      type: "run-failed";
      runId: number;
      status: "failed";
      finishedAt: string;
      error: string;
    }
  | {
      type: "log-started";
      logId: number;
      runId: number | null;
      resource: string;
      status: SyncLogStatus;
      message: string | null;
      startedAt: string;
    }
  | {
      type: "log-updated";
      logId: number;
      runId: number | null;
      resource: string;
      status: SyncLogStatus;
      message: string | null;
      finishedAt: string;
    }
  | {
      type: "unanswered-mentions-status";
      status: "running" | "success" | "failed" | "partial" | "skipped";
      startedAt?: string | null;
      completedAt?: string | null;
      successAt?: string | null;
      totals?: {
        totalCandidates: number;
        attempted: number;
        updated: number;
        errors: number;
        skipped: number;
      };
      message?: string | null;
    }
  | {
      type: "unanswered-mentions-batch";
      status: "queued" | "success" | "failed";
      batchSize: number;
      commentIds: string[];
      timestamp: string;
      error?: string | null;
    }
  | {
      type: "heartbeat";
      timestamp: string;
    };

export type SyncStreamListener = (event: SyncStreamEvent) => void;

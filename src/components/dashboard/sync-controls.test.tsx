import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __syncControlsTestHelpers,
  SyncControls,
} from "@/components/dashboard/sync-controls";
import type { ActivityCacheRefreshResult } from "@/lib/activity/cache";
import type { BackfillChunkSuccess, SyncStatus } from "@/lib/sync/service";
import {
  createJsonResponse,
  fetchMock,
  mockFetchJsonOnce,
  mockFetchOnce,
  setDefaultFetchHandler,
} from "../../../tests/setup/mock-fetch";

const routerRefreshMock = vi.fn();
const mockActivityCacheSummary: ActivityCacheRefreshResult = {
  filterOptions: {
    cacheKey: "activity-filter-options",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 5,
    metadata: {
      counts: {
        repositories: 3,
        labels: 10,
        users: 4,
        issueTypes: 2,
        milestones: 1,
      },
    },
  },
  issueLinks: {
    cacheKey: "activity-issue-links",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 12,
    metadata: { linkCount: 12 },
  },
  pullRequestLinks: {
    cacheKey: "activity-pull-request-links",
    generatedAt: "2024-04-01T00:00:00.000Z",
    syncRunId: 1,
    itemCount: 7,
    metadata: { linkCount: 7 },
  },
};
const mockActivityCacheResponse = {
  success: true,
  caches: mockActivityCacheSummary,
};

const mockIssueStatusAutomationResponse = {
  success: true,
  summary: null,
};

function findRequest(substring: string, method?: string): Request | null {
  const call = fetchMock.mock.calls.find(([entry]) => {
    const request = entry as Request;
    return (
      request.url.includes(substring) &&
      (method ? request.method === method : true)
    );
  });
  return call ? (call[0] as Request) : null;
}

function hasRequest(substring: string, method?: string): boolean {
  return findRequest(substring, method) !== null;
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
  usePathname: () => "/dashboard/sync",
}));

function buildStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    config: {
      id: "default",
      org_name: "acme",
      auto_sync_enabled: false,
      sync_interval_minutes: 60,
      timezone: "UTC",
      week_start: "monday",
      excluded_repository_ids: [],
      excluded_user_ids: [],
      allowed_team_slugs: [],
      allowed_user_ids: [],
      date_time_format: "auto",
      last_sync_started_at: null,
      last_sync_completed_at: null,
      last_successful_sync_at: null,
      backup_enabled: true,
      backup_hour_local: 2,
      backup_timezone: "UTC",
      backup_last_started_at: null,
      backup_last_completed_at: null,
      backup_last_status: "idle",
      backup_last_error: null,
      ...(overrides.config ?? {}),
    },
    runs: overrides.runs ?? [],
    logs: overrides.logs ?? [],
    dataFreshness: overrides.dataFreshness ?? null,
    backup: overrides.backup ?? {
      directory: "/var/backups/github-dashboard",
      retentionCount: 3,
      schedule: {
        enabled: true,
        hourLocal: 2,
        timezone: "UTC",
        nextRunAt: null,
        lastStartedAt: null,
        lastCompletedAt: null,
        lastStatus: "idle",
        lastError: null,
      },
      records: [],
    },
  };
}

function createChunk(
  overrides: Partial<BackfillChunkSuccess> = {},
): BackfillChunkSuccess {
  return {
    status: "success",
    since: "2024-04-01T00:00:00.000Z",
    until: "2024-04-02T00:00:00.000Z",
    startedAt: "2024-04-01T00:00:01.000Z",
    completedAt: "2024-04-01T00:05:00.000Z",
    summary: {
      repositoriesProcessed: 1,
      counts: {
        issues: 1,
        discussions: 1,
        pullRequests: 2,
        reviews: 3,
        comments: 4,
      },
      timestamps: {
        repositories: null,
        issues: null,
        discussions: null,
        pullRequests: null,
        reviews: null,
        comments: null,
      },
    },
    ...overrides,
  };
}

const { parseApiResponse, formatBytes, toIsoString } =
  __syncControlsTestHelpers;

describe("sync controls helpers", () => {
  it("throws a descriptive error when the API response is empty", async () => {
    const response = new Response("", { status: 200, statusText: "OK" });
    await expect(parseApiResponse(response)).rejects.toThrow(
      "서버에서 빈 응답이 반환되었습니다. (200 OK)",
    );
  });

  it("throws a descriptive error when the API response is not JSON", async () => {
    const response = new Response("<html></html>", {
      status: 502,
      statusText: "Bad Gateway",
    });
    await expect(parseApiResponse(response)).rejects.toThrow(
      "서버 응답을 해석하지 못했습니다. (502 Bad Gateway)",
    );
  });

  it("formats bytes into human readable strings", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 MB");
    expect(formatBytes(10_485_760)).toBe("10.0 GB");
  });

  it("normalizes ISO strings through toIsoString helper", () => {
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString("2024-01-01T00:00:00.000Z")).toBe(
      "2024-01-01T00:00:00.000Z",
    );
    const iso = toIsoString(new Date("2024-01-01T12:34:56.000Z"));
    expect(iso).toBe("2024-01-01T12:34:56.000Z");
  });
});

describe("SyncControls", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    fetchMock.mockReset();
    setDefaultFetchHandler((request) => {
      if (request.url.includes("/api/activity/cache/refresh")) {
        return createJsonResponse(mockActivityCacheResponse);
      }
      if (request.url.includes("/api/activity/status-automation")) {
        return createJsonResponse(mockIssueStatusAutomationResponse);
      }
      return createJsonResponse({ success: true });
    });

    mockFetchJsonOnce(mockActivityCacheResponse);
    mockFetchJsonOnce(mockIssueStatusAutomationResponse);
  });

  it("renders the overview controls and navigation tabs", () => {
    const status = buildStatus({
      config: {
        auto_sync_enabled: true,
        sync_interval_minutes: 30,
        timezone: "Asia/Seoul",
        date_time_format: "iso-24h",
        last_sync_started_at: "2024-04-02T09:30:00.000Z",
        last_sync_completed_at: "2024-04-02T10:00:00.000Z",
        last_successful_sync_at: "2024-04-02T10:00:00.000Z",
      },
      runs: [
        {
          id: 10,
          runType: "automatic",
          strategy: "incremental",
          status: "success",
          since: null,
          until: null,
          startedAt: "2024-04-02T09:30:00.000Z",
          completedAt: "2024-04-02T10:00:00.000Z",
          logs: [
            {
              id: 1,
              runId: 10,
              resource: "issues",
              status: "success",
              message: "Processed issues",
              startedAt: "2024-04-02T09:30:00.000Z",
              finishedAt: "2024-04-02T09:45:00.000Z",
            },
            {
              id: 2,
              runId: 10,
              resource: "pull_requests",
              status: "failed",
              message: "Timeout",
              startedAt: "2024-04-02T09:45:00.000Z",
              finishedAt: "2024-04-02T09:55:00.000Z",
            },
          ],
        },
      ],
      logs: [
        {
          id: 1,
          resource: "issues",
          status: "success",
          message: "Processed issues",
          started_at: "2024-04-02T09:00:00.000Z",
          finished_at: "2024-04-02T09:30:00.000Z",
          run_id: 10,
        },
        {
          id: 2,
          resource: "pull_requests",
          status: "failed",
          message: "Timeout",
          started_at: "2024-04-02T09:00:00.000Z",
          finished_at: "2024-04-02T09:15:00.000Z",
          run_id: 10,
        },
      ],
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="Asia/Seoul"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "데이터 동기화 제어" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/조직\(acme\)/)).toBeInTheDocument();
    const overviewTab = screen.getByRole("link", { name: "동기화" });
    expect(overviewTab).toHaveAttribute("href", "/dashboard/sync");
    expect(overviewTab).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "동기화 로그" })).toHaveAttribute(
      "href",
      "/dashboard/sync/logs",
    );
    expect(screen.getByRole("link", { name: "백업" })).toHaveAttribute(
      "href",
      "/dashboard/sync/backup",
    );
    expect(screen.getByText("수동 데이터 백필")).toBeInTheDocument();
    expect(screen.getByText("자동 동기화")).toBeInTheDocument();
    expect(screen.getByText("활성")).toBeInTheDocument();
    const nextSyncParagraph = screen.getByText(
      (content, element) =>
        element?.tagName.toLowerCase() === "p" &&
        content.startsWith("다음 동기화 예정:"),
    );
    expect(nextSyncParagraph).toHaveTextContent(
      /다음 동기화 예정:\s*2024-04-02 19:30/,
    );
    expect(screen.queryByText("DB 백업 일정")).not.toBeInTheDocument();
    expect(screen.queryByText("최근 동기화 로그")).not.toBeInTheDocument();
  });

  it("renders the logs view with recent run entries", () => {
    const status = buildStatus({
      runs: [
        {
          id: 10,
          runType: "automatic",
          strategy: "incremental",
          status: "success",
          since: null,
          until: null,
          startedAt: "2024-04-02T09:30:00.000Z",
          completedAt: "2024-04-02T10:00:00.000Z",
          logs: [
            {
              id: 1,
              runId: 10,
              resource: "issues",
              status: "success",
              message: "Processed issues",
              startedAt: "2024-04-02T09:30:00.000Z",
              finishedAt: "2024-04-02T09:45:00.000Z",
            },
            {
              id: 2,
              runId: 10,
              resource: "pull_requests",
              status: "failed",
              message: "Timeout",
              startedAt: "2024-04-02T09:45:00.000Z",
              finishedAt: "2024-04-02T09:55:00.000Z",
            },
          ],
        },
      ],
      logs: [
        {
          id: 1,
          resource: "issues",
          status: "success",
          message: "Processed issues",
          started_at: "2024-04-02T09:00:00.000Z",
          finished_at: "2024-04-02T09:30:00.000Z",
          run_id: 10,
        },
      ],
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="Asia/Seoul"
        dateTimeFormat="iso-24h"
        view="logs"
        currentPathname="/dashboard/sync/logs"
      />,
    );

    expect(screen.getByText("최근 동기화 로그")).toBeInTheDocument();
    const logsTab = screen.getByRole("link", { name: "동기화 로그" });
    expect(logsTab).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Processed issues")).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
    expect(screen.getAllByText("Success")).not.toHaveLength(0);
    expect(screen.getAllByText("Failed")).not.toHaveLength(0);
    expect(screen.queryByText("DB 백업 일정")).not.toBeInTheDocument();
  });

  it("formats timestamps using the configured timezone and display format", () => {
    const status = buildStatus({
      config: {
        timezone: "Asia/Seoul",
        date_time_format: "iso-24h",
        last_sync_started_at: "2024-04-01T23:00:00.000Z",
        last_sync_completed_at: "2024-04-02T00:00:00.000Z",
        last_successful_sync_at: "2024-04-02T03:15:00.000Z",
      },
      logs: [
        {
          id: 1,
          resource: "issues",
          status: "success",
          message: null,
          started_at: "2024-04-01T15:00:00.000Z",
          finished_at: "2024-04-01T16:45:00.000Z",
          run_id: null,
        },
      ],
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="Asia/Seoul"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync"
      />,
    );

    expect(
      screen.getByText(
        (content) =>
          content.includes("2024-04-02 08:00") &&
          content.includes("2024-04-02 09:00"),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (content) =>
          content.includes("- →") && content.includes("2024-04-02 12:15"),
      ),
    ).toBeInTheDocument();
    const nextSyncParagraph = screen.getByText(
      (content, element) =>
        element?.tagName.toLowerCase() === "p" &&
        content.startsWith("다음 동기화 예정:"),
    );
    expect(nextSyncParagraph).toHaveTextContent(/다음 동기화 예정:\s*-/);
  });

  it("disables sync actions and displays an admin notice for non-admin users", () => {
    const status = buildStatus();

    render(
      <SyncControls
        status={status}
        isAdmin={false}
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync"
      />,
    );

    expect(
      screen.getByText("관리자 권한이 있는 사용자만 실행할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "백필 실행" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "자동 동기화 시작" }),
    ).toBeDisabled();
  });

  it("runs a manual backfill, shows success feedback, stores history, and refreshes the router", async () => {
    const status = buildStatus();
    const backfillResult = {
      startDate: "2024-04-01T00:00:00.000Z",
      endDate: "2024-04-02T00:00:00.000Z",
      chunkCount: 1,
      totals: {
        issues: 1,
        discussions: 1,
        pullRequests: 2,
        reviews: 3,
        comments: 4,
      },
      chunks: [createChunk()],
    };

    mockFetchJsonOnce({ success: true, result: backfillResult });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(hasRequest("/api/sync/backfill", "POST")).toBe(true);
    });
    const request = findRequest("/api/sync/backfill", "POST");
    expect(request).not.toBeNull();
    if (!request) {
      throw new Error("Expected backfill request");
    }
    expect(request.url).toContain("/api/sync/backfill");
    expect(request.method).toBe("POST");

    await waitFor(() => {
      expect(
        screen.getByText("백필이 성공적으로 실행되었습니다."),
      ).toBeInTheDocument();
    });

    const historyHeading = screen.getByText("백필 결과 히스토리");
    expect(historyHeading).toBeInTheDocument();
    const historyCard = historyHeading.closest('[data-slot="card"]');
    expect(historyCard).not.toBeNull();
    expect(
      within(historyCard as HTMLElement).getByText(/실행 #1/),
    ).toBeInTheDocument();
    expect(
      within(historyCard as HTMLElement).getByText(
        /이슈 1\s+\/ 토론\s+1\s+\/ PR\s+2\s+\/ 리뷰\s+3\s+\/ 댓글\s+4/,
      ),
    ).toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("shows a detailed failure message when any backfill chunk fails", async () => {
    const status = buildStatus();
    const failedChunk = {
      status: "failed" as const,
      since: "2024-04-01T00:00:00.000Z",
      until: "2024-04-02T00:00:00.000Z",
      error: "API rate limit",
    };

    mockFetchJsonOnce({
      success: true,
      result: {
        startDate: "2024-04-01T00:00:00.000Z",
        endDate: "2024-04-03T00:00:00.000Z",
        chunkCount: 2,
        totals: {
          issues: 0,
          discussions: 0,
          pullRequests: 0,
          reviews: 0,
          comments: 0,
        },
        chunks: [createChunk(), failedChunk],
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          (content) =>
            content.includes("백필이") && content.includes("API rate limit"),
        ),
      ).toBeInTheDocument();
    });
  });

  it("surfaces server-provided errors when backfill response indicates failure", async () => {
    const status = buildStatus();

    mockFetchOnce({
      status: 400,
      json: { success: false, message: "backfill failed" },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(screen.getByText("backfill failed")).toBeInTheDocument();
    });
    expect(screen.queryByText("백필 결과 히스토리")).not.toBeInTheDocument();
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("preserves existing history when a subsequent backfill request fails", async () => {
    const status = buildStatus();
    const backfillResult = {
      startDate: "2024-04-01T00:00:00.000Z",
      endDate: "2024-04-02T00:00:00.000Z",
      chunkCount: 1,
      totals: {
        issues: 1,
        discussions: 1,
        pullRequests: 2,
        reviews: 3,
        comments: 4,
      },
      chunks: [createChunk()],
    };

    mockFetchJsonOnce({ success: true, result: backfillResult });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    const historyHeading = await screen.findByText("백필 결과 히스토리");
    const historyCard = historyHeading.closest('[data-slot="card"]');
    expect(historyCard).not.toBeNull();
    expect(routerRefreshMock).not.toHaveBeenCalled();

    mockFetchOnce(async () => {
      throw new Error("network failure");
    });

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(screen.getByText("network failure")).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
    expect(
      within(historyCard as HTMLElement).getByText(/실행 #1/),
    ).toBeInTheDocument();
  });

  it("validates the sync interval before toggling automatic sync", async () => {
    const status = buildStatus({
      config: {
        sync_interval_minutes: 0,
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 시작" }));

    expect(hasRequest("/api/sync/auto", "POST")).toBe(false);
    expect(
      screen.getByText("유효한 동기화 간격을 설정에서 먼저 지정하세요."),
    ).toBeInTheDocument();
  });

  it("shows an error when the automatic sync endpoint returns an empty body", async () => {
    const status = buildStatus({
      config: {
        auto_sync_enabled: false,
        sync_interval_minutes: 30,
      },
    });

    mockFetchOnce(
      new Response(null, { status: 204, statusText: "No Content" }),
    );

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 시작" }));

    await waitFor(() => {
      expect(
        screen.getByText("서버에서 빈 응답이 반환되었습니다. (204 No Content)"),
      ).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("handles non-JSON responses from the automatic sync endpoint", async () => {
    const status = buildStatus({
      config: {
        auto_sync_enabled: true,
        sync_interval_minutes: 30,
      },
    });

    mockFetchOnce(
      new Response("<!doctype html>", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "text/html" },
      }),
    );

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 중단" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "서버 응답을 해석하지 못했습니다. (500 Internal Server Error)",
        ),
      ).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("enables automatic sync and updates the call-to-action state", async () => {
    const status = buildStatus({
      config: {
        auto_sync_enabled: false,
        sync_interval_minutes: 30,
      },
    });

    mockFetchJsonOnce({ success: true, action: "enabled" });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 시작" }));

    await waitFor(() => {
      expect(hasRequest("/api/sync/auto", "POST")).toBe(true);
    });
    const request = findRequest("/api/sync/auto", "POST");
    expect(request).not.toBeNull();
    if (!request) {
      throw new Error("Expected auto-sync request");
    }
    expect(request.url).toContain("/api/sync/auto");
    expect(request.method).toBe("POST");
    const body = await request.clone().json();
    expect(body).toEqual({ enabled: true, intervalMinutes: 30 });

    await waitFor(() => {
      expect(
        screen.getByText("자동 동기화를 실행했습니다."),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "자동 동기화 중단" }),
    ).toBeInTheDocument();
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces server errors when automatic sync toggle fails", async () => {
    const status = buildStatus({
      config: {
        auto_sync_enabled: true,
        sync_interval_minutes: 30,
      },
    });

    mockFetchOnce({
      status: 400,
      json: { success: false, message: "toggle failed" },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 중단" }));

    await waitFor(() => {
      expect(screen.getByText("toggle failed")).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("fails stuck runs via the cleanup endpoint and shows feedback", async () => {
    const status = buildStatus();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockFetchJsonOnce({
      success: true,
      result: { runCount: 2, logCount: 3 },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "멈춘 동기화 정리" }));

    expect(confirmMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(hasRequest("/api/sync/admin/cleanup", "POST")).toBe(true);
    });
    const request = findRequest("/api/sync/admin/cleanup", "POST");
    expect(request).not.toBeNull();
    if (!request) {
      throw new Error("Expected cleanup request");
    }
    expect(request.method).toBe("POST");

    await waitFor(() => {
      expect(
        screen.getByText("멈춰 있던 런 2건과 로그 3건을 실패 처리했습니다."),
      ).toBeInTheDocument();
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });

  it("informs the user when there are no stuck runs to clean up", async () => {
    const status = buildStatus();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockFetchJsonOnce({
      success: true,
      result: { runCount: 0, logCount: 0 },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync/backup"
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "멈춘 동기화 정리" }));

    await waitFor(() => {
      expect(screen.getByText("정리할 동기화가 없습니다.")).toBeInTheDocument();
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });

  it("disables the cleanup button for non-admin users", async () => {
    const status = buildStatus();

    render(
      <SyncControls
        status={status}
        isAdmin={false}
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="overview"
        currentPathname="/dashboard/sync"
      />,
    );

    const button = screen.getByRole("button", { name: "멈춘 동기화 정리" });
    expect(button).toBeDisabled();
    expect(hasRequest("/api/sync/backfill", "POST")).toBe(false);
  });

  it("allows admins to update the backup schedule hour", async () => {
    const user = userEvent.setup();
    const status = buildStatus({
      backup: {
        directory: "/var/backups/github-dashboard",
        retentionCount: 3,
        schedule: {
          enabled: true,
          hourLocal: 2,
          timezone: "Asia/Seoul",
          nextRunAt: null,
          lastStartedAt: null,
          lastCompletedAt: null,
          lastStatus: "success",
          lastError: null,
        },
        records: [],
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="Asia/Seoul"
        dateTimeFormat="iso-24h"
        view="backup"
        currentPathname="/dashboard/sync/backup"
      />,
    );

    const select = screen.getByLabelText("백업 실행 시각 (Asia/Seoul)");
    await user.selectOptions(select, ["5"]);

    const saveButton = screen.getByRole("button", { name: "백업 시각 저장" });
    await user.click(saveButton);

    await waitFor(() =>
      expect(hasRequest("/api/sync/config", "PATCH")).toBe(true),
    );
    const request = findRequest("/api/sync/config", "PATCH");
    const payload = request ? JSON.parse(await request.clone().text()) : null;
    expect(payload).toEqual({ backupHour: 5 });
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("posts a restore request when admins restore a backup", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);

    const status = buildStatus({
      backup: {
        directory: "/var/backups/github-dashboard",
        retentionCount: 3,
        schedule: {
          enabled: true,
          hourLocal: 2,
          timezone: "UTC",
          nextRunAt: null,
          lastStartedAt: "2024-04-01T02:00:00.000Z",
          lastCompletedAt: "2024-04-01T02:02:00.000Z",
          lastStatus: "success",
          lastError: null,
        },
        records: [
          {
            id: 42,
            filename: "db-backup-20240401.dump",
            directory: "/var/backups/github-dashboard",
            filePath: "/var/backups/github-dashboard/db-backup-20240401.dump",
            status: "success",
            trigger: "automatic",
            startedAt: "2024-04-01T02:00:00.000Z",
            completedAt: "2024-04-01T02:02:00.000Z",
            sizeBytes: 1024,
            error: null,
            restoredAt: null,
            createdBy: "admin",
          },
        ],
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="backup"
        currentPathname="/dashboard/sync/backup"
      />,
    );

    const restoreButton = screen.getByRole("button", { name: "복구" });
    await user.click(restoreButton);

    await waitFor(() =>
      expect(hasRequest("/api/backup/42/restore", "POST")).toBe(true),
    );
    expect(routerRefreshMock).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("disables backup controls for non-admin viewers", () => {
    const status = buildStatus({
      backup: {
        directory: "/var/backups/github-dashboard",
        retentionCount: 3,
        schedule: {
          enabled: true,
          hourLocal: 6,
          timezone: "UTC",
          nextRunAt: "2024-04-02T06:00:00.000Z",
          lastStartedAt: "2024-04-01T06:00:00.000Z",
          lastCompletedAt: "2024-04-01T06:02:00.000Z",
          lastStatus: "success",
          lastError: null,
        },
        records: [
          {
            id: 1,
            filename: "db-backup.dump",
            directory: "/var/backups/github-dashboard",
            filePath: "/var/backups/github-dashboard/db-backup.dump",
            status: "success",
            trigger: "automatic",
            startedAt: "2024-04-01T06:00:00.000Z",
            completedAt: "2024-04-01T06:02:00.000Z",
            sizeBytes: 512,
            error: null,
            restoredAt: null,
            createdBy: "admin",
          },
        ],
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin={false}
        timeZone="UTC"
        dateTimeFormat="iso-24h"
        view="backup"
        currentPathname="/dashboard/sync/backup"
      />,
    );

    const select = screen.getByLabelText("백업 실행 시각 (UTC)");
    expect(select).toBeDisabled();

    const saveButton = screen.getByRole("button", { name: "백업 시각 저장" });
    expect(saveButton).toBeDisabled();

    expect(
      screen.queryByRole("button", { name: "복구" }),
    ).not.toBeInTheDocument();
  });

  it("shows failure states and backup error messages", () => {
    const status = buildStatus({
      backup: {
        directory: "/var/backups/github-dashboard",
        retentionCount: 5,
        schedule: {
          enabled: true,
          hourLocal: 2,
          timezone: "Asia/Seoul",
          nextRunAt: null,
          lastStartedAt: "2024-04-01T02:00:00.000+09:00",
          lastCompletedAt: "2024-04-01T02:05:00.000+09:00",
          lastStatus: "failed",
          lastError: "백업 디렉터리 접근 실패",
        },
        records: [
          {
            id: 10,
            filename: "db-backup-success.dump",
            directory: "/var/backups/github-dashboard",
            filePath: "/var/backups/github-dashboard/db-backup-success.dump",
            status: "success",
            trigger: "manual",
            startedAt: "2024-03-31T02:00:00.000Z",
            completedAt: "2024-03-31T02:02:00.000Z",
            sizeBytes: 2_048,
            error: null,
            restoredAt: null,
            createdBy: "admin",
          },
          {
            id: 11,
            filename: "db-backup-failure.dump",
            directory: "/var/backups/github-dashboard",
            filePath: "/var/backups/github-dashboard/db-backup-failure.dump",
            status: "failed",
            trigger: "automatic",
            startedAt: "2024-04-01T02:00:00.000Z",
            completedAt: "2024-04-01T02:02:30.000Z",
            sizeBytes: null,
            error: "pg_dump가 종료 코드 1로 실패했습니다.",
            restoredAt: null,
            createdBy: null,
          },
        ],
      },
    });

    render(
      <SyncControls
        status={status}
        isAdmin
        timeZone="Asia/Seoul"
        dateTimeFormat="iso-24h"
        view="backup"
        currentPathname="/dashboard/sync/backup"
      />,
    );

    expect(
      screen.getByText("최근 오류: 백업 디렉터리 접근 실패"),
    ).toBeInTheDocument();

    expect(screen.getAllByText("실패").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("오류: pg_dump가 종료 코드 1로 실패했습니다."),
    ).toBeInTheDocument();
  });
});

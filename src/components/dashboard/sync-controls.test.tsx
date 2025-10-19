import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SyncControls } from "@/components/dashboard/sync-controls";
import type { BackfillChunkSuccess, SyncStatus } from "@/lib/sync/service";
import {
  fetchMock,
  mockFetchJsonOnce,
  mockFetchOnce,
} from "../../../tests/setup/mock-fetch";

const routerRefreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
  }),
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
      date_time_format: "auto",
      last_sync_started_at: null,
      last_sync_completed_at: null,
      last_successful_sync_at: null,
      ...(overrides.config ?? {}),
    },
    runs: overrides.runs ?? [],
    logs: overrides.logs ?? [],
    dataFreshness: overrides.dataFreshness ?? null,
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

describe("SyncControls", () => {
  beforeEach(() => {
    routerRefreshMock.mockReset();
    fetchMock.mockReset();
  });

  it("renders primary sections and the latest sync logs", () => {
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

    render(<SyncControls status={status} isAdmin />);

    expect(
      screen.getByRole("heading", { name: "데이터 동기화 제어" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/조직\(acme\)/)).toBeInTheDocument();
    expect(screen.getByText("수동 데이터 백필")).toBeInTheDocument();
    expect(screen.getByText("자동 동기화")).toBeInTheDocument();
    expect(screen.getByText("데이터 초기화")).toBeInTheDocument();
    expect(screen.getByText("활성")).toBeInTheDocument();
    expect(screen.getByText(/자동 동기화 •/)).toBeInTheDocument();
    expect(screen.getByText("Processed issues")).toBeInTheDocument();
    expect(screen.getByText("Timeout")).toBeInTheDocument();
    expect(screen.getAllByText("Success")).not.toHaveLength(0);
    expect(screen.getAllByText("Failed")).not.toHaveLength(0);
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

    render(<SyncControls status={status} isAdmin />);

    expect(
      screen.getByText("2024-04-02 08:00 → 2024-04-02 09:00"),
    ).toBeInTheDocument();
    expect(screen.getByText("- → 2024-04-02 12:15")).toBeInTheDocument();
    expect(
      screen.getByText("2024-04-02 00:00 → 2024-04-02 01:45"),
    ).toBeInTheDocument();
  });

  it("disables sync actions and displays an admin notice for non-admin users", () => {
    const status = buildStatus();

    render(<SyncControls status={status} isAdmin={false} />);

    expect(
      screen.getByText("관리자 권한이 있는 사용자만 실행할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "백필 실행" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "자동 동기화 시작" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "모든 데이터 삭제" }),
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

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
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
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
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

    render(<SyncControls status={status} isAdmin />);
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

    render(<SyncControls status={status} isAdmin />);
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

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    const historyHeading = await screen.findByText("백필 결과 히스토리");
    const historyCard = historyHeading.closest('[data-slot="card"]');
    expect(historyCard).not.toBeNull();
    await waitFor(() => {
      expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    });

    mockFetchOnce(async () => {
      throw new Error("network failure");
    });

    await user.click(screen.getByRole("button", { name: "백필 실행" }));

    await waitFor(() => {
      expect(screen.getByText("network failure")).toBeInTheDocument();
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
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

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 시작" }));

    expect(fetchMock).not.toHaveBeenCalled();
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

    render(<SyncControls status={status} isAdmin />);
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

    render(<SyncControls status={status} isAdmin />);
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

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 시작" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
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

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "자동 동기화 중단" }));

    await waitFor(() => {
      expect(screen.getByText("toggle failed")).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("confirms before resetting data and displays success feedback", async () => {
    const status = buildStatus();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockFetchJsonOnce({ success: true });

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "모든 데이터 삭제" }));

    expect(confirmMock).toHaveBeenCalled();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/api/sync/reset");
    expect(request.method).toBe("POST");
    const body = await request.clone().json();
    expect(body).toEqual({ preserveLogs: true });

    await waitFor(() => {
      expect(
        screen.getByText("데이터가 초기화되었습니다."),
      ).toBeInTheDocument();
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    confirmMock.mockRestore();
  });

  it("surfaces server errors when resetting data fails", async () => {
    const status = buildStatus();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    mockFetchOnce({
      status: 400,
      json: { success: false, message: "reset failed" },
    });

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "모든 데이터 삭제" }));

    await waitFor(() => {
      expect(screen.getByText("reset failed")).toBeInTheDocument();
    });
    expect(routerRefreshMock).not.toHaveBeenCalled();
    confirmMock.mockRestore();
  });

  it("cancels reset when the confirmation dialog is rejected", async () => {
    const status = buildStatus();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SyncControls status={status} isAdmin />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "모든 데이터 삭제" }));

    expect(fetchMock).not.toHaveBeenCalled();
    confirmMock.mockRestore();
  });
});

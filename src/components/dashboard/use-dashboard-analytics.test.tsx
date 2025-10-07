import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import {
  buildDashboardAnalyticsFixture,
  buildDashboardAnalyticsForPerson,
} from "@/components/test-harness/dashboard-fixtures";

const originalFetch = global.fetch;

function createResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("useDashboardAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("loads analytics successfully and normalizes filters", async () => {
    const initialAnalytics = buildDashboardAnalyticsFixture();
    const defaultRange = {
      start: initialAnalytics.range.start,
      end: initialAnalytics.range.end,
    };
    const [firstRepo] = initialAnalytics.repositories;
    const [firstContributor] = initialAnalytics.contributors;
    const nextAnalytics = {
      ...buildDashboardAnalyticsForPerson(firstContributor.id),
      range: {
        ...initialAnalytics.range,
        start: "2024-02-01T00:00:00.000Z",
        end: "2024-02-07T23:59:59.999Z",
      },
      repositories: [firstRepo],
      contributors: [firstContributor],
      timeZone: "Asia/Seoul",
      weekStart: "sunday",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createResponse({ success: true, analytics: nextAnalytics }),
      );
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAnalytics({ initialAnalytics, defaultRange }),
    );

    const nextFilters = {
      ...result.current.filters,
      start: nextAnalytics.range.start,
      end: nextAnalytics.range.end,
      repositoryIds: [...result.current.filters.repositoryIds, "missing-repo"],
      personId: "missing-user",
    };

    await act(async () => {
      await result.current.applyFilters(nextFilters);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/dashboard/analytics"),
    );
    expect(result.current.analytics).toEqual(nextAnalytics);
    expect(result.current.timeZone).toBe("Asia/Seoul");
    expect(result.current.weekStart).toBe("sunday");
    expect(result.current.filters.repositoryIds).toEqual([firstRepo.id]);
    expect(result.current.filters.personId).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces errors when the API call fails", async () => {
    const initialAnalytics = buildDashboardAnalyticsFixture();
    const defaultRange = {
      start: initialAnalytics.range.start,
      end: initialAnalytics.range.end,
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createResponse({ success: false, message: "대시보드 오류" }),
      );
    global.fetch = fetchMock;

    const { result } = renderHook(() =>
      useDashboardAnalytics({ initialAnalytics, defaultRange }),
    );

    await act(async () => {
      await result.current.applyFilters({
        ...result.current.filters,
        start: "2024-02-01T00:00:00.000Z",
        end: "2024-02-07T23:59:59.999Z",
      });
    });

    expect(result.current.error).toBe("대시보드 오류");
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

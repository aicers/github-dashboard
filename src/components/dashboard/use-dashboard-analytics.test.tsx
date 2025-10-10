import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDashboardAnalytics } from "@/components/dashboard/use-dashboard-analytics";
import {
  buildDashboardAnalyticsFixture,
  buildDashboardAnalyticsForPerson,
} from "@/components/test-harness/dashboard-fixtures";
import {
  createJsonResponse,
  fetchMock,
  mockFetchJsonOnce,
  mockFetchOnce,
} from "../../../tests/setup/mock-fetch";

function createDeferredResponse(body: unknown) {
  let resolveResponse: ((value: Response) => void) | null = null;
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  return {
    promise,
    resolve() {
      resolveResponse?.(createJsonResponse(body));
    },
  };
}

describe("useDashboardAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    mockFetchJsonOnce({ success: true, analytics: nextAnalytics });

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

    expect(fetchMock).toHaveBeenCalled();
    const firstCall = fetchMock.mock.calls[0]?.[0];
    expect(firstCall).toBeInstanceOf(Request);
    expect((firstCall as Request).url).toContain("/api/dashboard/analytics");
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

    mockFetchJsonOnce({ success: false, message: "대시보드 오류" });

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

  it("keeps the latest filters when requests overlap and sanitizes missing data", async () => {
    const initialAnalytics = buildDashboardAnalyticsFixture();
    const defaultRange = {
      start: initialAnalytics.range.start,
      end: initialAnalytics.range.end,
    };
    const [repoAlpha, repoBeta] = initialAnalytics.repositories;
    const [personAlpha, , personGamma] = initialAnalytics.contributors;

    const alphaOnly = structuredClone(initialAnalytics);
    alphaOnly.range = {
      ...alphaOnly.range,
      start: "2024-03-01T00:00:00.000Z",
      end: "2024-03-07T23:59:59.999Z",
    };
    alphaOnly.repositories = [repoAlpha];
    alphaOnly.contributors = [personAlpha];
    alphaOnly.organization.repoDistribution =
      alphaOnly.organization.repoDistribution.slice(0, 1);
    alphaOnly.organization.repoComparison =
      alphaOnly.organization.repoComparison.slice(0, 1);
    alphaOnly.timeZone = "America/New_York";
    alphaOnly.weekStart = "sunday";

    const betaOnly = structuredClone(initialAnalytics);
    betaOnly.range = {
      ...betaOnly.range,
      start: "2024-04-01T00:00:00.000Z",
      end: "2024-04-07T23:59:59.999Z",
    };
    betaOnly.repositories = [repoBeta];
    betaOnly.contributors = [personAlpha];
    betaOnly.organization.repoDistribution =
      betaOnly.organization.repoDistribution.slice(1, 2);
    betaOnly.organization.repoComparison =
      betaOnly.organization.repoComparison.slice(1, 2);
    betaOnly.timeZone = "Asia/Tokyo";
    betaOnly.weekStart = "monday";

    const firstDeferred = createDeferredResponse({
      success: true,
      analytics: alphaOnly,
    });
    const secondDeferred = createDeferredResponse({
      success: true,
      analytics: betaOnly,
    });

    mockFetchOnce(() => firstDeferred.promise);
    mockFetchOnce(() => secondDeferred.promise);

    const { result } = renderHook(() =>
      useDashboardAnalytics({ initialAnalytics, defaultRange }),
    );

    const firstFilters = {
      ...result.current.filters,
      start: "2024-03-01T00:00:00.000Z",
      end: "2024-03-07T23:59:59.999Z",
      repositoryIds: [repoAlpha.id, repoBeta.id],
      personId: personAlpha.id,
    };

    let firstPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      firstPromise = result.current.applyFilters(firstFilters);
    });

    const secondFilters = {
      ...firstFilters,
      start: "2024-04-01T00:00:00.000Z",
      end: "2024-04-07T23:59:59.999Z",
      repositoryIds: [repoBeta.id],
      personId: personGamma.id,
    };

    let secondPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      secondPromise = result.current.applyFilters(secondFilters);
    });

    await act(async () => {
      firstDeferred.resolve();
      await firstPromise;
    });

    await act(async () => {
      secondDeferred.resolve();
      await secondPromise;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.analytics).toEqual(betaOnly);
    expect(result.current.filters.repositoryIds).toEqual([repoBeta.id]);
    expect(result.current.filters.personId).toBeNull();
    expect(result.current.timeZone).toBe("Asia/Tokyo");
    expect(result.current.weekStart).toBe("monday");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("preserves the selected person when the API response still includes it", async () => {
    const initialAnalytics = buildDashboardAnalyticsFixture();
    const defaultRange = {
      start: initialAnalytics.range.start,
      end: initialAnalytics.range.end,
    };
    const [repoAlpha] = initialAnalytics.repositories;
    const [, personBeta] = initialAnalytics.contributors;

    const nextAnalytics = structuredClone(initialAnalytics);
    nextAnalytics.range = {
      ...nextAnalytics.range,
      start: "2024-05-01T00:00:00.000Z",
      end: "2024-05-07T23:59:59.999Z",
    };
    nextAnalytics.repositories = [repoAlpha];
    nextAnalytics.contributors = [personBeta];

    mockFetchJsonOnce({ success: true, analytics: nextAnalytics });

    const { result } = renderHook(() =>
      useDashboardAnalytics({ initialAnalytics, defaultRange }),
    );

    const targetFilters = {
      ...result.current.filters,
      start: nextAnalytics.range.start,
      end: nextAnalytics.range.end,
      repositoryIds: [repoAlpha.id],
      personId: personBeta.id,
    };

    await act(async () => {
      await result.current.applyFilters(targetFilters);
    });

    expect(result.current.filters.repositoryIds).toEqual([repoAlpha.id]);
    expect(result.current.filters.personId).toBe(personBeta.id);
    expect(result.current.analytics).toEqual(nextAnalytics);
  });
});

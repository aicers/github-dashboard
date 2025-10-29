import { describe, expect, it } from "vitest";

import {
  buildFilterState,
  buildSavedFilterPayload,
  DEFAULT_THRESHOLD_VALUES,
  normalizeSearchParams,
} from "@/lib/activity/filter-state";
import type { ActivityListParams } from "@/lib/activity/types";
import {
  buildActivityFilterState,
  buildActivityListParams,
  collectSearchParams,
} from "../../../tests/helpers/activity-filters";

describe("buildFilterState", () => {
  it("applies pagination defaults and merges thresholds", () => {
    const params: ActivityListParams = buildActivityListParams({
      page: 0,
      perPage: -5,
      thresholds: {
        stalePrDays: 12,
      },
    });

    const result = buildFilterState(params, 30);

    expect(result.page).toBe(1);
    expect(result.perPage).toBe(30);
    expect(result.thresholds.stalePrDays).toBe(12);
    expect(result.thresholds.idlePrDays).toBe(
      DEFAULT_THRESHOLD_VALUES.idlePrDays,
    );
  });

  it("falls back to empty collections when params omit filters", () => {
    const params: ActivityListParams = buildActivityListParams({
      types: undefined,
      repositoryIds: undefined,
      search: undefined,
    });

    const result = buildFilterState(params, 25);

    expect(result.categories).toEqual([]);
    expect(result.repositoryIds).toEqual([]);
    expect(result.search).toBe("");
  });
});

describe("buildSavedFilterPayload", () => {
  it("trims empty collections and normalises search text", () => {
    const filters = buildActivityFilterState({
      perPage: 50,
      categories: ["issue", "pull_request"],
      repositoryIds: ["repo-1"],
      statuses: ["open"],
      search: "  needs attention ",
    });

    const payload = buildSavedFilterPayload(filters);

    expect(payload.perPage).toBe(50);
    expect(payload.types).toEqual(["issue", "pull_request"]);
    expect(payload.repositoryIds).toEqual(["repo-1"]);
    expect(payload.statuses).toEqual(["open"]);
    expect(payload.search).toBe("needs attention");
    expect(payload.attention).toBeUndefined();
  });

  it("only includes threshold overrides that differ from defaults", () => {
    const filters = buildActivityFilterState({
      thresholds: {
        ...DEFAULT_THRESHOLD_VALUES,
        stalePrDays: DEFAULT_THRESHOLD_VALUES.stalePrDays + 5,
        reviewRequestDays: DEFAULT_THRESHOLD_VALUES.reviewRequestDays,
      },
    });

    const payload = buildSavedFilterPayload(filters);

    expect(payload.thresholds).toEqual({
      stalePrDays: DEFAULT_THRESHOLD_VALUES.stalePrDays + 5,
    });
  });

  it("preserves people selection when building payload", () => {
    const filters = buildActivityFilterState({
      peopleSelection: ["user-alice", "user-bob"],
    });

    const payload = buildSavedFilterPayload(filters);

    expect(payload.peopleSelection).toEqual(["user-alice", "user-bob"]);
  });
});

describe("normalizeSearchParams", () => {
  it("omits defaults when filters match initial state", () => {
    const params = normalizeSearchParams(
      buildActivityFilterState({
        search: "",
      }),
      25,
    );

    expect(collectSearchParams(params)).toEqual([]);
  });

  it("serialises arrays, pagination, and thresholds", () => {
    const filters = buildActivityFilterState({
      page: 2,
      perPage: 10,
      categories: ["issue", "pull_request"],
      repositoryIds: ["repo-1", "repo-2"],
      authorIds: ["author-1"],
      statuses: ["open", "closed"],
      search: "  backlog ",
      thresholds: {
        ...DEFAULT_THRESHOLD_VALUES,
        backlogIssueDays: DEFAULT_THRESHOLD_VALUES.backlogIssueDays + 3,
      },
    });

    const params = normalizeSearchParams(filters, 25);

    expect(collectSearchParams(params)).toEqual([
      ["page", "2"],
      ["perPage", "10"],
      ["category", "issue"],
      ["category", "pull_request"],
      ["repositoryId", "repo-1"],
      ["repositoryId", "repo-2"],
      ["authorId", "author-1"],
      ["status", "open"],
      ["status", "closed"],
      ["search", "backlog"],
      [
        "backlogIssueDays",
        (DEFAULT_THRESHOLD_VALUES.backlogIssueDays + 3).toString(),
      ],
    ]);
  });

  it("serialises people selection into search params", () => {
    const filters = buildActivityFilterState({
      peopleSelection: ["user-1", "user-2"],
    });

    const params = normalizeSearchParams(filters, 25);

    expect(params.getAll("peopleSelection")).toEqual(["user-1", "user-2"]);
  });
});

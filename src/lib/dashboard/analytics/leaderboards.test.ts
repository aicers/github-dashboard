import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  query: vi.fn(),
}));

vi.mock("@/lib/dashboard/analytics/reviews", () => ({
  fetchReviewResponsePairs: vi.fn(),
}));

vi.mock("@/lib/dashboard/business-days", () => ({
  calculateBusinessHoursBetween: vi.fn(),
}));

import {
  fetchLeaderboard,
  fetchPrCompletionLeaderboard,
} from "@/lib/dashboard/analytics/leaderboards";
import { fetchReviewResponsePairs } from "@/lib/dashboard/analytics/reviews";
import { calculateBusinessHoursBetween } from "@/lib/dashboard/business-days";
import { query } from "@/lib/db/client";

const mockQuery = vi.mocked(query);
const mockFetchReviewResponsePairs = vi.mocked(fetchReviewResponsePairs);
const mockCalculateBusinessHoursBetween = vi.mocked(
  calculateBusinessHoursBetween,
);

afterEach(() => {
  vi.resetAllMocks();
});

describe("analytics leaderboards helpers", () => {
  it("delegates simple leaderboard metrics to the database", async () => {
    mockQuery.mockResolvedValue({
      rows: [],
      command: "",
      rowCount: 0,
      oid: 0,
      fields: [],
    });

    const result = await fetchLeaderboard("prs", "start", "end", [
      "repo-1",
      "repo-2",
    ]);

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("SELECT pr.author_id AS user_id");
    expect(params).toEqual(["start", "end", ["repo-1", "repo-2"]]);
  });

  it("computes response time leaderboards from review response pairs", async () => {
    mockFetchReviewResponsePairs.mockResolvedValue([
      {
        reviewer_id: "alice",
        pull_request_id: "1",
        requested_at: "",
        responded_at: "",
      },
      {
        reviewer_id: "alice",
        pull_request_id: "2",
        requested_at: "",
        responded_at: "",
      },
      {
        reviewer_id: "bob",
        pull_request_id: "3",
        requested_at: "",
        responded_at: "",
      },
      {
        reviewer_id: null,
        pull_request_id: "ignored",
        requested_at: "",
        responded_at: "",
      },
    ]);

    const durations = [1, 2, 3];
    mockCalculateBusinessHoursBetween.mockImplementation(
      () => durations.shift() ?? 0,
    );

    const result = await fetchLeaderboard(
      "response",
      "start",
      "end",
      undefined,
    );

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockFetchReviewResponsePairs).toHaveBeenCalledWith(
      "start",
      "end",
      undefined,
    );
    expect(result).toEqual([
      {
        user_id: "alice",
        value: 1.5,
        secondary_value: 2,
      },
      {
        user_id: "bob",
        value: 3,
        secondary_value: 1,
      },
    ]);
  });

  it("normalizes numeric fields for PR completion leaderboard results", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          user_id: "user-1",
          value: "0.5",
          merged_prs: "4",
          commented_count: "2",
          changes_requested_count: "1",
        },
      ],
      command: "",
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const result = await fetchPrCompletionLeaderboard(
      "start",
      "end",
      undefined,
    );

    expect(result).toEqual([
      {
        user_id: "user-1",
        value: 0.5,
        merged_prs: 4,
        commented_count: 2,
        changes_requested_count: 1,
      },
    ]);
  });
});

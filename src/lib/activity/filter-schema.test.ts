import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  type ActivityFilterPayload,
  activityFilterPayloadSchema,
} from "@/lib/activity/filter-schema";

describe("activityFilterPayloadSchema", () => {
  it("normalizes whitespace, deduplicates arrays, and coerces thresholds", () => {
    const result = activityFilterPayloadSchema.parse({
      page: "2",
      perPage: "50",
      types: [" issue ", "issue", "pull_request"],
      repositoryIds: ["repo-1", " repo-2 ", "repo-2"],
      search: "  needs triage  ",
      thresholds: {
        backlogIssueDays: "10",
        reviewRequestDays: 5,
        reviewerUnassignedPrDays: "2",
        reviewStalledPrDays: "7",
        mergeDelayedPrDays: "8",
        unansweredMentionDays: null,
      },
    }) satisfies ActivityFilterPayload;

    expect(result.page).toBe(2);
    expect(result.perPage).toBe(50);
    expect(result.types).toEqual(["issue", "pull_request"]);
    expect(result.repositoryIds).toEqual(["repo-1", "repo-2"]);
    expect(result.search).toBe("needs triage");
    expect(result.thresholds).toEqual({
      backlogIssueDays: 10,
      reviewRequestDays: 5,
      reviewerUnassignedPrDays: 2,
      reviewStalledPrDays: 7,
      mergeDelayedPrDays: 8,
    });
  });

  it("returns undefined for empty arrays and blank search values", () => {
    const result = activityFilterPayloadSchema.parse({
      repositoryIds: ["   ", ""],
      search: "   ",
      thresholds: {},
    });

    expect(result.repositoryIds).toBeUndefined();
    expect(result.search).toBeUndefined();
    expect(result.thresholds).toBeUndefined();
  });

  it("rejects non-positive pagination values", () => {
    expect(() =>
      activityFilterPayloadSchema.parse({
        page: 0,
      }),
    ).toThrow("Expected positive integer value.");

    expect(() =>
      activityFilterPayloadSchema.parse({
        perPage: "-25",
      }),
    ).toThrow("Expected positive integer value.");
  });

  it("rejects non-positive threshold values", () => {
    expect(() =>
      activityFilterPayloadSchema.parse({
        thresholds: {
          backlogIssueDays: 0,
        },
      }),
    ).toThrow("Expected positive integer value.");
  });

  it("rejects unknown fields", () => {
    expect.assertions(2);
    try {
      activityFilterPayloadSchema.parse({
        perPage: 25,
        unknown: "value",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues[0]?.message).toContain(
        "Unrecognized key",
      );
    }
  });
});

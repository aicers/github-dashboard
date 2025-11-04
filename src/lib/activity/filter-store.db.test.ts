// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityFilterPayload } from "@/lib/activity/filter-schema";
import {
  ActivitySavedFilterLimitError,
  createSavedFilter,
  deleteSavedFilter,
  getSavedFilter,
  listSavedFilters,
  SAVED_FILTER_LIMIT,
  updateSavedFilter,
} from "@/lib/activity/filter-store";
import {
  resetActivitySavedFiltersTables,
  seedActivityUser,
} from "../../../tests/helpers/activity-saved-filters";

const USER_ID = "user-1";

function createPayload(
  overrides: Partial<ActivityFilterPayload> = {},
): ActivityFilterPayload {
  return {
    page: undefined,
    perPage: undefined,
    types: undefined,
    repositoryIds: undefined,
    labelKeys: undefined,
    issueTypeIds: undefined,
    milestoneIds: undefined,
    discussionStatuses: undefined,
    pullRequestStatuses: undefined,
    issueBaseStatuses: undefined,
    authorIds: undefined,
    assigneeIds: undefined,
    reviewerIds: undefined,
    mentionedUserIds: undefined,
    commenterIds: undefined,
    reactorIds: undefined,
    statuses: undefined,
    attention: undefined,
    linkedIssueStates: undefined,
    search: undefined,
    jumpToDate: undefined,
    thresholds: undefined,
    ...overrides,
  };
}

describe("activity filter store", () => {
  beforeEach(async () => {
    await resetActivitySavedFiltersTables();
    await seedActivityUser({ id: USER_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trims names, normalizes payloads, and orders by updated timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const first = await createSavedFilter(
      USER_ID,
      "  First Filter  ",
      createPayload({
        perPage: 50,
        repositoryIds: [" repo-1 ", "repo-1", "repo-2"],
        search: "  needs triage ",
        thresholds: {
          stalePrDays: 10,
          idlePrDays: 5,
        },
      }),
    );

    expect(first.name).toBe("First Filter");
    expect(first.payload.perPage).toBe(50);
    expect(first.payload.repositoryIds).toEqual(["repo-1", "repo-2"]);
    expect(first.payload.search).toBe("needs triage");
    expect(first.payload.thresholds).toEqual({
      stalePrDays: 10,
      idlePrDays: 5,
    });

    vi.setSystemTime(new Date("2024-01-01T01:00:00.000Z"));
    const second = await createSavedFilter(
      USER_ID,
      "Second",
      createPayload({ perPage: 25 }),
    );

    let filters = await listSavedFilters(USER_ID);
    expect(filters.map((filter) => filter.id)).toEqual([second.id, first.id]);

    vi.setSystemTime(new Date("2024-01-01T02:00:00.000Z"));
    const updateResult = await updateSavedFilter(USER_ID, first.id, {
      payload: createPayload({ repositoryIds: ["repo-2"] }),
    });
    expect(updateResult.status).toBe("ok");
    if (updateResult.status !== "ok") {
      throw new Error("Expected update to succeed");
    }
    expect(updateResult.filter.payload.repositoryIds).toEqual(["repo-2"]);

    filters = await listSavedFilters(USER_ID);
    expect(filters.map((filter) => filter.id)).toEqual([first.id, second.id]);
  });

  it("enforces saved filter limit per user", async () => {
    for (let index = 0; index < SAVED_FILTER_LIMIT; index += 1) {
      await createSavedFilter(USER_ID, `Filter ${index + 1}`, createPayload());
    }

    await expect(
      createSavedFilter(USER_ID, "Overflow", createPayload()),
    ).rejects.toBeInstanceOf(ActivitySavedFilterLimitError);
  });

  it("supports optimistic concurrency when updating filters", async () => {
    const original = await createSavedFilter(
      USER_ID,
      "Original",
      createPayload({ perPage: 25 }),
    );

    const firstUpdate = await updateSavedFilter(USER_ID, original.id, {
      name: "Renamed",
    });
    expect(firstUpdate.status).toBe("ok");
    if (firstUpdate.status !== "ok") {
      throw new Error("Expected first update to succeed");
    }
    expect(firstUpdate.filter.name).toBe("Renamed");

    const conflict = await updateSavedFilter(USER_ID, original.id, {
      payload: createPayload({ search: "conflict" }),
      expectedUpdatedAt: original.updatedAt,
    });
    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") {
      throw new Error("Expected conflict when payload is stale");
    }
    expect(conflict.filter.name).toBe("Renamed");
  });

  it("returns existing filter without changes when no updates are provided", async () => {
    const saved = await createSavedFilter(
      USER_ID,
      "Stable",
      createPayload({ perPage: 10 }),
    );

    const result = await updateSavedFilter(USER_ID, saved.id, {});
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected update to no-op successfully");
    }
    expect(result.filter.updatedAt).toBe(saved.updatedAt);
  });

  it("deletes filters with matching expectations and rejects stale deletions", async () => {
    const filter = await createSavedFilter(
      USER_ID,
      "To Delete",
      createPayload(),
    );

    const deleted = await deleteSavedFilter(USER_ID, filter.id, {
      expectedUpdatedAt: filter.updatedAt,
    });
    expect(deleted.status).toBe("deleted");

    const stored = await getSavedFilter(USER_ID, filter.id);
    expect(stored).toBeNull();

    const stale = await createSavedFilter(
      USER_ID,
      "Stale delete",
      createPayload(),
    );
    const updated = await updateSavedFilter(USER_ID, stale.id, {
      name: "Updated name",
    });
    expect(updated.status).toBe("ok");

    const conflict = await deleteSavedFilter(USER_ID, stale.id, {
      expectedUpdatedAt: stale.updatedAt,
    });
    expect(conflict.status).toBe("conflict");
    if (conflict.status !== "conflict") {
      throw new Error("Expected conflict when deleting with stale timestamp");
    }
    expect(conflict.filter.name).toBe("Updated name");
  });

  it("throws when filter name is empty or whitespace", async () => {
    await expect(
      createSavedFilter(USER_ID, "   ", createPayload()),
    ).rejects.toThrow("Filter name is required.");
  });
});

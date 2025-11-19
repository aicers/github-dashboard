import { beforeEach, describe, expect, it, vi } from "vitest";

import { resyncActivityItem } from "@/lib/activity/item-resync";

vi.mock("@/lib/activity/cache", () => ({
  refreshActivityCaches: vi.fn(),
}));

vi.mock("@/lib/activity/snapshot", () => ({
  refreshActivityItemsSnapshot: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn(),
}));

vi.mock("@/lib/github/collectors", () => ({
  reimportActivityNode: vi.fn(),
}));

vi.mock("@/lib/sync/event-bus", () => ({
  emitSyncEvent: vi.fn(),
}));

import { refreshActivityCaches } from "@/lib/activity/cache";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { ensureSchema } from "@/lib/db";
import { reimportActivityNode } from "@/lib/github/collectors";
import { emitSyncEvent } from "@/lib/sync/event-bus";

const ensureSchemaMock = vi.mocked(ensureSchema);
const refreshActivityCachesMock = vi.mocked(refreshActivityCaches);
const refreshActivityItemsSnapshotMock = vi.mocked(
  refreshActivityItemsSnapshot,
);
const reimportActivityNodeMock = vi.mocked(reimportActivityNode);
const emitSyncEventMock = vi.mocked(emitSyncEvent);

describe("resyncActivityItem", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reimportActivityNodeMock.mockResolvedValue({
      nodeId: "abc",
      type: "issue",
    });
  });

  it("trims the id, reimports the node, and refreshes artifacts", async () => {
    const logger = vi.fn();

    await expect(resyncActivityItem("  pr-123  ", { logger })).resolves.toEqual(
      {
        nodeId: "abc",
        type: "issue",
      },
    );

    expect(ensureSchemaMock).toHaveBeenCalledTimes(1);
    expect(reimportActivityNodeMock).toHaveBeenCalledWith({
      nodeId: "pr-123",
      logger,
    });
    expect(refreshActivityItemsSnapshotMock).toHaveBeenCalledWith({
      ids: ["pr-123"],
    });
    expect(refreshActivityCachesMock).toHaveBeenCalledWith({
      reason: "manual-item-resync",
    });
    expect(emitSyncEventMock).toHaveBeenCalledWith({
      type: "attention-refresh",
      scope: "all",
      trigger: "manual-override",
      timestamp: expect.any(String),
    });
    expect(logger).toHaveBeenNthCalledWith(
      1,
      "Starting manual re-import for pr-123",
    );
    expect(logger).toHaveBeenNthCalledWith(
      2,
      "Completed manual re-import for pr-123",
    );
  });

  it("propagates errors from the re-import flow and logs the failure", async () => {
    const error = new Error("resync failed");
    reimportActivityNodeMock.mockRejectedValueOnce(error);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(resyncActivityItem("issue-1")).rejects.toThrow(error);

    expect(errorSpy).toHaveBeenCalledWith(
      "[activity-resync] Failed manual re-import",
      "issue-1",
      error.message,
    );
    errorSpy.mockRestore();
  });

  it("throws when the provided id is empty", async () => {
    await expect(resyncActivityItem("  ")).rejects.toThrow(
      "Activity id is required.",
    );
    expect(ensureSchemaMock).not.toHaveBeenCalled();
  });
});

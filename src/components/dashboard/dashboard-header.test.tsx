import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncStreamEvent } from "@/lib/sync/events";
import { fetchMock, mockFetchJsonOnce } from "../../../tests/setup/mock-fetch";
import { DashboardHeader } from "./dashboard-header";

const mockRouter = {
  push: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: ComponentProps<"img">) => (
    // biome-ignore lint/performance/noImgElement: lightweight mock for tests
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

const syncListeners = new Set<(event: SyncStreamEvent) => void>();

vi.mock("@/lib/sync/client-stream", () => ({
  subscribeToSyncStream: (listener: (event: SyncStreamEvent) => void) => {
    syncListeners.add(listener);
    return () => {
      syncListeners.delete(listener);
    };
  },
}));

function emitSyncEvent(event: SyncStreamEvent) {
  syncListeners.forEach((listener) => {
    listener(event);
  });
}

describe("DashboardHeader", () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
    mockRouter.prefetch.mockReset();
    syncListeners.clear();
  });

  it("fetches notification totals using only review and mention filters", async () => {
    mockFetchJsonOnce({ pageInfo: { totalCount: 3 } });

    render(
      <DashboardHeader
        userId="user-42"
        userName="테스터"
        userLogin="tester"
        userAvatarUrl={null}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const request = fetchMock.mock.calls[0]?.[0] as Request | undefined;
    expect(request).toBeTruthy();
    if (!request) {
      return;
    }
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/activity");
    expect(url.searchParams.getAll("attention")).toEqual([
      "review_requests_pending",
      "unanswered_mentions",
    ]);
    expect(url.searchParams.getAll("reviewerId")).toEqual(["user-42"]);
    expect(url.searchParams.getAll("mentionedUserId")).toEqual(["user-42"]);
    expect(url.searchParams.getAll("peopleSelection")).toEqual(["user-42"]);

    expect(url.searchParams.getAll("authorId")).toEqual([]);
    expect(url.searchParams.getAll("assigneeId")).toEqual([]);
    expect(url.searchParams.getAll("commenterId")).toEqual([]);
    expect(url.searchParams.getAll("reactorId")).toEqual([]);
  });

  it("shows the fetched notification total in the badge and aria label", async () => {
    mockFetchJsonOnce({ pageInfo: { totalCount: 7 } });

    render(
      <DashboardHeader
        userId="user-99"
        userName="테스터"
        userLogin="tester"
        userAvatarUrl={null}
      />,
    );

    const button = await screen.findByRole("button", { name: "알림 (7건)" });
    expect(button).toBeVisible();
    expect(within(button).getByText("7")).toBeVisible();
  });

  it("navigates to the activity view with matching filters when the badge is clicked", async () => {
    mockFetchJsonOnce({ pageInfo: { totalCount: 1 } });
    const user = userEvent.setup();

    render(
      <DashboardHeader
        userId="user-77"
        userName="테스터"
        userLogin="tester"
        userAvatarUrl={null}
      />,
    );

    const button = await screen.findByRole("button", { name: "알림 (1건)" });
    await user.click(button);

    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    const target = mockRouter.push.mock.calls[0]?.[0];
    expect(typeof target).toBe("string");
    if (typeof target !== "string") {
      return;
    }
    const url = new URL(target, "https://example.com");
    expect(url.pathname).toBe("/dashboard/activity");
    expect(url.searchParams.getAll("attention")).toEqual([
      "review_requests_pending",
      "unanswered_mentions",
    ]);
    expect(url.searchParams.getAll("reviewerId")).toEqual(["user-77"]);
    expect(url.searchParams.getAll("mentionedUserId")).toEqual(["user-77"]);
    expect(url.searchParams.getAll("peopleSelection")).toEqual(["user-77"]);
  });

  it("refetches notifications when an attention refresh targets the user", async () => {
    mockFetchJsonOnce({ pageInfo: { totalCount: 1 } });

    render(
      <DashboardHeader
        userId="user-77"
        userName="테스터"
        userLogin="tester"
        userAvatarUrl={null}
      />,
    );

    await screen.findByRole("button", { name: "알림 (1건)" });

    mockFetchJsonOnce({ pageInfo: { totalCount: 4 } });

    await act(async () => {
      emitSyncEvent({
        type: "attention-refresh",
        scope: "users",
        userIds: ["user-77"],
        trigger: "manual-override",
        timestamp: new Date().toISOString(),
      });
    });

    await screen.findByRole("button", { name: "알림 (4건)" });
  });
});

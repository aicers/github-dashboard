import { CommentDiscussionIcon } from "@primer/octicons-react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildActivityItemFixture } from "@/components/test-harness/activity-fixtures";
import {
  ActivityDetailOverlay,
  DETAIL_PANEL_TRANSITION_MS,
} from "./activity-detail-overlay";
import {
  ISSUE_RELATION_BADGE_CLASS,
  MentionOverrideControls,
} from "./detail-shared";

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

const MAINTAINER_NODE_ID = "MDQ6VXNlcjE1OTMyMTQ4";

function createOverlay(
  props?: Partial<ComponentProps<typeof ActivityDetailOverlay>>,
) {
  return (
    <ActivityDetailOverlay
      item={buildActivityItemFixture({
        repository: {
          id: "repo-id",
          name: null,
          nameWithOwner: null,
          maintainerIds: [MAINTAINER_NODE_ID],
        },
        title: null,
        number: null,
        labels: [],
      })}
      iconInfo={{
        Icon: CommentDiscussionIcon,
        className: "text-primary",
        label: "Issue",
      }}
      badges={[
        "기본 배지",
        { label: "수동 판단", variant: "manual", tooltip: "관리자 판단" },
        { label: "AI 판단", variant: "ai-soft", tooltip: "AI generated" },
      ]}
      onClose={vi.fn()}
      userDirectory={{
        [MAINTAINER_NODE_ID]: {
          id: MAINTAINER_NODE_ID,
          login: "bob",
          name: "Bob",
          avatarUrl: null,
        },
      }}
      {...props}
    >
      {props?.children ?? <p>Overlay body</p>}
    </ActivityDetailOverlay>
  );
}

describe("ActivityDetailOverlay", () => {
  const originalOverflow = document.body.style.overflow;
  let requestAnimationFrameSpy: MockInstance;
  let cancelAnimationFrameSpy: MockInstance;
  type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
  const scheduledFrames = new Map<number, TimerHandle>();
  let frameCounter = 0;

  beforeEach(() => {
    if (typeof window.requestAnimationFrame !== "function") {
      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        frameCounter += 1;
        const timerId = globalThis.setTimeout(
          () => callback(performance.now()),
          16,
        );
        scheduledFrames.set(frameCounter, timerId);
        return frameCounter;
      };
    }
    if (typeof window.cancelAnimationFrame !== "function") {
      window.cancelAnimationFrame = (handle: number) => {
        const timerId = scheduledFrames.get(handle);
        if (timerId) {
          globalThis.clearTimeout(timerId);
          scheduledFrames.delete(handle);
        }
      };
    }

    frameCounter = 0;
    scheduledFrames.clear();
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCounter += 1;
        const timerId = globalThis.setTimeout(
          () => callback(performance.now()),
          0,
        );
        scheduledFrames.set(frameCounter, timerId);
        return frameCounter;
      });
    cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((handle: number) => {
        const timerId = scheduledFrames.get(handle);
        if (timerId) {
          globalThis.clearTimeout(timerId);
          scheduledFrames.delete(handle);
        }
      });
  });

  afterEach(() => {
    document.body.style.overflow = originalOverflow;
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    scheduledFrames.forEach((timerId) => {
      globalThis.clearTimeout(timerId);
    });
    scheduledFrames.clear();
    if (originalRequestAnimationFrame) {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      // @ts-expect-error restore to undefined when originally absent
      delete window.requestAnimationFrame;
    }
    if (originalCancelAnimationFrame) {
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    } else {
      // @ts-expect-error restore to undefined when originally absent
      delete window.cancelAnimationFrame;
    }
  });

  it("locks body scroll while open and restores after close via Escape", async () => {
    const onClose = vi.fn();
    const { unmount } = render(createOverlay({ onClose }));

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(
      () => {
        expect(onClose).toHaveBeenCalledTimes(1);
      },
      { timeout: DETAIL_PANEL_TRANSITION_MS + 300 },
    );

    unmount();
    expect(document.body.style.overflow).toBe(originalOverflow);
  });

  it("closes when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(createOverlay({ onClose }));

    const backdrop = document.querySelector("[aria-hidden='true']");
    expect(backdrop).toBeTruthy();
    if (!backdrop) {
      return;
    }

    fireEvent.click(backdrop);
    await waitFor(
      () => {
        expect(onClose).toHaveBeenCalledTimes(1);
      },
      { timeout: DETAIL_PANEL_TRANSITION_MS + 300 },
    );
  });

  it("renders the re-import button when a handler is provided", async () => {
    const user = userEvent.setup();
    const onResync = vi.fn();
    render(createOverlay({ onResync }));

    const button = screen.getByRole("button", {
      name: "Re-import this item",
    });
    await user.click(button);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("disables the re-import button when syncing or automatic sync is active", () => {
    render(
      createOverlay({
        onResync: vi.fn(),
        isResyncing: true,
        resyncDisabled: true,
        resyncDisabledReason: "자동 동기화 중이에요.",
      }),
    );

    const button = screen.getByRole("button", { name: "Re-importing..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "자동 동기화 중이에요.");
  });

  it("renders badge variants with expected styles and tooltips", async () => {
    const user = userEvent.setup();
    render(createOverlay());

    const manualBadge = screen.getByText("수동 판단");
    const aiBadge = screen.getByText("AI 판단");
    const defaultBadge = screen.getByText("기본 배지");

    expect(manualBadge.className).toMatch(/bg-slate-100/);
    expect(aiBadge.className).toMatch(/bg-sky-50/);
    expect(defaultBadge.className).toMatch(/bg-amber-100/);

    await user.hover(manualBadge);
    expect(
      await screen.findByRole("tooltip", { name: "관리자 판단" }),
    ).toBeInTheDocument();

    await user.unhover(manualBadge);
    await user.hover(aiBadge);
    expect(
      await screen.findByRole("tooltip", { name: "AI generated" }),
    ).toBeInTheDocument();
  });

  it("shows reference label, relation badges, extras, and item labels", async () => {
    render(
      createOverlay({
        item: buildActivityItemFixture({
          repository: {
            id: "repo-overlay",
            name: "Repo",
            nameWithOwner: "Acme/Repo",
            maintainerIds: [],
          },
          number: 42,
          state: "OPEN",
          labels: [
            {
              key: "type:bug",
              name: "Bug",
              repositoryId: "repo-overlay",
              repositoryNameWithOwner: "Acme/Repo",
            },
            {
              key: "severity:critical",
              name: "Critical",
              repositoryId: "repo-overlay",
              repositoryNameWithOwner: "Acme/Repo",
            },
          ],
        }),
        badges: [
          { label: "Parent 이슈", variant: "relation" },
          { label: "응답 요구가 아님", variant: "manual" },
          { label: "AI 판단", variant: "ai-soft" },
        ],
        badgeExtras: <span data-testid="extra-badge">추가 배지</span>,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeVisible();

    expect(screen.getByText("acme/repo#42")).toBeVisible();
    expect(screen.getByText("OPEN")).toBeVisible();

    const relationBadge = screen.getByText("Parent 이슈");
    expect(relationBadge.className).toContain(ISSUE_RELATION_BADGE_CLASS);

    const manualBadge = screen.getByText("응답 요구가 아님");
    expect(manualBadge.className).toContain("bg-slate-100");

    const aiBadge = screen.getByText("AI 판단");
    expect(aiBadge.className).toContain("bg-sky-50");

    expect(screen.getByTestId("extra-badge")).toBeVisible();
    expect(screen.getByText("Bug")).toBeVisible();
    expect(screen.getByText("Critical")).toBeVisible();
  });

  it("shows author and assignee info in the header", async () => {
    render(createOverlay());

    const people = await screen.findByTestId("activity-detail-people");
    expect(within(people).getByText("작성자")).toBeVisible();
    expect(within(people).getByText("self")).toBeVisible();
    expect(within(people).getByText("담당자")).toBeVisible();
    expect(within(people).getByText("alice")).toBeVisible();
    expect(within(people).getByText("저장소 책임자")).toBeVisible();
    expect(within(people).getByText("bob")).toBeVisible();
    expect(within(people).queryByText("리뷰어")).toBeNull();
  });

  it("shows reviewers when the item is a pull request", async () => {
    render(
      createOverlay({
        item: buildActivityItemFixture({
          type: "pull_request",
          reviewers: [
            {
              id: "reviewer-1",
              login: "reviewer1",
              name: null,
              avatarUrl: null,
            },
            {
              id: "reviewer-2",
              login: null,
              name: "Reviewer Two",
              avatarUrl: null,
            },
          ],
        }),
      }),
    );

    const people = await screen.findByTestId("activity-detail-people");
    expect(within(people).getByText("리뷰어")).toBeVisible();
    expect(within(people).getByText("reviewer1, Reviewer Two")).toBeVisible();
  });

  it("shows closed timestamp when item is closed", () => {
    render(
      createOverlay({
        item: buildActivityItemFixture({
          state: "CLOSED",
          status: "closed",
          closedAt: "2024-05-09T12:34:00.000Z",
        }),
        timezone: "UTC",
        dateTimeFormat: "iso-24h",
      }),
    );

    expect(screen.getByText("CLOSED")).toBeInTheDocument();
    expect(screen.getByText("2024-05-09 12:34")).toBeInTheDocument();
  });

  it("shows merged timestamp when item is merged", () => {
    render(
      createOverlay({
        item: buildActivityItemFixture({
          state: "MERGED",
          status: "merged",
          mergedAt: "2024-05-10T09:45:00.000Z",
        }),
        timezone: "UTC",
        dateTimeFormat: "iso-24h",
      }),
    );

    expect(screen.getByText("MERGED")).toBeInTheDocument();
    expect(screen.getByText("2024-05-10 09:45")).toBeInTheDocument();
  });

  it("handles manual mention override toggles", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(
      createOverlay({
        children: (
          <MentionOverrideControls
            value={null}
            pending={false}
            onChange={onChange}
          />
        ),
      }),
    );

    await user.click(screen.getByLabelText("응답 요구가 아님"));
    expect(onChange).toHaveBeenLastCalledWith("suppress");

    rerender(
      createOverlay({
        children: (
          <MentionOverrideControls
            value="suppress"
            pending={false}
            onChange={onChange}
          />
        ),
      }),
    );
    expect(screen.getByLabelText("응답 요구가 아님")).toBeChecked();

    await user.click(screen.getByLabelText("응답 요구가 아님"));
    expect(onChange).toHaveBeenLastCalledWith("clear");

    rerender(
      createOverlay({
        children: (
          <MentionOverrideControls
            value={null}
            pending={false}
            onChange={onChange}
          />
        ),
      }),
    );
    expect(screen.getByLabelText("응답 요구가 아님")).not.toBeChecked();

    await user.click(screen.getByLabelText("응답 요구가 맞음"));
    expect(onChange).toHaveBeenLastCalledWith("force");

    onChange.mockClear();
    rerender(
      createOverlay({
        children: (
          <MentionOverrideControls
            value={"force"}
            pending={true}
            onChange={onChange}
          />
        ),
      }),
    );

    const disabledToggle = screen.getByLabelText("응답 요구가 맞음");
    expect(disabledToggle).toBeDisabled();

    await user.click(disabledToggle);
    expect(onChange).not.toHaveBeenCalled();
    rerender(
      createOverlay({
        children: (
          <MentionOverrideControls
            value={"force"}
            pending={false}
            onChange={onChange}
          />
        ),
      }),
    );
    await user.click(screen.getByLabelText("응답 요구가 맞음"));
    expect(onChange).toHaveBeenCalledWith("clear");
  });
});

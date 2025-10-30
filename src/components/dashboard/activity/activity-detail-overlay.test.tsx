import { CommentDiscussionIcon } from "@primer/octicons-react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildActivityItemFixture } from "@/components/test-harness/activity-fixtures";
import {
  ActivityDetailOverlay,
  DETAIL_PANEL_TRANSITION_MS,
} from "./activity-detail-overlay";
import { MentionOverrideControls } from "./detail-shared";

const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;

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
          maintainerIds: [],
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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityView } from "@/components/dashboard/activity-view";
import {
  buildActivityFilterOptionsFixture,
  buildActivityItemFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import type { ActivityListParams } from "@/lib/activity/types";

import { buildActivityListParams } from "../../../tests/helpers/activity-filters";
import {
  buildActivityListResult,
  resetActivityHelperCounters,
} from "../../../tests/helpers/activity-items";
import {
  fetchMock,
  mockFetchJsonOnce,
  resetMockFetch,
  setDefaultFetchHandler,
} from "../../../tests/setup/mock-fetch";

const mockRouter = {
  replace: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

function getLastActivityCall() {
  const calls = fetchMock.mock.calls;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const [request] = calls[index] ?? [];
    if (request instanceof Request && request.url.includes("/api/activity")) {
      return request;
    }
  }
  return null;
}

function createDefaultProps(overrides?: {
  initialData?: ReturnType<typeof buildActivityListResult>;
  initialParams?: ActivityListParams;
  currentUserId?: string | null;
  currentUserIsAdmin?: boolean;
}) {
  const initialData =
    overrides?.initialData ??
    buildActivityListResult({
      items: [
        buildActivityItemFixture({
          id: "activity-1",
          title: "첫번째 이슈",
        }),
      ],
    });

  return {
    initialData,
    filterOptions: buildActivityFilterOptionsFixture(),
    initialParams:
      overrides?.initialParams ?? buildActivityListParams({ page: 1 }),
    currentUserId: overrides?.currentUserId ?? "user-1",
    currentUserIsAdmin: overrides?.currentUserIsAdmin ?? true,
  } satisfies React.ComponentProps<typeof ActivityView>;
}

describe("ActivityView", () => {
  beforeEach(() => {
    resetActivityHelperCounters();
    resetMockFetch();
    setDefaultFetchHandler({ json: {} });
    mockRouter.replace.mockReset();
  });

  it("renders initial items and pagination info", () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    expect(screen.getByText("첫번째 이슈")).toBeVisible();
    expect(screen.getByText(/페이지 1 \/ 1 \(총 1건\)/)).toBeVisible();
  });

  it("applies quick filter and fetches updated results", async () => {
    const initial = buildActivityListResult();
    const next = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "activity-2",
          title: "주의 필요한 이슈",
        }),
      ],
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps({ initialData: initial });
    render(<ActivityView {...props} />);

    mockFetchJsonOnce(next);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^확인 필요$/ }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText("주의 필요한 이슈")).toBeVisible();
    });
  });

  it("requests jump-to-date navigation", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    mockFetchJsonOnce(
      buildActivityListResultFixture({
        items: [
          buildActivityItemFixture({
            id: "activity-3",
            title: "점프 이슈",
          }),
        ],
      }),
    );

    const input = screen.getByLabelText("날짜 이동");
    fireEvent.change(input, { target: { value: "2024-05-01" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "이동" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.get("jumpTo")).toMatch(/^2024-05-01/);
    });
  });

  it("changes page and fetches next results", async () => {
    const initial = buildActivityListResultFixture({
      items: [buildActivityItemFixture({ title: "첫번째" })],
      pageInfo: { page: 1, perPage: 1, totalCount: 2, totalPages: 2 },
    });
    const next = buildActivityListResultFixture({
      items: [buildActivityItemFixture({ title: "두번째" })],
      pageInfo: { page: 2, perPage: 1, totalCount: 2, totalPages: 2 },
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchJsonOnce(next);

    const props = createDefaultProps({ initialData: initial });
    render(<ActivityView {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다음" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.get("page")).toBe("2");
    });

    await waitFor(() => {
      expect(screen.getByText("두번째")).toBeVisible();
    });
  });

  it("locks advanced people filters and clears chips for backlog attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps({
      initialParams: buildActivityListParams({
        attention: ["issue_backlog"],
        peopleSelection: ["user-alice"],
      }),
    });

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    expect(screen.queryByLabelText("Remove optional alice")).toBeNull();
    expect(screen.queryByLabelText("Remove alice")).toBeNull();

    expect(
      await screen.findByText(
        /사람 필터는 자동으로 적용되며 고급 필터에서 수정할 수 없어요/,
      ),
    ).toBeVisible();

    expect(screen.getByPlaceholderText("@user")).toBeDisabled();
    expect(screen.getByPlaceholderText("@assignee")).toBeDisabled();
    expect(screen.getByPlaceholderText("@reviewer")).toBeDisabled();
    expect(screen.getByPlaceholderText("@mention")).toBeDisabled();
    expect(screen.getByPlaceholderText("@commenter")).toBeDisabled();
    expect(screen.getByPlaceholderText("@reactor")).toBeDisabled();
  });

  it("restores manual people filter control when attention filters are removed", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps({
      initialParams: buildActivityListParams({
        attention: ["issue_backlog"],
        peopleSelection: ["user-alice"],
      }),
    });

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const attentionLabel = screen.getByText("주의");
    const attentionSection = attentionLabel.parentElement;
    expect(attentionSection).not.toBeNull();
    if (!attentionSection) {
      return;
    }

    const clearAttentionButton = within(attentionSection).getByRole("button", {
      name: "미적용",
    });
    fireEvent.click(clearAttentionButton);

    await waitFor(() => {
      expect(
        screen.queryByText(
          /사람 필터는 자동으로 적용되며 고급 필터에서 수정할 수 없어요/,
        ),
      ).toBeNull();
    });

    expect(screen.getByPlaceholderText("@user")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("@assignee")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("@reviewer")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("@mention")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("@commenter")).not.toBeDisabled();
    expect(screen.getByPlaceholderText("@reactor")).not.toBeDisabled();
  });

  it("demotes conflicting roles to optional chips when attentions disagree", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(
      screen.getByRole("button", { name: "정체된 Backlog 이슈" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "응답 없는 멘션" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const optionalButtons = await screen.findAllByLabelText(
      "Remove optional alice",
    );
    expect(optionalButtons).toHaveLength(1);
    expect(screen.queryByLabelText("Remove alice")).toBeNull();

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual([
        "issue_backlog",
        "unanswered_mentions",
      ]);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("assigneeId")).toBe(false);
      expect(url.searchParams.has("authorId")).toBe(false);
      expect(url.searchParams.has("reviewerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("provides canonical tooltips for attention filters", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const backlogButton = screen.getByRole("button", {
      name: "정체된 Backlog 이슈",
    });
    const backlogTooltipId = backlogButton.getAttribute("aria-describedby");
    expect(backlogTooltipId).toBeTruthy();
    if (backlogTooltipId) {
      const backlogTooltip = document.getElementById(backlogTooltipId);
      expect(backlogTooltip?.textContent).toContain(
        "구성원이 이슈의 해당 저장소 책임자인 항목만 표시합니다.",
      );
    }

    const stalledButton = screen.getByRole("button", {
      name: "정체된 In Progress 이슈",
    });
    const stalledTooltipId = stalledButton.getAttribute("aria-describedby");
    expect(stalledTooltipId).toBeTruthy();
    if (stalledTooltipId) {
      const stalledTooltip = document.getElementById(stalledTooltipId);
      expect(stalledTooltip?.textContent).toContain(
        "구성원이 이슈의 담당자이거나, 담당자 미정 시 해당 저장소 책임자이거나, 담당자/저장소 미지정 시 작성자인 항목만 표시합니다.",
      );
    }
  });

  it("shows assignee as applied and author as optional for stalled issue attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(
      screen.getByRole("button", { name: "정체된 In Progress 이슈" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove optional alice")).toHaveLength(1);
    });
    expect(screen.getAllByLabelText("Remove alice")).toHaveLength(1);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual(["issue_stalled"]);
      expect(url.searchParams.getAll("assigneeId")).toEqual(["user-alice"]);
      expect(url.searchParams.has("authorId")).toBe(false);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("reviewerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("applies author, assignee, and reviewer for stale PR attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "오래된 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove alice")).toHaveLength(3);
    });
    expect(screen.queryAllByLabelText("Remove optional alice")).toHaveLength(0);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual([
        "pr_open_too_long",
      ]);
      expect(url.searchParams.getAll("authorId")).toEqual(["user-alice"]);
      expect(url.searchParams.getAll("assigneeId")).toEqual(["user-alice"]);
      expect(url.searchParams.getAll("reviewerId")).toEqual(["user-alice"]);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("applies author, assignee, and reviewer for inactive PR attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "업데이트 없는 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove alice")).toHaveLength(3);
    });
    expect(screen.queryAllByLabelText("Remove optional alice")).toHaveLength(0);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual(["pr_inactive"]);
      expect(url.searchParams.getAll("authorId")).toEqual(["user-alice"]);
      expect(url.searchParams.getAll("assigneeId")).toEqual(["user-alice"]);
      expect(url.searchParams.getAll("reviewerId")).toEqual(["user-alice"]);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("applies only reviewer for review request attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(
      screen.getByRole("button", { name: "응답 없는 리뷰 요청" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove alice")).toHaveLength(1);
    });
    expect(screen.queryAllByLabelText("Remove optional alice")).toHaveLength(0);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual([
        "review_requests_pending",
      ]);
      expect(url.searchParams.getAll("reviewerId")).toEqual(["user-alice"]);
      expect(url.searchParams.has("authorId")).toBe(false);
      expect(url.searchParams.has("assigneeId")).toBe(false);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("applies only mentioned user for unanswered mention attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();
    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "응답 없는 멘션" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove alice")).toHaveLength(1);
    });
    expect(screen.queryAllByLabelText("Remove optional alice")).toHaveLength(0);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) return;
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual([
        "unanswered_mentions",
      ]);
      expect(url.searchParams.getAll("mentionedUserId")).toEqual([
        "user-alice",
      ]);
      expect(url.searchParams.has("authorId")).toBe(false);
      expect(url.searchParams.has("assigneeId")).toBe(false);
      expect(url.searchParams.has("reviewerId")).toBe(false);
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("applies maintainer-only filtering when backlog attention is active", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(
      screen.getByRole("button", { name: "정체된 Backlog 이슈" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    expect(screen.queryByLabelText("Remove optional alice")).toBeNull();

    mockFetchJsonOnce(buildActivityListResultFixture());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("maintainerId")).toEqual(["user-alice"]);
      expect(url.searchParams.get("assigneeId")).toBeNull();
      expect(url.searchParams.get("authorId")).toBeNull();
      expect(url.searchParams.get("reviewerId")).toBeNull();
      expect(url.searchParams.get("mentionedUserId")).toBeNull();
      expect(url.searchParams.get("commenterId")).toBeNull();
      expect(url.searchParams.get("reactorId")).toBeNull();
      expect(url.searchParams.getAll("attention")).toEqual(["issue_backlog"]);
    });
  });

  it("applies multiple selected people across blue roles for stale PR attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    fireEvent.click(screen.getByRole("button", { name: "오래된 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(screen.getAllByLabelText(/Remove alice/)).toHaveLength(3);
      expect(screen.getAllByLabelText(/Remove bob/)).toHaveLength(3);
    });

    mockFetchJsonOnce(buildActivityListResultFixture());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      const expected = ["user-alice", "user-bob"];
      const assertParam = (key: string) => {
        const values = url.searchParams.getAll(key);
        expect(values).toHaveLength(2);
        expect(values).toEqual(expect.arrayContaining(expected));
      };
      assertParam("authorId");
      assertParam("assigneeId");
      assertParam("reviewerId");
      expect(url.searchParams.has("maintainerId")).toBe(false);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
    });
  });

  it("honors manual people filter edits after unlocking attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "오래된 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "오래된 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const reviewerInput = screen.getByPlaceholderText("@reviewer");
    fireEvent.change(reviewerInput, { target: { value: "alice" } });
    fireEvent.keyDown(reviewerInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getAllByLabelText("Remove alice")).toHaveLength(1);
    });

    mockFetchJsonOnce(buildActivityListResultFixture());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("reviewerId")).toEqual(["user-alice"]);
      const absentKeys = [
        "authorId",
        "assigneeId",
        "mentionedUserId",
        "commenterId",
        "reactorId",
        "maintainerId",
      ];
      absentKeys.forEach((key) => {
        expect(url.searchParams.has(key)).toBe(false);
      });
    });
  });

  it("prevents removing optional chips while locked and keeps applied roles intact", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(
      screen.getByRole("button", { name: "정체된 In Progress 이슈" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const removeOptional = await screen.findByLabelText(
      "Remove optional alice",
    );
    expect(removeOptional).toBeDisabled();
    expect(screen.queryAllByLabelText("Remove optional alice")).toHaveLength(1);

    mockFetchJsonOnce(buildActivityListResultFixture());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("attention")).toEqual(["issue_stalled"]);
      expect(url.searchParams.getAll("assigneeId")).toEqual(["user-alice"]);
      const absentKeys = [
        "authorId",
        "reviewerId",
        "mentionedUserId",
        "commenterId",
        "reactorId",
        "maintainerId",
      ];
      absentKeys.forEach((key) => {
        expect(url.searchParams.has(key)).toBe(false);
      });
    });
  });

  it("restores locked state when loading saved filter payload", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps({
      initialParams: buildActivityListParams({
        attention: ["issue_backlog"],
        peopleSelection: ["user-alice"],
      }),
    });

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /주의와 구성원이 선택되면 작성자, 담당자, 리뷰어, 멘션된 구성원, 코멘터, 리액션 남긴 구성원 항목은 사용자가 제어할 수 없습니다/,
        ),
      ).toBeVisible();
    });

    expect(screen.getByRole("button", { name: "alice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    expect(screen.getByRole("button", { name: "필터 적용" })).toBeDisabled();
  });
});

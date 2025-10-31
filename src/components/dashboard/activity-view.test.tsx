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
  buildActivityItemDetailFixture,
  buildActivityItemFixture,
  buildActivityListResultFixture,
} from "@/components/test-harness/activity-fixtures";
import { fetchActivityDetail } from "@/lib/activity/client";
import type {
  ActivityFilterOptions,
  ActivityListParams,
  ActivityMentionWait,
} from "@/lib/activity/types";

import { buildActivityListParams } from "../../../tests/helpers/activity-filters";
import {
  buildActivityListResult,
  resetActivityHelperCounters,
} from "../../../tests/helpers/activity-items";
import {
  createJsonResponse,
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

vi.mock("@/lib/activity/client", () => ({
  fetchActivityDetail: vi.fn(),
}));

const fetchActivityDetailMock = vi.mocked(fetchActivityDetail);

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
  filterOptions?: ActivityFilterOptions;
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
    filterOptions:
      overrides?.filterOptions ?? buildActivityFilterOptionsFixture(),
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
    fetchActivityDetailMock.mockReset();
    fetchActivityDetailMock.mockResolvedValue(buildActivityItemDetailFixture());
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

  it("syncs 구성원 chips with manual role selections when attention is inactive", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const authorInput = screen.getByPlaceholderText("@user");
    fireEvent.change(authorInput, { target: { value: "alice" } });
    fireEvent.keyDown(authorInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByLabelText("Remove alice")).toBeVisible();
    });

    const assigneeInput = screen.getByPlaceholderText("@assignee");
    fireEvent.change(assigneeInput, { target: { value: "bob" } });
    fireEvent.keyDown(assigneeInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByLabelText("Remove bob")).toBeVisible();
    });

    const aliceToggle = screen.getByRole("button", { name: "alice" });
    const bobToggle = screen.getByRole("button", { name: "bob" });

    expect(aliceToggle).toHaveAttribute("aria-pressed", "true");
    expect(bobToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByLabelText("Remove bob"));

    await waitFor(() => {
      expect(screen.queryByLabelText("Remove bob")).toBeNull();
      expect(bobToggle).toHaveAttribute("aria-pressed", "false");
      expect(aliceToggle).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(screen.getByLabelText("Remove alice"));

    await waitFor(() => {
      expect(screen.queryByLabelText("Remove alice")).toBeNull();
      expect(aliceToggle).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("applies assignee-only filtering without attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const assigneeInput = screen.getByPlaceholderText("@assignee");
    fireEvent.change(assigneeInput, { target: { value: "alice" } });
    fireEvent.keyDown(assigneeInput, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByLabelText("Remove alice")).toBeVisible();
    });

    const nextResults = buildActivityListResultFixture({
      items: [
        buildActivityItemFixture({
          id: "assignee-filtered",
          title: "담당자 필터 테스트",
        }),
      ],
    });
    mockFetchJsonOnce(nextResults);

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
      expect(url.searchParams.getAll("assigneeId")).toEqual(["user-alice"]);
      expect(url.searchParams.getAll("peopleSelection")).toEqual(["user-alice"]);
    });

    await waitFor(() => {
      expect(screen.getByText("담당자 필터 테스트")).toBeVisible();
    });
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
      expect(url.searchParams.getAll("peopleSelection")).toEqual([
        "user-alice",
      ]);
      expect(url.searchParams.has("category")).toBe(false);
    });
  });

  it("excludes mentioned role when applying my updates quick filter", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    mockFetchJsonOnce(buildActivityListResultFixture());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "내 활동" }));
    });

    await waitFor(() => {
      const request = getLastActivityCall();
      expect(request).toBeTruthy();
      if (!request) {
        return;
      }
      const url = new URL(request.url);
      expect(url.searchParams.getAll("peopleSelection")).toEqual(["user-1"]);
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
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
      expect(url.searchParams.getAll("maintainerId")).toEqual(["user-alice"]);
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

  it("applies multiple selected people across blue roles for inactive PR attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    fireEvent.click(screen.getByRole("button", { name: "업데이트 없는 PR" }));
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
      assertParam("maintainerId");
      expect(url.searchParams.has("mentionedUserId")).toBe(false);
      expect(url.searchParams.has("commenterId")).toBe(false);
      expect(url.searchParams.has("reactorId")).toBe(false);
      expect(url.searchParams.getAll("attention")).toEqual(["pr_inactive"]);
    });
  });

  it("honors manual people filter edits after unlocking attention", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const props = createDefaultProps();

    render(<ActivityView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "업데이트 없는 PR" }));
    fireEvent.click(screen.getByRole("button", { name: "업데이트 없는 PR" }));
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

  it("surfaces current user chip even when filter options do not include the user", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });
    const baseOptions = buildActivityFilterOptionsFixture();
    const customOptions: ActivityFilterOptions = {
      ...baseOptions,
      users: [],
    };

    const props = createDefaultProps({
      filterOptions: customOptions,
      currentUserId: "user-missing",
      initialParams: buildActivityListParams({
        peopleSelection: ["user-missing"],
      }),
    });

    render(<ActivityView {...props} />);

    const userChip = await screen.findByRole("button", {
      name: "user-missing",
    });
    expect(userChip).toHaveAttribute("aria-pressed", "true");
  });

  it("applies manual mention override and updates overlay state", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });

    const mentionWait: ActivityMentionWait = {
      id: "comment-1",
      user: {
        id: "user-target",
        login: "target",
        name: "Target User",
        avatarUrl: null,
      },
      userId: "user-target",
      mentionedAt: "2024-04-01T09:00:00.000Z",
      businessDaysWaiting: 4,
      requiresResponse: true,
      manualRequiresResponse: null,
      manualRequiresResponseAt: null,
      manualDecisionIsStale: false,
      classifierEvaluatedAt: "2024-04-01T09:30:00.000Z",
    };

    const listItem = buildActivityItemFixture({
      id: "activity-mention",
      title: "Manual attention needed",
      mentionWaits: [mentionWait],
      attention: {
        unansweredMention: true,
        reviewRequestPending: false,
        staleOpenPr: false,
        idlePr: false,
        backlogIssue: false,
        stalledIssue: false,
      },
    });

    const initialData = buildActivityListResult({
      items: [listItem],
    });

    fetchActivityDetailMock.mockResolvedValueOnce(
      buildActivityItemDetailFixture({
        item: {
          ...listItem,
          mentionWaits: [mentionWait],
        },
      }),
    );

    let latestListResult = buildActivityListResultFixture({
      items: [listItem],
    });

    setDefaultFetchHandler((request) => {
      if (request.url.includes("/api/activity?")) {
        return createJsonResponse(latestListResult);
      }
      return createJsonResponse({});
    });

    const props = createDefaultProps({
      initialData,
      currentUserIsAdmin: true,
    });

    render(<ActivityView {...props} />);

    const trigger = screen.getByRole("button", {
      name: /Manual attention needed/,
    });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(fetchActivityDetailMock).toHaveBeenCalledWith(
        "activity-mention",
        expect.any(Object),
      );
    });

    const suppressToggle = await screen.findByLabelText("응답 요구가 아님");

    latestListResult = buildActivityListResultFixture({
      items: [
        {
          ...listItem,
          attention: {
            ...listItem.attention,
            unansweredMention: false,
          },
          mentionWaits: [
            {
              ...mentionWait,
              manualRequiresResponse: false,
              manualRequiresResponseAt: "2024-04-02T08:00:00.000Z",
              manualDecisionIsStale: false,
              requiresResponse: false,
            },
          ],
        },
      ],
    });

    mockFetchJsonOnce({
      success: true,
      result: {
        manualRequiresResponse: false,
        manualRequiresResponseAt: "2024-04-02T08:00:00.000Z",
        manualDecisionIsStale: false,
        requiresResponse: false,
        lastEvaluatedAt: "2024-04-02T08:30:00.000Z",
      },
    });

    fireEvent.click(suppressToggle);

    await waitFor(() => {
      expect(screen.getByText(/관리자 설정:/)).toBeInTheDocument();
    });

    expect(screen.getByLabelText("응답 요구가 아님")).toBeChecked();
  });

  it("shows stale manual decision messaging when override response is stale", async () => {
    mockFetchJsonOnce({ filters: [], limit: 5 });

    const mentionWait: ActivityMentionWait = {
      id: "comment-2",
      user: {
        id: "user-other",
        login: "other",
        name: "Other Reviewer",
        avatarUrl: null,
      },
      userId: "user-other",
      mentionedAt: "2024-04-05T09:00:00.000Z",
      businessDaysWaiting: 2,
      requiresResponse: true,
      manualRequiresResponse: null,
      manualRequiresResponseAt: null,
      manualDecisionIsStale: false,
      classifierEvaluatedAt: "2024-04-05T09:30:00.000Z",
    };

    const listItem = buildActivityItemFixture({
      id: "activity-stale",
      title: "Stale manual decision",
      mentionWaits: [mentionWait],
      attention: {
        unansweredMention: true,
        reviewRequestPending: false,
        staleOpenPr: false,
        idlePr: false,
        backlogIssue: false,
        stalledIssue: false,
      },
    });

    const initialData = buildActivityListResult({
      items: [listItem],
    });

    fetchActivityDetailMock.mockResolvedValueOnce(
      buildActivityItemDetailFixture({
        item: {
          ...listItem,
          mentionWaits: [mentionWait],
        },
      }),
    );

    let latestListResult = buildActivityListResultFixture({
      items: [listItem],
    });

    setDefaultFetchHandler((request) => {
      if (request.url.includes("/api/activity?")) {
        return createJsonResponse(latestListResult);
      }
      return createJsonResponse({});
    });

    const props = createDefaultProps({
      initialData,
      currentUserIsAdmin: true,
    });

    render(<ActivityView {...props} />);

    const trigger = screen.getByRole("button", {
      name: /Stale manual decision/,
    });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(fetchActivityDetailMock).toHaveBeenCalledWith(
        "activity-stale",
        expect.any(Object),
      );
    });

    const forceToggle = await screen.findByLabelText("응답 요구가 맞음");

    latestListResult = buildActivityListResultFixture({
      items: [
        {
          ...listItem,
          mentionWaits: [
            {
              ...mentionWait,
              manualRequiresResponse: null,
              manualRequiresResponseAt: "2024-04-06T08:00:00.000Z",
              manualDecisionIsStale: true,
              requiresResponse: true,
            },
          ],
        },
      ],
    });

    mockFetchJsonOnce({
      success: true,
      result: {
        manualRequiresResponse: true,
        manualRequiresResponseAt: "2024-04-06T08:00:00.000Z",
        manualDecisionIsStale: true,
        requiresResponse: true,
        lastEvaluatedAt: "2024-04-06T08:20:00.000Z",
      },
    });

    fireEvent.click(forceToggle);

    await waitFor(() => {
      expect(
        screen.getByText(/최근 분류 이후 관리자 설정이 다시 필요합니다/),
      ).toBeInTheDocument();
    });

    expect(screen.getByLabelText("응답 요구가 맞음")).not.toBeChecked();
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ISSUE_STATUS_OPTIONS } from "@/components/dashboard/activity/detail-shared";
import { ActivityView } from "@/components/dashboard/activity-view";
import { buildActivityFilterOptionsFixture } from "@/components/test-harness/activity-fixtures";
import { ATTENTION_OPTIONS } from "@/lib/activity/attention-options";
import type {
  ActivityListParams,
  ActivityMetadataResult,
  ActivitySavedFilter,
} from "@/lib/activity/types";

import { buildActivityListParams } from "../../../tests/helpers/activity-filters";
import {
  buildActivityItem,
  buildActivityItemDetail,
  buildActivityListResult,
  buildActivityRepository,
  buildActivityUser,
  resetActivityHelperCounters,
} from "../../../tests/helpers/activity-items";
import {
  createJsonResponse,
  fetchMock,
  mockFetchJsonOnce,
  mockFetchOnce,
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

function createDefaultProps(overrides?: {
  initialData?: ReturnType<typeof buildActivityListResult>;
  initialParams?: ActivityListParams;
  currentUserId?: string | null;
}) {
  const user = buildActivityUser({ id: "user-1", login: "octocat" });
  const repository = buildActivityRepository({
    id: "repo-1",
    nameWithOwner: "acme/repo-one",
  });

  const initialData =
    overrides?.initialData ??
    buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-1",
          title: "첫번째 이슈",
          repository,
          author: user,
        }),
      ],
    });

  return {
    initialData,
    filterOptions: {
      repositories: [repository],
      labels: [],
      users: [user],
      issueTypes: [],
      milestones: [],
      issuePriorities: [],
      issueWeights: [],
    },
    initialParams:
      overrides?.initialParams ??
      buildActivityListParams({
        page: 1,
        perPage: initialData.pageInfo.perPage,
      }),
    currentUserId:
      overrides?.currentUserId !== undefined
        ? overrides.currentUserId
        : user.id,
  };
}

beforeAll(() => {
  if (!globalThis.requestAnimationFrame) {
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
  }
  if (!globalThis.cancelAnimationFrame) {
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      clearTimeout(id as unknown as NodeJS.Timeout),
    );
  }
});

beforeEach(() => {
  resetActivityHelperCounters();
  mockRouter.replace.mockReset();
  mockRouter.prefetch.mockReset();
  mockRouter.push.mockReset();
  mockRouter.back.mockReset();
  mockRouter.forward.mockReset();
  mockRouter.refresh.mockReset();
});

describe("ActivityView", () => {
  it("applies quick filters, fetches new feed, and updates the URL query", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const nextResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-quick",
          title: "주의 항목 이슈",
        }),
      ],
    });
    mockFetchJsonOnce(nextResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const attentionButton = screen.getByRole("button", {
      name: "확인 필요",
    });
    fireEvent.click(attentionButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0];
    expect(request.url).toContain("/api/activity?");

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());

    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    expect(lastReplace).toBeTruthy();
    const [path, options] = lastReplace ?? [null, null];
    expect(options).toEqual({ scroll: false });
    expect(path?.startsWith("/dashboard/activity?")).toBe(true);

    const query = new URLSearchParams(path.split("?")[1]);
    expect(query.getAll("attention").length).toBeGreaterThanOrEqual(3);
    expect(query.getAll("attention")).toEqual(
      expect.arrayContaining([
        "issue_backlog",
        "review_requests_pending",
        "unanswered_mentions",
      ]),
    );
    expect(query.get("page")).toBeNull();

    await waitFor(() =>
      expect(screen.getByText("주의 항목 이슈")).toBeInTheDocument(),
    );

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("activating an attention while categories are unset enables the matching category", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const backlogAttention = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "정체된 Backlog 이슈" },
    );
    fireEvent.click(backlogAttention);

    const issueCategory = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );

    await waitFor(() =>
      expect(backlogAttention).toHaveAttribute("aria-pressed", "true"),
    );
    expect(issueCategory).toHaveAttribute("aria-pressed", "true");
  });

  it("shows linked pull requests in list metadata and overlay", async () => {
    const linkedRepository = buildActivityRepository({
      id: "repo-two",
      name: "repo-two",
      nameWithOwner: "acme/repo-two",
    });
    const linkedPullRequest = {
      id: "pr-linked",
      number: 42,
      title: "Fix related issue",
      state: "OPEN",
      status: "open" as const,
      repositoryNameWithOwner: linkedRepository.nameWithOwner,
      url: "https://example.com/acme/repo-two/pull/42",
      mergedAt: null,
      closedAt: null,
      updatedAt: null,
    };

    const props = createDefaultProps({
      initialData: buildActivityListResult({
        items: [
          buildActivityItem({
            title: "Linked Issue",
            repository: linkedRepository,
            linkedPullRequests: [linkedPullRequest],
          }),
        ],
      }),
    });

    mockFetchJsonOnce({ filters: [], limit: 30 });
    mockFetchJsonOnce(
      buildActivityItemDetail({
        item: props.initialData.items[0],
      }),
    );

    render(<ActivityView {...props} />);

    expect(
      await screen.findByRole("link", { name: "acme/repo-two#42" }),
    ).toBeInTheDocument();

    const itemButton = screen.getByRole("button", {
      name: /Linked Issue/i,
    });

    await act(async () => {
      fireEvent.click(itemButton);
    });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("연결된 PR")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "acme/repo-two#42" }),
    ).toBeInTheDocument();
  });

  it("adds and prunes categories based on attention selections", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const issueCategory = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const pullRequestCategory = within(
      categorySection as HTMLElement,
    ).getByRole("button", { name: "Pull Request" });

    const backlogAttention = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "정체된 Backlog 이슈" },
    );
    const inactivePrAttention = within(
      attentionSection as HTMLElement,
    ).getByRole("button", { name: "업데이트 없는 PR" });

    fireEvent.click(backlogAttention);
    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(inactivePrAttention);
    await waitFor(() =>
      expect(pullRequestCategory).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(pullRequestCategory);

    await waitFor(() =>
      expect(pullRequestCategory).toHaveAttribute("aria-pressed", "false"),
    );
    expect(issueCategory).toHaveAttribute("aria-pressed", "true");
    expect(inactivePrAttention).toHaveAttribute("aria-pressed", "false");
    expect(backlogAttention).toHaveAttribute("aria-pressed", "true");
  });

  it("turning off an active attention keeps the category selection intact", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const issueCategory = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const backlogAttention = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "정체된 Backlog 이슈" },
    );

    fireEvent.click(backlogAttention);
    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(backlogAttention);

    await waitFor(() =>
      expect(backlogAttention).toHaveAttribute("aria-pressed", "false"),
    );
    expect(issueCategory).toHaveAttribute("aria-pressed", "true");
  });

  it("clears attention filters when the last active category is removed", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const issueCategory = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const backlogAttention = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "정체된 Backlog 이슈" },
    );
    const attentionReset = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "미적용" },
    );

    fireEvent.click(backlogAttention);
    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(issueCategory);

    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "false"),
    );
    expect(backlogAttention).toHaveAttribute("aria-pressed", "false");
    expect(attentionReset).toHaveAttribute("aria-pressed", "true");
  });

  it("filters attention selections after resetting categories to 미적용", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const [categoryReset] = within(categorySection as HTMLElement).getAllByRole(
      "button",
      { name: "미적용" },
    );
    const issueCategory = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const pullRequestCategory = within(
      categorySection as HTMLElement,
    ).getByRole("button", { name: "Pull Request" });
    const backlogAttention = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "정체된 Backlog 이슈" },
    );
    const inactivePrAttention = within(
      attentionSection as HTMLElement,
    ).getByRole("button", { name: "업데이트 없는 PR" });

    fireEvent.click(backlogAttention);
    fireEvent.click(inactivePrAttention);

    await waitFor(() =>
      expect(inactivePrAttention).toHaveAttribute("aria-pressed", "true"),
    );

    fireEvent.click(categoryReset);

    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "false"),
    );
    expect(pullRequestCategory).toHaveAttribute("aria-pressed", "false");
    expect(backlogAttention).toHaveAttribute("aria-pressed", "true");
    expect(inactivePrAttention).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(issueCategory);

    await waitFor(() =>
      expect(issueCategory).toHaveAttribute("aria-pressed", "true"),
    );
    expect(backlogAttention).toHaveAttribute("aria-pressed", "true");
    expect(inactivePrAttention).toHaveAttribute("aria-pressed", "false");
  });

  it("hides issue progress controls when only the Pull Request category is selected", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const pullRequestToggle = screen.getByRole("button", {
      name: "Pull Request",
    });
    fireEvent.click(pullRequestToggle);

    await waitFor(() =>
      expect(pullRequestToggle).toHaveAttribute("aria-pressed", "true"),
    );

    expect(screen.queryByText("진행 상태")).not.toBeInTheDocument();
    expect(screen.queryByText("이슈 상태")).not.toBeInTheDocument();
  });

  it("resets the category selection to 미적용 when every category is enabled", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    expect(categorySection).not.toBeNull();
    const issueToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const pullRequestToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Pull Request" },
    );
    const discussionToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Discussion" },
    );
    const [categoryResetToggle] = within(
      categorySection as HTMLElement,
    ).getAllByRole("button", { name: "미적용" });

    fireEvent.click(issueToggle);
    fireEvent.click(pullRequestToggle);
    fireEvent.click(discussionToggle);

    await waitFor(() =>
      expect(categoryResetToggle).toHaveAttribute("aria-pressed", "true"),
    );
    expect(issueToggle).toHaveAttribute("aria-pressed", "false");
    expect(pullRequestToggle).toHaveAttribute("aria-pressed", "false");
    expect(discussionToggle).toHaveAttribute("aria-pressed", "false");
  });

  it("resets issue statuses to 미적용 when all status options are selected", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const statusLabel = screen.getByText("진행 상태");
    const statusContainer = statusLabel.parentElement;
    expect(statusContainer).not.toBeNull();
    const statusReset = within(statusContainer as HTMLElement)
      .getAllByRole("button", { name: "미적용" })
      .at(-1);
    if (!statusReset) {
      throw new Error("진행 상태 '미적용' 토글을 찾지 못했습니다.");
    }

    for (const option of ISSUE_STATUS_OPTIONS) {
      fireEvent.click(
        within(statusContainer as HTMLElement).getByRole("button", {
          name: option.label,
        }),
      );
    }

    await waitFor(() =>
      expect(statusReset).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("resets attention selection to 미적용 when all attention options are active", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const attentionSection = screen.getByText("주의").parentElement;
    expect(attentionSection).not.toBeNull();
    const resetToggle = within(attentionSection as HTMLElement).getByRole(
      "button",
      { name: "미적용" },
    );

    for (const option of ATTENTION_OPTIONS) {
      const button = within(attentionSection as HTMLElement).getByRole(
        "button",
        {
          name: option.label,
        },
      );
      fireEvent.click(button);
    }

    await waitFor(() =>
      expect(resetToggle).toHaveAttribute("aria-pressed", "true"),
    );
  });

  it("resets people selection to 미적용 when every member is toggled on", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const peopleLabel = screen.getByText("구성원");
    const peopleToggleContainer = peopleLabel.parentElement?.nextElementSibling;
    expect(peopleToggleContainer).not.toBeNull();
    const resetToggle = within(peopleToggleContainer as HTMLElement).getByRole(
      "button",
      { name: "미적용" },
    );
    const memberButton = within(peopleToggleContainer as HTMLElement).getByRole(
      "button",
      { name: "octocat" },
    );

    fireEvent.click(memberButton);

    await waitFor(() =>
      expect(resetToggle).toHaveAttribute("aria-pressed", "true"),
    );
    expect(memberButton).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps categories unchanged when enabling unanswered mentions with existing coverage", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const categorySection = screen.getByText("카테고리").parentElement;
    const attentionSection = screen.getByText("주의").parentElement;
    expect(categorySection).not.toBeNull();
    expect(attentionSection).not.toBeNull();

    const issueToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Issue" },
    );
    const pullRequestToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Pull Request" },
    );
    const discussionToggle = within(categorySection as HTMLElement).getByRole(
      "button",
      { name: "Discussion" },
    );

    fireEvent.click(issueToggle);
    fireEvent.click(pullRequestToggle);

    await waitFor(() =>
      expect(issueToggle).toHaveAttribute("aria-pressed", "true"),
    );
    await waitFor(() =>
      expect(pullRequestToggle).toHaveAttribute("aria-pressed", "true"),
    );

    const unansweredMentionToggle = within(
      attentionSection as HTMLElement,
    ).getByRole("button", { name: "응답 없는 멘션" });
    fireEvent.click(unansweredMentionToggle);

    await waitFor(() =>
      expect(unansweredMentionToggle).toHaveAttribute("aria-pressed", "true"),
    );
    expect(discussionToggle).toHaveAttribute("aria-pressed", "false");
    expect(issueToggle).toHaveAttribute("aria-pressed", "true");
    expect(pullRequestToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("disables issue-specific filters when only the Pull Request category is active", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const pullRequestToggle = screen.getByRole("button", {
      name: "Pull Request",
    });
    fireEvent.click(pullRequestToggle);

    await waitFor(() =>
      expect(pullRequestToggle).toHaveAttribute("aria-pressed", "true"),
    );

    const issueTypeLabel = screen.getByText(
      (content) => content.trim() === "이슈 Type",
    );
    const issueTypeWrapper = issueTypeLabel.closest(
      "[aria-disabled]",
    ) as HTMLDivElement | null;
    if (!issueTypeWrapper) {
      throw new Error("이슈 Type 입력 컨테이너를 찾지 못했습니다.");
    }
    expect(issueTypeWrapper).toHaveAttribute("aria-disabled", "true");
    const issueTypeInput = issueTypeWrapper.querySelector("input");
    if (issueTypeInput) {
      expect(issueTypeInput).toBeDisabled();
    }

    const issueStatusLabel = screen.getByText("이슈 상태");
    const issueStatusReset =
      issueStatusLabel.nextElementSibling as HTMLButtonElement | null;
    if (!issueStatusReset) {
      throw new Error("이슈 상태 초기화 토글을 찾지 못했습니다.");
    }
    expect(issueStatusReset).toBeDisabled();

    const linkedIssueLabel = screen.getByText("이슈 연결");
    const linkedIssueReset =
      linkedIssueLabel.nextElementSibling as HTMLButtonElement | null;
    if (!linkedIssueReset) {
      throw new Error("이슈 연결 초기화 토글을 찾지 못했습니다.");
    }
    expect(linkedIssueReset).toBeDisabled();

    const backlogThreshold = screen.getByPlaceholderText("Backlog 정체");
    expect(backlogThreshold).toBeDisabled();
  });

  it("disables pull request filters when only the Issue category is active", async () => {
    const props = createDefaultProps();
    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const issueToggle = screen.getByRole("button", { name: "Issue" });
    fireEvent.click(issueToggle);

    await waitFor(() =>
      expect(issueToggle).toHaveAttribute("aria-pressed", "true"),
    );

    const reviewerLabel = screen.getByText(
      (content) => content.trim() === "리뷰어",
    );
    const reviewerWrapper = reviewerLabel.closest(
      "[aria-disabled]",
    ) as HTMLDivElement | null;
    if (!reviewerWrapper) {
      throw new Error("리뷰어 입력 컨테이너를 찾지 못했습니다.");
    }
    expect(reviewerWrapper).toHaveAttribute("aria-disabled", "true");
    const reviewerInput = reviewerWrapper.querySelector("input");
    if (reviewerInput) {
      expect(reviewerInput).toBeDisabled();
    }

    const prStatusLabel = screen.getByText("PR 상태");
    const prStatusReset =
      prStatusLabel.nextElementSibling as HTMLButtonElement | null;
    if (!prStatusReset) {
      throw new Error("PR 상태 초기화 토글을 찾지 못했습니다.");
    }
    expect(prStatusReset).toBeDisabled();

    const prStaleInput = screen.getByPlaceholderText("PR 생성");
    expect(prStaleInput).toBeDisabled();

    const reviewThresholdInput = screen.getByPlaceholderText("리뷰 무응답");
    expect(reviewThresholdInput).toBeDisabled();
  });

  it("loads saved filters, applies the selected filter, and syncs controls", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    const savedFilter: ActivitySavedFilter = {
      id: "filter-issue",
      name: "Issues only",
      payload: buildActivityListParams({
        types: ["issue"],
        perPage: 10,
        statuses: ["open"],
      }),
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    };

    mockFetchJsonOnce({ filters: [savedFilter], limit: 20 });

    const filteredResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-filtered",
          title: "필터 적용 이슈",
        }),
      ],
      pageInfo: { perPage: 10 },
    });
    mockFetchJsonOnce(filteredResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("option", { name: "필터 선택" })
      .parentElement as HTMLSelectElement;
    fireEvent.change(select, { target: { value: savedFilter.id } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(select.value).toBe(savedFilter.id);

    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    expect(lastReplace).toBeTruthy();
    const [path, options] = lastReplace ?? [null, null];
    expect(options).toEqual({ scroll: false });
    expect(path).toBeTruthy();
    const params = new URLSearchParams((path ?? "").split("?")[1] ?? "");
    expect(params.getAll("category")).toEqual(["issue"]);
    expect(params.getAll("status")).toEqual(["open"]);
    expect(params.get("perPage")).toBe("10");

    const issueToggle = screen.getByRole("button", { name: "Issue" });
    expect(issueToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "필터 적용" })).toBeDisabled();
    expect(screen.getByText("필터 적용 이슈")).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps the saved filter selector in sync with the current draft filters", async () => {
    const props = createDefaultProps();

    const basePayload = {
      types: ["issue"] as ActivityListParams["types"],
      perPage: 10,
      statuses: ["open"] as ActivityListParams["statuses"],
    };

    const savedFilter: ActivitySavedFilter = {
      id: "filter-issue",
      name: "Issues only",
      payload: buildActivityListParams(basePayload),
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    };

    const secondarySearch = "review follow-up";

    const secondaryFilter: ActivitySavedFilter = {
      id: "filter-issue-search",
      name: "Issues with search",
      payload: buildActivityListParams({
        ...basePayload,
        search: secondarySearch,
      }),
      createdAt: "2024-02-02T00:00:00.000Z",
      updatedAt: "2024-02-02T00:00:00.000Z",
    };

    mockFetchJsonOnce({
      filters: [savedFilter, secondaryFilter],
      limit: 20,
    });

    const filteredResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-filtered",
          title: "필터 적용 이슈",
        }),
      ],
      pageInfo: { perPage: 10 },
    });
    mockFetchJsonOnce(filteredResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const select = screen.getByRole("option", { name: "필터 선택" })
      .parentElement as HTMLSelectElement;

    fireEvent.change(select, { target: { value: savedFilter.id } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(select.value).toBe(savedFilter.id));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const searchInput = screen.getByPlaceholderText("제목, 본문, 코멘트 검색");

    fireEvent.change(searchInput, {
      target: { value: "non matching search" },
    });

    await waitFor(() => expect(select.value).toBe(""));

    fireEvent.change(searchInput, { target: { value: secondarySearch } });

    await waitFor(() => expect(select.value).toBe(secondaryFilter.id));
  });

  it("opens the detail drawer, loads item details, and restores scroll locking on close", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const detailBody = "세부 내용 본문";
    mockFetchOnce({
      json: {
        item: buildActivityItem({ id: "activity-1", title: "첫번째 이슈" }),
        body: detailBody,
        bodyHtml: null,
        raw: {},
        parentIssues: [],
        subIssues: [],
        comments: [],
        commentCount: 0,
      },
      delayMs: 10,
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    expect(trigger).toBeTruthy();

    const initialOverflow = document.body.style.overflow;
    fireEvent.click(trigger);

    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));

    await screen.findByText(detailBody);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const detailRequest = fetchMock.mock.calls[1][0];
    expect(detailRequest.url).toContain("/api/activity/activity-1");

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(document.body.style.overflow).toBe(initialOverflow ?? "");

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("shows an error when detail fetch fails and recovers on retry", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({
      status: 500,
      json: { message: "Failed to load detail" },
    });
    mockFetchJsonOnce(
      buildActivityItemDetail({
        item: buildActivityItem({ id: "activity-1", title: "첫번째 이슈" }),
        body: "Recovered detail body.",
      }),
    );

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    await screen.findByText("Recovered detail body.");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    consoleError.mockRestore();
  });

  it("shows a conflict notification when status updates are locked", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchJsonOnce(
      buildActivityItemDetail({
        item: buildActivityItem({
          id: "activity-1",
          title: "첫번째 이슈",
          issueProjectStatusLocked: true,
          issueTodoProjectStatus: "done",
        }),
      }),
    );
    mockFetchOnce({
      status: 409,
      json: {
        error: "Status managed by the to-do list project.",
        todoStatus: "done",
      },
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /첫번째 이슈/ }));
    const dialog = await screen.findByRole("dialog");

    within(dialog).getByRole("button", { name: "Done" }).click();
    await waitFor(() => expect(consoleError).toHaveBeenCalled());

    consoleError.mockRestore();
  });

  it("shows an error message when saving a filter fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps({
      initialParams: buildActivityListParams({
        repositoryIds: ["repo-1"],
      }),
    });

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({
      status: 400,
      json: { message: "같은 이름의 필터가 이미 존재해요." },
    });
    mockFetchJsonOnce({ filters: [], limit: 5 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));
    const manager = await screen.findByRole("dialog");
    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, { target: { value: "Duplicate filter" } });
    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(nameInput).toHaveValue("Duplicate filter");
    expect(
      await within(manager).findByText("같은 이름의 필터가 이미 존재해요."),
    ).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("shows a feed error when activity fetch fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 5 });
    mockFetchOnce({ status: 500, json: { error: "Server error" } });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "확인 필요" }));

    await screen.findByText("활동 데이터를 불러오지 못했습니다.");

    consoleError.mockRestore();
  });

  it("saves the current filters and surfaces a success notification", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const newlySaved: ActivitySavedFilter = {
      id: "filter-saved",
      name: "Issue focus",
      payload: buildActivityListParams({
        types: ["issue"],
        perPage: props.initialData.pageInfo.perPage,
      }),
      createdAt: "2024-02-03T00:00:00.000Z",
      updatedAt: "2024-02-03T00:00:00.000Z",
    };
    mockFetchJsonOnce({ filter: newlySaved, limit: 25 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));

    const manager = await screen.findByRole("dialog");
    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, { target: { value: newlySaved.name } });

    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(newlySaved.id));

    expect(
      screen.getByRole("option", { name: newlySaved.name }),
    ).toBeInTheDocument();
    expect(screen.getByText("필터를 저장했어요.")).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("disables saving when the saved filter limit is reached", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    const savedFilters: ActivitySavedFilter[] = Array.from({ length: 2 }).map(
      (_, index) => ({
        id: `filter-${index + 1}`,
        name: `Saved filter ${index + 1}`,
        payload: buildActivityListParams({ repositoryIds: [`repo-${index}`] }),
        createdAt: `2024-02-${index + 10}T00:00:00.000Z`,
        updatedAt: `2024-02-${index + 10}T00:00:00.000Z`,
      }),
    );

    mockFetchJsonOnce({ filters: savedFilters, limit: savedFilters.length });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText(/최대 \d+개의 필터를 저장할 수 있어요/),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "현재 필터 저장" }),
    ).toBeDisabled();

    consoleError.mockRestore();
  });

  it("applies advanced filters with repository-scoped labels", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const filterOptions = buildActivityFilterOptionsFixture();

    const props = {
      ...createDefaultProps({
        initialParams: buildActivityListParams({
          labelKeys: ["bug", "feature"],
        }),
      }),
      filterOptions,
    };

    mockFetchJsonOnce({
      filters: [],
      limit: filterOptions.repositories.length,
    });

    const advancedResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-advanced",
          title: "고급 필터 적용 결과",
        }),
      ],
    });
    mockFetchJsonOnce(advancedResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "고급 필터 보기" }));

    const repoInput = screen.getByPlaceholderText("저장소 선택");
    fireEvent.focus(repoInput);
    fireEvent.change(repoInput, { target: { value: "acme" } });
    fireEvent.keyDown(repoInput, { key: "Enter", code: "Enter", charCode: 13 });
    expect(screen.getByText("acme/alpha")).toBeInTheDocument();
    expect(screen.queryByText("feature")).not.toBeInTheDocument();

    const labelInput = screen.getByPlaceholderText("repo:label");
    fireEvent.focus(labelInput);
    fireEvent.change(labelInput, { target: { value: "bug" } });
    fireEvent.keyDown(labelInput, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => expect(screen.getByText("bug")).toBeInTheDocument());
    expect(screen.queryByText("feature")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.getAll("repositoryId")).toEqual(["repo-alpha"]);
    expect(url.searchParams.getAll("labelKey")).toEqual(["bug"]);

    await waitFor(() =>
      expect(screen.getByText("고급 필터 적용 결과")).toBeInTheDocument(),
    );

    consoleError.mockRestore();
  });

  it("paginates activity items and shows the empty state on later pages", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const initialData = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "activity-initial",
          title: "Initial activity",
        }),
      ],
      pageInfo: {
        perPage: 25,
        requestedPages: 1,
        bufferedPages: 1,
        bufferedUntilPage: 1,
        hasMore: true,
      },
    });

    const props = createDefaultProps({ initialData });

    mockFetchJsonOnce({ filters: [], limit: 30 });

    const emptyResult = buildActivityListResult({
      items: [],
      pageInfo: {
        page: 2,
        perPage: 25,
        requestedPages: 1,
        bufferedPages: 0,
        bufferedUntilPage: 2,
        hasMore: false,
      },
    });
    mockFetchJsonOnce(emptyResult);

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText("페이지 1 / 1+")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이전" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const request = fetchMock.mock.calls[1][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.get("page")).toBe("2");

    await waitFor(() =>
      expect(
        screen.getByText("필터 조건에 맞는 활동이 없습니다."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("페이지 2 / 2")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "이전" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    const lastReplace = mockRouter.replace.mock.calls.at(-1);
    const [path] = lastReplace ?? [""];
    const params = new URLSearchParams((path ?? "").split("?")[1] ?? "");
    expect(params.get("page")).toBe("2");

    consoleError.mockRestore();
  });

  it("blocks saving when the payload matches a built-in quick filter", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));
    const manager = await screen.findByRole("dialog");

    const nameInput = within(manager).getByPlaceholderText("필터 이름");
    fireEvent.change(nameInput, {
      target: { value: "Duplicate quick filter" },
    });

    fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(
      within(manager).getByText(
        "기본 빠른 필터와 동일한 설정은 저장할 수 없어요.",
      ),
    ).toBeInTheDocument();

    expect(nameInput).toHaveValue("Duplicate quick filter");

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("manages saved filters through rename, replace, and delete actions", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const existingPayload = buildActivityListParams({
      types: ["pull_request"],
      perPage: 25,
    });
    const existingFilter: ActivitySavedFilter = {
      id: "filter-manage",
      name: "Pull requests",
      payload: existingPayload,
      createdAt: "2024-02-10T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
    };
    const renamedFilter: ActivitySavedFilter = {
      ...existingFilter,
      name: "Renamed filter",
      updatedAt: "2024-02-11T00:00:00.000Z",
    };
    const replacedPayload = buildActivityListParams({
      types: ["pull_request", "issue"],
      perPage: 25,
    });
    const replacedFilter: ActivitySavedFilter = {
      ...renamedFilter,
      payload: replacedPayload,
      updatedAt: "2024-02-12T00:00:00.000Z",
    };

    mockFetchJsonOnce({ filters: [existingFilter], limit: 30 });
    mockFetchJsonOnce({ filter: renamedFilter, limit: 30 });
    mockFetchJsonOnce({ filter: replacedFilter, limit: 30 });
    mockFetchJsonOnce({ filter: replacedFilter, limit: 30 });

    const props = createDefaultProps({
      initialParams: existingPayload,
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "필터 관리" }));

    const manager = screen.getByRole("dialog");
    const nameInput = within(manager).getByDisplayValue(existingFilter.name);
    fireEvent.change(nameInput, { target: { value: renamedFilter.name } });
    fireEvent.click(within(manager).getByRole("button", { name: "이름 저장" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await within(manager).findByText("필터 이름을 업데이트했어요.");
    expect(
      within(manager).getByDisplayValue(renamedFilter.name),
    ).toBeInTheDocument();
    expect(
      within(manager).queryByText("필터를 삭제했어요."),
    ).not.toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Issue" }));

    fireEvent.click(screen.getByRole("button", { name: "필터 관리" }));
    const managerAfterToggle = screen.getByRole("dialog");
    expect(
      within(managerAfterToggle).queryByText("필터 이름을 업데이트했어요."),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(managerAfterToggle).getByRole("button", {
        name: "현재 필터로 업데이트",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await within(managerAfterToggle).findByText(
      "필터 조건을 최신 설정으로 업데이트했어요.",
    );

    fireEvent.click(
      within(managerAfterToggle).getByRole("button", { name: "삭제" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await within(managerAfterToggle).findByText("필터를 삭제했어요.");
    expect(
      within(managerAfterToggle).getByText(/저장된 필터가 아직 없어요/),
    ).toBeInTheDocument();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("retries detail loading after an error and shows the eventual success", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });
    mockFetchOnce({
      status: 500,
      json: { message: "Detail failed" },
    });

    const detail = buildActivityItemDetail({
      item: props.initialData.items[0],
      body: "Detail body loaded",
    });

    let releaseDetail: (() => void) | null = null;
    mockFetchOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseDetail = resolve;
      });
      return createJsonResponse(detail);
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(consoleError).toHaveBeenCalled();
    await waitFor(() => expect(releaseDetail).not.toBeNull());

    expect(await screen.findByText("Loading details...")).toBeInTheDocument();

    await act(async () => {
      releaseDetail?.();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await screen.findByText("Detail body loaded");

    expect(
      screen.queryByText("선택한 항목의 내용을 불러오지 못했습니다."),
    ).not.toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("aborts the detail request when the drawer closes before completion", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    let aborted = false;
    mockFetchOnce((_request, signal) => {
      return new Promise<never>((_resolve, reject) => {
        if (signal?.aborted) {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const trigger = screen
      .getByText("첫번째 이슈")
      .closest("[role='button']") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(aborted).toBe(true));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("clears the notification message after the timer elapses", async () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const props = createDefaultProps();

      mockFetchJsonOnce({ filters: [], limit: 30 });

      const newlySaved: ActivitySavedFilter = {
        id: "filter-saved",
        name: "Issue focus",
        payload: buildActivityListParams({
          types: ["issue"],
        }),
        createdAt: "2024-02-03T00:00:00.000Z",
        updatedAt: "2024-02-03T00:00:00.000Z",
      };
      mockFetchJsonOnce({ filter: newlySaved, limit: 30 });

      render(<ActivityView {...props} />);

      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Issue" }));
      fireEvent.click(screen.getByRole("button", { name: "현재 필터 저장" }));

      await act(async () => {});
      const manager = screen.getByRole("dialog");

      fireEvent.change(within(manager).getByPlaceholderText("필터 이름"), {
        target: { value: newlySaved.name },
      });
      fireEvent.click(within(manager).getByRole("button", { name: "저장" }));

      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      expect(screen.getByText("필터를 저장했어요.")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      await act(async () => {});

      expect(screen.queryByText("필터를 저장했어요.")).not.toBeInTheDocument();

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      consoleError.mockRestore();
    }
  });

  it("invokes jump-to-date fetches with the normalized timestamp", async () => {
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const metadataButton = screen.getByRole("button", {
      name: "전체 현황 불러오기",
    });
    const jumpButton = screen.getByRole("button", { name: "이동" });
    expect(jumpButton).toBeDisabled();

    const dateInput =
      document.querySelector<HTMLInputElement>('input[type="date"]');
    expect(dateInput).not.toBeNull();
    const inputElement = dateInput as HTMLInputElement;
    expect(inputElement).toBeDisabled();

    const metadataResponse = {
      pageInfo: {
        page: 1,
        perPage: 25,
        totalCount: 40,
        totalPages: 2,
        isPrefetch: false,
        requestToken: "prefetch-token",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T00:05:00.000Z",
      },
      jumpTo: [],
      lastSyncCompletedAt: props.initialData.lastSyncCompletedAt,
      timezone: props.initialData.timezone,
      dateTimeFormat: props.initialData.dateTimeFormat,
    } satisfies ActivityMetadataResult;

    mockFetchJsonOnce(metadataResponse);
    fireEvent.click(metadataButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(jumpButton).not.toBeDisabled());
    expect(inputElement).not.toBeDisabled();

    fetchMock.mockClear();

    const jumpResult = buildActivityListResult({
      items: [
        buildActivityItem({
          id: "jumped",
          title: "Jump result",
        }),
      ],
      pageInfo: { perPage: 25 },
    });

    mockFetchJsonOnce(jumpResult);

    fireEvent.change(inputElement, { target: { value: "2024-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "이동" }));

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0][0];
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/activity");

    const jumpTo = url.searchParams.get("jumpTo");
    expect(jumpTo).toBe("2024-04-01T00:00Z");

    expect(screen.getByText("Jump result")).toBeInTheDocument();
  });

  it("fetches pagination metadata on demand", async () => {
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockClear();

    const metadataResponse = {
      pageInfo: {
        page: 1,
        perPage: 25,
        totalCount: 42,
        totalPages: 3,
        isPrefetch: false,
        requestToken: "prefetch-token",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T00:05:00.000Z",
      },
      jumpTo: [],
      lastSyncCompletedAt: props.initialData.lastSyncCompletedAt,
      timezone: props.initialData.timezone,
      dateTimeFormat: props.initialData.dateTimeFormat,
    } satisfies ActivityMetadataResult;

    mockFetchJsonOnce(metadataResponse);

    const metadataButton = screen.getByRole("button", {
      name: "전체 현황 불러오기",
    });
    const jumpButton = screen.getByRole("button", { name: "이동" });
    expect(jumpButton).toBeDisabled();
    fireEvent.click(metadataButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.get("mode")).toBe("summary");
    expect(url.searchParams.get("token")).toBe("prefetch-token");
    expect(url.searchParams.get("prefetchPages")).toBe("3");

    await waitFor(() =>
      expect(screen.getByText("페이지 1 / 3 (총 42건)")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "전체 현황 새로고침" }),
    ).toBeInTheDocument();
    expect(jumpButton).not.toBeDisabled();
  });

  it("ignores stale metadata responses", async () => {
    const props = createDefaultProps();

    mockFetchJsonOnce({ filters: [], limit: 30 });

    render(<ActivityView {...props} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockClear();

    const staleMetadata = {
      pageInfo: {
        page: 1,
        perPage: 25,
        totalCount: 99,
        totalPages: 5,
        isPrefetch: false,
        requestToken: "stale-token",
        issuedAt: "2024-01-01T00:00:00.000Z",
        expiresAt: "2024-01-01T00:05:00.000Z",
      },
      jumpTo: [],
      lastSyncCompletedAt: props.initialData.lastSyncCompletedAt,
      timezone: props.initialData.timezone,
      dateTimeFormat: props.initialData.dateTimeFormat,
    } satisfies ActivityMetadataResult;

    mockFetchJsonOnce(staleMetadata);

    fireEvent.click(screen.getByRole("button", { name: "전체 현황 불러오기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const displays = screen.getAllByText((content) =>
        content.includes("페이지 1 / 1"),
      );
      expect(displays.length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      const counts = screen.getAllByText((content) =>
        content.includes("총 —건"),
      );
      expect(counts.length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: "이동" })).toBeDisabled();
  });

  it("shows an error when saved filters fail to load", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const props = createDefaultProps();

    mockFetchOnce({
      status: 500,
      json: { message: "boom" },
    });

    render(<ActivityView {...props} />);

    await act(async () => {});
    await act(async () => {});

    expect(
      screen.getByText("저장된 필터를 불러오지 못했어요."),
    ).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

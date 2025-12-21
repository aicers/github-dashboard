import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  PullRequestAttentionItem,
  RepositoryReference,
  UserReference,
} from "@/lib/dashboard/attention";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

function buildUser(id: string, name: string, login: string): UserReference {
  return {
    id,
    name,
    login,
  } satisfies UserReference;
}

function buildRepository(
  id: string,
  name: string,
  nameWithOwner: string,
): RepositoryReference {
  return {
    id,
    name,
    nameWithOwner,
  } satisfies RepositoryReference;
}

function buildPullRequestItem(params: {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: RepositoryReference;
  author: UserReference;
  reviewers: UserReference[];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays?: number;
  waitingDays: number;
}): PullRequestAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    createdAt,
    updatedAt,
    ageDays,
    inactivityDays,
    waitingDays,
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    linkedIssues: [],
    createdAt,
    updatedAt,
    ageDays,
    inactivityDays,
    waitingDays,
  } satisfies PullRequestAttentionItem;
}

describe("AttentionView merge-delayed pull requests", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows merge-delayed PR overview, interactive filters, and refresh control", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");

    const repoOne = buildRepository("repo-one", "repo-one", "acme/repo-one");
    const repoTwo = buildRepository("repo-two", "repo-two", "acme/repo-two");

    const mergeDelayedItems: PullRequestAttentionItem[] = [
      buildPullRequestItem({
        id: "pr-1",
        number: 101,
        title: "Refine search experience",
        url: "https://github.com/acme/repo-one/pull/101",
        repository: repoOne,
        author: alice,
        reviewers: [bob],
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2024-01-15T10:00:00.000Z",
        ageDays: 60,
        waitingDays: 40,
      }),
      buildPullRequestItem({
        id: "pr-2",
        number: 102,
        title: "Fix caching logic",
        url: "https://github.com/acme/repo-two/pull/102",
        repository: repoTwo,
        author: bob,
        reviewers: [carol],
        createdAt: "2023-12-15T00:00:00.000Z",
        updatedAt: "2024-02-10T08:00:00.000Z",
        ageDays: 40,
        waitingDays: 20,
      }),
    ];

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [],
      reviewStalledPrs: [],
      mergeDelayedPrs: mergeDelayedItems,
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 작성자: 1위 Alice, 2위 Bob"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 리뷰어: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();
    expect(screen.getByText("2건")).toBeInTheDocument();
    expect(screen.getByText("60일")).toBeInTheDocument();

    const overviewButton = screen.getByRole("button", { name: /머지 지연 PR/ });
    await user.click(overviewButton);

    expect(screen.getByText("2 업무일 이상 머지 지연 PR")).toBeInTheDocument();
    expect(screen.getByText("Refine search experience")).toBeInTheDocument();
    expect(screen.getByText("Fix caching logic")).toBeInTheDocument();

    const firstPrItem = screen
      .getByText("Refine search experience")
      .closest("li");
    const secondPrItem = screen.getByText("Fix caching logic").closest("li");
    expect(firstPrItem).not.toBeNull();
    expect(secondPrItem).not.toBeNull();

    if (!firstPrItem || !secondPrItem) {
      throw new Error("Expected list items to exist in the DOM");
    }

    expect(within(firstPrItem).getByText("Age 40일")).toBeInTheDocument();
    expect(
      within(firstPrItem).getByText("작성자 Alice (@alice)"),
    ).toBeInTheDocument();
    expect(
      within(firstPrItem).getByText("리뷰어 Bob (@bob)"),
    ).toBeInTheDocument();

    expect(within(secondPrItem).getByText("Age 20일")).toBeInTheDocument();
    expect(
      within(secondPrItem).getByText("작성자 Bob (@bob)"),
    ).toBeInTheDocument();
    expect(
      within(secondPrItem).getByText("리뷰어 Carol (@carol)"),
    ).toBeInTheDocument();

    expect(
      screen.getByText("작성자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("작성자 필터");
    await user.selectOptions(authorFilter, "user-bob");

    expect(screen.getByText("Fix caching logic")).toBeInTheDocument();
    expect(
      screen.queryByText("Refine search experience"),
    ).not.toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

    const reviewerFilter = screen.getByLabelText("리뷰어 필터");
    await user.selectOptions(reviewerFilter, "user-bob");

    expect(screen.getByText("Refine search experience")).toBeInTheDocument();
    expect(screen.queryByText("Fix caching logic")).not.toBeInTheDocument();

    await user.selectOptions(reviewerFilter, "all");

    const refreshButton = screen.getByRole("button", {
      name: "Follow-ups 통계 새로 고침",
    });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders empty state messaging when no merge-delayed pull requests exist", async () => {
    const user = userEvent.setup();
    const emptyInsights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "UTC",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [],
      reviewStalledPrs: [],
      mergeDelayedPrs: [],
      stuckReviewRequests: [],
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={emptyInsights} />);

    expect(screen.getAllByText("0건").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0일").length).toBeGreaterThan(0);
    expect(screen.queryByText(/최다 작성자:/)).not.toBeInTheDocument();

    const mergeDelayedButton = screen.getByRole("button", {
      name: /머지 지연 PR/,
    });
    await user.click(mergeDelayedButton);

    expect(
      screen.getByText("현재 조건을 만족하는 PR이 없습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("작성자 기준 경과일수 합계 순위"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("작성자 데이터가 없습니다.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("작성자 필터")).toBeInTheDocument();
    expect(screen.queryByLabelText("리뷰어 필터")).not.toBeInTheDocument();
  });
});

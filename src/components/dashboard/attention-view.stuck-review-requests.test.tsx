import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  PullRequestReference,
  RepositoryReference,
  ReviewRequestAttentionItem,
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

function buildPullRequestReference(params: {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: RepositoryReference;
  author: UserReference;
  reviewers: UserReference[];
  linkedIssues?: PullRequestReference["linkedIssues"];
}): PullRequestReference {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    linkedIssues = [],
  } = params;
  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    linkedIssues,
  } satisfies PullRequestReference;
}

function buildReviewRequestItem(params: {
  id: string;
  requestedAt: string;
  waitingDays: number;
  reviewer: UserReference;
  pullRequest: PullRequestReference;
}): ReviewRequestAttentionItem {
  const { id, requestedAt, waitingDays, reviewer, pullRequest } = params;
  return {
    id,
    requestedAt,
    waitingDays,
    reviewer,
    pullRequest,
  } satisfies ReviewRequestAttentionItem;
}

describe("AttentionView stuck review requests", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("shows stuck review overview, rankings, filters, and list interactions", async () => {
    const user = userEvent.setup();

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");
    const dave = buildUser("user-dave", "Dave", "dave");
    const frank = buildUser("user-frank", "Frank", "frank");

    const primaryRepo = buildRepository(
      "repo-primary",
      "github-dashboard",
      "acme/github-dashboard",
    );

    const stuckItems: ReviewRequestAttentionItem[] = [
      buildReviewRequestItem({
        id: "rr-optimizations",
        requestedAt: "2024-02-07T09:00:00.000Z",
        waitingDays: 7,
        reviewer: carol,
        pullRequest: buildPullRequestReference({
          id: "pr-cache-refresh",
          number: 320,
          title: "Stabilize background cache refresh",
          url: "https://github.com/acme/github-dashboard/pull/320",
          repository: primaryRepo,
          author: alice,
          reviewers: [carol, frank],
        }),
      }),
      buildReviewRequestItem({
        id: "rr-optimizations-frank",
        requestedAt: "2024-02-08T09:00:00.000Z",
        waitingDays: 5,
        reviewer: frank,
        pullRequest: buildPullRequestReference({
          id: "pr-cache-refresh",
          number: 320,
          title: "Stabilize background cache refresh",
          url: "https://github.com/acme/github-dashboard/pull/320",
          repository: primaryRepo,
          author: alice,
          reviewers: [carol, frank],
        }),
      }),
      buildReviewRequestItem({
        id: "rr-indexing",
        requestedAt: "2024-02-06T09:00:00.000Z",
        waitingDays: 11,
        reviewer: dave,
        pullRequest: buildPullRequestReference({
          id: "pr-db-indexing",
          number: 321,
          title: "Optimize database indexing latency",
          url: "https://github.com/acme/github-dashboard/pull/321",
          repository: primaryRepo,
          author: bob,
          reviewers: [dave, frank],
        }),
      }),
    ];

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [],
      reviewStalledPrs: [],
      mergeDelayedPrs: [],
      stuckReviewRequests: stuckItems,
      backlogIssues: [],
      stalledInProgressIssues: [],
      unansweredMentions: [],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    expect(
      screen.getByText("최다 작성자: 1위 Bob, 2위 Alice"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("최다 대기 리뷰어: 1위 Dave, 2위 Carol"),
    ).toBeInTheDocument();

    const stuckButton = screen.getByRole("button", {
      name: /응답 없는 리뷰 요청/,
    });
    await user.click(stuckButton);

    expect(
      screen.getByText(
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("작성자 대기일수 합계 순위")).toBeInTheDocument();
    expect(screen.getByText("작성자 건수 순위")).toBeInTheDocument();
    expect(screen.getByText("리뷰어 대기일수 합계 순위")).toBeInTheDocument();
    expect(screen.getByText("리뷰어 건수 순위")).toBeInTheDocument();

    const authorFilter = screen.getByLabelText("작성자 필터");
    const reviewerFilter = screen.getByLabelText("리뷰어 필터");

    const indexingItem = screen
      .getByText("Optimize database indexing latency")
      .closest("li");
    const cacheItem = screen
      .getByText("Stabilize background cache refresh")
      .closest("li");

    expect(indexingItem).not.toBeNull();
    expect(cacheItem).not.toBeNull();

    if (!indexingItem || !cacheItem) {
      throw new Error("Expected stuck review request items to exist");
    }

    expect(
      screen.getAllByText("Stabilize background cache refresh").length,
    ).toBe(1);

    expect(within(indexingItem).getByText("Idle 11일")).toBeInTheDocument();
    expect(within(indexingItem).getByText("작성자 bob")).toBeInTheDocument();
    expect(within(indexingItem).getByText("Review 11일")).toBeInTheDocument();

    expect(within(cacheItem).getByText("Idle 7일")).toBeInTheDocument();
    expect(within(cacheItem).getByText("작성자 alice")).toBeInTheDocument();
    expect(within(cacheItem).getByText("Review 7일, 5일")).toBeInTheDocument();

    await user.selectOptions(authorFilter, "user-bob");
    expect(
      screen.getByText("Optimize database indexing latency"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stabilize background cache refresh"),
    ).not.toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");

    await user.selectOptions(reviewerFilter, "user-carol");
    expect(
      screen.getByText("Stabilize background cache refresh"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Optimize database indexing latency"),
    ).not.toBeInTheDocument();

    await user.selectOptions(reviewerFilter, "all");

    await user.selectOptions(authorFilter, "user-alice");
    await user.selectOptions(reviewerFilter, "user-dave");
    expect(
      screen.getByText("현재 조건을 만족하는 리뷰 요청이 없습니다."),
    ).toBeInTheDocument();

    await user.selectOptions(authorFilter, "all");
    await user.selectOptions(reviewerFilter, "all");

    const refreshButton = screen.getByRole("button", {
      name: "Follow-ups 통계 새로 고침",
    });
    await user.click(refreshButton);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("renders empty state messaging when no stuck review requests exist", async () => {
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
    expect(screen.queryByText(/최다 대기 리뷰어/)).not.toBeInTheDocument();

    const stuckButton = screen.getByRole("button", {
      name: /응답 없는 리뷰 요청/,
    });
    await user.click(stuckButton);

    expect(
      screen.getByText("현재 조건을 만족하는 리뷰 요청이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("작성자 대기일수 합계 순위")).toBeInTheDocument();
    expect(
      screen.getAllByText("작성자 데이터가 없습니다.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText("작성자 필터")).toBeInTheDocument();
    expect(screen.queryByLabelText("리뷰어 필터")).not.toBeInTheDocument();
  });
});

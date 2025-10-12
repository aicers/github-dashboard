import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionView } from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
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
  } = params;

  return {
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
  } satisfies PullRequestAttentionItem;
}

function buildReviewRequestItem(params: {
  id: string;
  requestedAt: string;
  waitingDays: number;
  reviewer: UserReference | null;
  pullRequest: PullRequestAttentionItem;
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

function buildIssueItem(params: {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: RepositoryReference;
  author: UserReference | null;
  assignees: UserReference[];
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  startedAt: string | null;
  inProgressAgeDays?: number;
}): IssueAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
  } = params;

  return {
    id,
    number,
    title,
    url,
    repository,
    author,
    assignees,
    createdAt,
    updatedAt,
    ageDays,
    startedAt,
    inProgressAgeDays,
  } satisfies IssueAttentionItem;
}

function buildMentionItem(params: {
  commentId: string;
  url: string;
  mentionedAt: string;
  waitingDays: number;
  author: UserReference | null;
  target: UserReference | null;
  container: MentionAttentionItem["container"];
  commentExcerpt: string;
}): MentionAttentionItem {
  const {
    commentId,
    url,
    mentionedAt,
    waitingDays,
    author,
    target,
    container,
    commentExcerpt,
  } = params;
  return {
    commentId,
    url,
    mentionedAt,
    waitingDays,
    author,
    target,
    container,
    commentExcerpt,
  } satisfies MentionAttentionItem;
}

describe("Follow-up overview", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("renders aggregate summaries and allows quick navigation to sections", async () => {
    const user = userEvent.setup();

    const repoMain = buildRepository("repo-main", "main", "acme/main");
    const repoOps = buildRepository("repo-ops", "ops", "acme/ops");

    const alice = buildUser("user-alice", "Alice", "alice");
    const bob = buildUser("user-bob", "Bob", "bob");
    const carol = buildUser("user-carol", "Carol", "carol");
    const dave = buildUser("user-dave", "Dave", "dave");
    const erin = buildUser("user-erin", "Erin", "erin");
    const frank = buildUser("user-frank", "Frank", "frank");
    const grace = buildUser("user-grace", "Grace", "grace");
    const hank = buildUser("user-hank", "Hank", "hank");

    const staleOne = buildPullRequestItem({
      id: "pr-stale-1",
      number: 101,
      title: "Refine caching layer",
      url: "https://github.com/acme/main/pull/101",
      repository: repoMain,
      author: alice,
      reviewers: [bob, carol],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
      ageDays: 40,
    });
    const staleTwo = buildPullRequestItem({
      id: "pr-stale-2",
      number: 102,
      title: "Normalize metrics schema",
      url: "https://github.com/acme/main/pull/102",
      repository: repoMain,
      author: bob,
      reviewers: [bob],
      createdAt: "2024-01-08T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
      ageDays: 20,
    });

    const idleOne = buildPullRequestItem({
      id: "pr-idle-1",
      number: 201,
      title: "Optimize background jobs",
      url: "https://github.com/acme/main/pull/201",
      repository: repoMain,
      author: carol,
      reviewers: [erin],
      createdAt: "2024-02-05T00:00:00.000Z",
      updatedAt: "2024-02-06T00:00:00.000Z",
      ageDays: 12,
      inactivityDays: 11,
    });
    const idleTwo = buildPullRequestItem({
      id: "pr-idle-2",
      number: 202,
      title: "Improve pipeline visibility",
      url: "https://github.com/acme/ops/pull/202",
      repository: repoOps,
      author: dave,
      reviewers: [frank],
      createdAt: "2024-02-06T00:00:00.000Z",
      updatedAt: "2024-02-07T00:00:00.000Z",
      ageDays: 11,
      inactivityDays: 10,
    });

    const stuckOne = buildReviewRequestItem({
      id: "rr-erin",
      requestedAt: "2024-02-06T00:00:00.000Z",
      waitingDays: 7,
      reviewer: erin,
      pullRequest: staleOne,
    });
    const stuckTwo = buildReviewRequestItem({
      id: "rr-frank",
      requestedAt: "2024-02-07T00:00:00.000Z",
      waitingDays: 5,
      reviewer: frank,
      pullRequest: idleTwo,
    });

    const backlogOne = buildIssueItem({
      id: "issue-backlog-1",
      number: 401,
      title: "Revisit onboarding flow",
      url: "https://github.com/acme/main/issues/401",
      repository: repoMain,
      author: alice,
      assignees: [bob],
      createdAt: "2023-12-01T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
      ageDays: 55,
      startedAt: null,
    });
    const backlogTwo = buildIssueItem({
      id: "issue-backlog-2",
      number: 402,
      title: "Clarify SLA for backlog",
      url: "https://github.com/acme/main/issues/402",
      repository: repoMain,
      author: carol,
      assignees: [dave],
      createdAt: "2023-12-05T00:00:00.000Z",
      updatedAt: "2024-02-11T00:00:00.000Z",
      ageDays: 50,
      startedAt: null,
    });

    const stalledOne = buildIssueItem({
      id: "issue-stalled-1",
      number: 501,
      title: "Release automation stuck",
      url: "https://github.com/acme/main/issues/501",
      repository: repoOps,
      author: erin,
      assignees: [frank],
      createdAt: "2023-12-10T00:00:00.000Z",
      updatedAt: "2024-02-12T00:00:00.000Z",
      ageDays: 60,
      startedAt: "2023-12-15T00:00:00.000Z",
      inProgressAgeDays: 45,
    });
    const stalledTwo = buildIssueItem({
      id: "issue-stalled-2",
      number: 502,
      title: "Analytics revamp blocked",
      url: "https://github.com/acme/ops/issues/502",
      repository: repoOps,
      author: grace,
      assignees: [hank],
      createdAt: "2024-01-05T00:00:00.000Z",
      updatedAt: "2024-02-13T00:00:00.000Z",
      ageDays: 35,
      startedAt: "2024-01-10T00:00:00.000Z",
      inProgressAgeDays: 30,
    });

    const mentionOne = buildMentionItem({
      commentId: "comment-1",
      url: "https://github.com/acme/main/pull/101#comment-1",
      mentionedAt: "2024-02-07T00:00:00.000Z",
      waitingDays: 6,
      author: alice,
      target: grace,
      container: {
        type: "pull_request",
        id: staleOne.id,
        number: staleOne.number,
        title: staleOne.title,
        url: staleOne.url,
        repository: repoMain,
      },
      commentExcerpt: "@grace please review",
    });
    const mentionTwo = buildMentionItem({
      commentId: "comment-2",
      url: "https://github.com/acme/main/issues/402#comment-2",
      mentionedAt: "2024-02-08T00:00:00.000Z",
      waitingDays: 5,
      author: bob,
      target: hank,
      container: {
        type: "issue",
        id: backlogTwo.id,
        number: backlogTwo.number,
        title: backlogTwo.title,
        url: backlogTwo.url,
        repository: repoMain,
      },
      commentExcerpt: "@hank need an update",
    });

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      staleOpenPrs: [staleOne, staleTwo],
      idleOpenPrs: [idleOne, idleTwo],
      stuckReviewRequests: [stuckOne, stuckTwo],
      backlogIssues: [backlogOne, backlogTwo],
      stalledInProgressIssues: [stalledOne, stalledTwo],
      unansweredMentions: [mentionOne, mentionTwo],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    const overviewButton = screen.getByRole("button", {
      name: /Follow-ups 개요/,
    });
    expect(overviewButton).toHaveAttribute("aria-current", "true");

    const staleCard = screen.getByTestId("follow-up-summary-stale-open-prs");
    expect(within(staleCard).getByText("2건")).toBeInTheDocument();
    expect(within(staleCard).getByText("60일")).toBeInTheDocument();
    expect(
      within(staleCard).getByText("최다 생성자: 1위 Alice, 2위 Bob"),
    ).toBeInTheDocument();
    expect(
      within(staleCard).getByText("최다 리뷰어: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();

    const idleCard = screen.getByTestId("follow-up-summary-idle-open-prs");
    expect(within(idleCard).getByText("2건")).toBeInTheDocument();
    expect(within(idleCard).getByText("21일")).toBeInTheDocument();
    expect(
      within(idleCard).getByText("최다 생성자: 1위 Carol, 2위 Dave"),
    ).toBeInTheDocument();
    expect(
      within(idleCard).getByText("최다 리뷰어: 1위 Erin, 2위 Frank"),
    ).toBeInTheDocument();

    const backlogCard = screen.getByTestId("follow-up-summary-backlog-issues");
    expect(within(backlogCard).getByText("2건")).toBeInTheDocument();
    expect(within(backlogCard).getByText("105일")).toBeInTheDocument();
    expect(
      within(backlogCard).getByText("최다 생성자: 1위 Alice, 2위 Carol"),
    ).toBeInTheDocument();
    expect(
      within(backlogCard).getByText("최다 담당자: 1위 Bob, 2위 Dave"),
    ).toBeInTheDocument();

    const quickButtons = screen.getAllByRole("button", { name: "바로 보기" });
    const stuckCard = screen.getByTestId(
      "follow-up-summary-stuck-review-requests",
    );
    const quickView = within(stuckCard).getByRole("button", {
      name: "바로 보기",
    });
    expect(quickButtons).toHaveLength(6);

    await user.click(quickView);

    expect(
      screen.getByText(
        "5일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      ),
    ).toBeInTheDocument();

    const stuckNavButton = screen.getByRole("button", {
      name: /응답 없는 리뷰 요청/,
    });
    expect(stuckNavButton).toHaveAttribute("aria-current", "true");
    expect(overviewButton).not.toHaveAttribute("aria-current", "true");

    await user.click(overviewButton);
    expect(overviewButton).toHaveAttribute("aria-current", "true");
  });
});

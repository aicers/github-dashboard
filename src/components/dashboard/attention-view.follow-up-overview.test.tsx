import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AttentionView,
  FollowUpDetailContent,
} from "@/components/dashboard/attention-view";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
  RepositoryReference,
  ReviewRequestAttentionItem,
  UserReference,
} from "@/lib/dashboard/attention";
import {
  buildActivityItem,
  buildActivityItemDetail,
} from "../../../tests/helpers/activity-items";

const refreshMock = vi.fn();
const mockFetchActivityDetail =
  vi.fn<
    (...args: unknown[]) => Promise<ReturnType<typeof buildActivityItemDetail>>
  >();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("@/lib/activity/client", () => ({
  fetchActivityDetail: (...args: unknown[]) => mockFetchActivityDetail(...args),
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
  linkedIssues?: PullRequestAttentionItem["linkedIssues"];
  createdAt: string;
  updatedAt: string | null;
  ageDays: number;
  inactivityDays?: number;
  waitingDays?: number;
}): PullRequestAttentionItem {
  const {
    id,
    number,
    title,
    url,
    repository,
    author,
    reviewers,
    linkedIssues = [],
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
    linkedIssues,
    createdAt,
    updatedAt,
    ageDays,
    inactivityDays,
    waitingDays,
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
  repositoryMaintainers?: UserReference[];
  assignees: UserReference[];
  linkedPullRequests?: IssueAttentionItem["linkedPullRequests"];
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
    repositoryMaintainers = author ? [author] : [],
    assignees,
    linkedPullRequests = [],
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
    repositoryMaintainers: repositoryMaintainers ?? [],
    author,
    assignees,
    linkedPullRequests,
    labels: [],
    issueType: null,
    milestone: null,
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
    classification: {
      requiresResponse: true,
      manualRequiresResponse: null,
      manualRequiresResponseAt: null,
      manualDecisionIsStale: false,
      lastEvaluatedAt: null,
    },
  } satisfies MentionAttentionItem;
}

const toActivityUserOverride = (user: UserReference | null) =>
  user
    ? {
        id: user.id,
        login: user.login ?? user.id,
        name: user.name ?? user.login ?? user.id,
        avatarUrl: null,
      }
    : null;

const toRepositoryOverride = (repo: RepositoryReference | null) =>
  repo
    ? {
        id: repo.id,
        name: repo.name ?? repo.nameWithOwner ?? repo.id,
        nameWithOwner: repo.nameWithOwner ?? repo.name ?? repo.id,
      }
    : undefined;

const BASE_ATTENTION_FLAGS = { ...buildActivityItem().attention };

function buildIssueDetailFromAttention(
  issue: IssueAttentionItem,
  attention: "backlog" | "stalled",
) {
  const assigneeUsers = issue.assignees
    .map((assignee) => toActivityUserOverride(assignee))
    .filter(
      (user): user is NonNullable<ReturnType<typeof toActivityUserOverride>> =>
        Boolean(user),
    );
  return buildActivityItemDetail({
    item: buildActivityItem({
      id: issue.id,
      type: "issue",
      number: issue.number,
      title: issue.title,
      url: issue.url ?? undefined,
      repository: toRepositoryOverride(issue.repository),
      author: toActivityUserOverride(issue.author),
      assignees: assigneeUsers,
      linkedPullRequests: issue.linkedPullRequests ?? [],
      issueProjectStatus: issue.issueProjectStatus ?? "no_status",
      issueProjectStatusSource: issue.issueProjectStatusSource ?? "none",
      issueProjectStatusLocked: issue.issueProjectStatusLocked ?? false,
      issueTodoProjectStatus: issue.issueTodoProjectStatus ?? null,
      issueTodoProjectPriority: issue.issueTodoProjectPriority ?? null,
      issueTodoProjectWeight: issue.issueTodoProjectWeight ?? null,
      issueTodoProjectInitiationOptions:
        issue.issueTodoProjectInitiationOptions ?? null,
      issueTodoProjectStartDate: issue.issueTodoProjectStartDate ?? null,
      businessDaysOpen: issue.ageDays ?? null,
      businessDaysSinceInProgress: issue.inProgressAgeDays ?? null,
      businessDaysInProgressOpen: issue.inProgressAgeDays ?? null,
      attention:
        attention === "stalled"
          ? { ...BASE_ATTENTION_FLAGS, stalledIssue: true }
          : { ...BASE_ATTENTION_FLAGS, backlogIssue: true },
    }),
  });
}

function buildPullRequestDetailFromAttention(
  pr: PullRequestAttentionItem,
  attention:
    | "reviewer-unassigned"
    | "review-stalled"
    | "merge-delayed"
    | "review",
) {
  const reviewerUsers = pr.reviewers
    .map((reviewer) => toActivityUserOverride(reviewer))
    .filter(
      (user): user is NonNullable<ReturnType<typeof toActivityUserOverride>> =>
        Boolean(user),
    );
  return buildActivityItemDetail({
    item: buildActivityItem({
      id: pr.id,
      type: "pull_request",
      number: pr.number,
      title: pr.title,
      url: pr.url ?? undefined,
      repository: toRepositoryOverride(pr.repository),
      author: toActivityUserOverride(pr.author),
      reviewers: reviewerUsers,
      linkedIssues: pr.linkedIssues ?? [],
      businessDaysOpen: pr.ageDays ?? null,
      businessDaysIdle: pr.inactivityDays ?? null,
      attention:
        attention === "reviewer-unassigned"
          ? { ...BASE_ATTENTION_FLAGS, reviewerUnassignedPr: true }
          : attention === "review-stalled"
            ? { ...BASE_ATTENTION_FLAGS, reviewStalledPr: true }
            : attention === "merge-delayed"
              ? { ...BASE_ATTENTION_FLAGS, mergeDelayedPr: true }
              : { ...BASE_ATTENTION_FLAGS, reviewRequestPending: true },
    }),
  });
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
      waitingDays: 40,
    });
    staleOne.linkedIssues = [
      {
        id: "issue-link-1",
        number: 901,
        title: "Linked backlog issue",
        state: "OPEN",
        repositoryNameWithOwner: repoMain.nameWithOwner,
        url: "https://github.com/acme/main/issues/901",
      },
    ];
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
      waitingDays: 20,
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
      waitingDays: 11,
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
      waitingDays: 10,
    });

    const unassignedOne = buildPullRequestItem({
      id: "pr-unassigned-1",
      number: 301,
      title: "Document deployment checklist",
      url: "https://github.com/acme/ops/pull/301",
      repository: repoOps,
      author: grace,
      reviewers: [],
      createdAt: "2024-02-09T00:00:00.000Z",
      updatedAt: "2024-02-09T00:00:00.000Z",
      ageDays: 3,
      waitingDays: 3,
    });

    const unassignedTwo = buildPullRequestItem({
      id: "pr-unassigned-2",
      number: 302,
      title: "Refine incident template",
      url: "https://github.com/acme/ops/pull/302",
      repository: repoOps,
      author: hank,
      reviewers: [],
      createdAt: "2024-02-10T00:00:00.000Z",
      updatedAt: "2024-02-10T00:00:00.000Z",
      ageDays: 2,
      waitingDays: 2,
    });

    const stuckOne = buildReviewRequestItem({
      id: "rr-erin",
      requestedAt: "2024-02-06T00:00:00.000Z",
      waitingDays: 7,
      reviewer: erin,
      pullRequest: staleOne,
    });
    const stuckDuplicate = buildReviewRequestItem({
      id: "rr-erin-extra",
      requestedAt: "2024-02-07T00:00:00.000Z",
      waitingDays: 6,
      reviewer: frank,
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
    backlogOne.linkedPullRequests = [
      {
        id: "pr-link-1",
        number: 777,
        title: "Follow-up refactor",
        state: "OPEN",
        status: "open",
        repositoryNameWithOwner: repoMain.nameWithOwner,
        url: "https://github.com/acme/main/pull/777",
        mergedAt: null,
        closedAt: null,
        updatedAt: null,
      },
    ];
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
    const mentionDuplicate = buildMentionItem({
      commentId: "comment-1b",
      url: "https://github.com/acme/main/pull/101#comment-1b",
      mentionedAt: "2024-02-09T00:00:00.000Z",
      waitingDays: 4,
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
      commentExcerpt: "Circling back on the same PR.",
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

    const detailMap = new Map<
      string,
      ReturnType<typeof buildActivityItemDetail>
    >();

    const registerIssueDetail = (
      issue: IssueAttentionItem,
      attention: "backlog" | "stalled",
    ) => {
      detailMap.set(issue.id, buildIssueDetailFromAttention(issue, attention));
    };

    const registerPullRequestDetail = (
      pr: PullRequestAttentionItem,
      attention:
        | "reviewer-unassigned"
        | "review-stalled"
        | "merge-delayed"
        | "review",
    ) => {
      detailMap.set(pr.id, buildPullRequestDetailFromAttention(pr, attention));
    };

    registerPullRequestDetail(staleOne, "merge-delayed");
    registerPullRequestDetail(staleTwo, "merge-delayed");
    registerPullRequestDetail(idleOne, "review-stalled");
    registerPullRequestDetail(idleTwo, "review-stalled");
    registerPullRequestDetail(staleOne, "review");
    registerPullRequestDetail(idleTwo, "review");

    registerIssueDetail(backlogOne, "backlog");
    registerIssueDetail(backlogTwo, "backlog");
    registerIssueDetail(stalledOne, "stalled");
    registerIssueDetail(stalledTwo, "stalled");

    const mentionContainerIds = new Set<string>([
      mentionOne.container.id ?? "",
      mentionTwo.container.id ?? "",
    ]);
    mentionContainerIds.forEach((containerId) => {
      if (!containerId) {
        return;
      }
      if (detailMap.has(containerId)) {
        return;
      }
      const issueMatch = [backlogOne, backlogTwo, stalledOne, stalledTwo].find(
        (issue) => issue.id === containerId,
      );
      if (issueMatch) {
        registerIssueDetail(issueMatch, "backlog");
        return;
      }
      const mergeDelayedMatch = [staleOne, staleTwo].find(
        (pr) => pr.id === containerId,
      );
      if (mergeDelayedMatch) {
        registerPullRequestDetail(mergeDelayedMatch, "merge-delayed");
        return;
      }

      const reviewStalledMatch = [idleOne, idleTwo].find(
        (pr) => pr.id === containerId,
      );
      if (reviewStalledMatch) {
        registerPullRequestDetail(reviewStalledMatch, "review-stalled");
        return;
      }

      const unassignedMatch = [unassignedOne, unassignedTwo].find(
        (pr) => pr.id === containerId,
      );
      if (unassignedMatch) {
        registerPullRequestDetail(unassignedMatch, "reviewer-unassigned");
      }
    });

    mockFetchActivityDetail.mockImplementation((id: unknown) => {
      const key = String(id);
      const detail = detailMap.get(key);
      if (!detail) {
        return Promise.reject(new Error(`Unexpected fetch id ${key}`));
      }
      return Promise.resolve(detail);
    });

    const insights: AttentionInsights = {
      generatedAt: "2024-02-20T00:00:00.000Z",
      timezone: "Asia/Seoul",
      dateTimeFormat: "auto",
      reviewerUnassignedPrs: [unassignedOne, unassignedTwo],
      reviewStalledPrs: [idleOne, idleTwo],
      mergeDelayedPrs: [staleOne, staleTwo],
      stuckReviewRequests: [stuckOne, stuckDuplicate, stuckTwo],
      backlogIssues: [backlogOne, backlogTwo],
      stalledInProgressIssues: [stalledOne, stalledTwo],
      unansweredMentions: [mentionOne, mentionDuplicate, mentionTwo],
    } satisfies AttentionInsights;

    render(<AttentionView insights={insights} />);

    const overviewButton = screen.getByRole("button", {
      name: /Overview/,
    });
    expect(overviewButton).toHaveAttribute("aria-current", "true");

    const reviewerUnassignedCard = screen.getByTestId(
      "follow-up-summary-reviewer-unassigned-prs",
    );
    expect(within(reviewerUnassignedCard).getByText("2건")).toBeInTheDocument();
    expect(within(reviewerUnassignedCard).getByText("5일")).toBeInTheDocument();
    expect(
      within(reviewerUnassignedCard).getByText(
        "최다 작성자: 1위 Grace, 2위 Hank",
      ),
    ).toBeInTheDocument();

    const reviewStalledCard = screen.getByTestId(
      "follow-up-summary-review-stalled-prs",
    );
    expect(within(reviewStalledCard).getByText("2건")).toBeInTheDocument();
    expect(within(reviewStalledCard).getByText("21일")).toBeInTheDocument();
    expect(
      within(reviewStalledCard).getByText("최다 작성자: 1위 Carol, 2위 Dave"),
    ).toBeInTheDocument();
    expect(
      within(reviewStalledCard).getByText("최다 리뷰어: 1위 Erin, 2위 Frank"),
    ).toBeInTheDocument();

    const mergeDelayedCard = screen.getByTestId(
      "follow-up-summary-merge-delayed-prs",
    );
    expect(within(mergeDelayedCard).getByText("2건")).toBeInTheDocument();
    expect(within(mergeDelayedCard).getByText("60일")).toBeInTheDocument();
    expect(
      within(mergeDelayedCard).getByText("최다 작성자: 1위 Alice, 2위 Bob"),
    ).toBeInTheDocument();
    expect(
      within(mergeDelayedCard).getByText("최다 리뷰어: 1위 Bob, 2위 Carol"),
    ).toBeInTheDocument();

    const backlogCard = screen.getByTestId("follow-up-summary-backlog-issues");
    expect(within(backlogCard).getByText("2건")).toBeInTheDocument();
    expect(within(backlogCard).getByText("105일")).toBeInTheDocument();
    expect(
      within(backlogCard).getByText("최다 작성자: 1위 Alice, 2위 Carol"),
    ).toBeInTheDocument();
    expect(
      within(backlogCard).getByText("최다 담당자: 1위 Bob, 2위 Dave"),
    ).toBeInTheDocument();

    const stalledCard = screen.getByTestId(
      "follow-up-summary-stalled-in-progress-issues",
    );
    expect(within(stalledCard).getByText("2건")).toBeInTheDocument();
    expect(
      within(stalledCard).getByText("최다 저장소 책임자: 1위 Erin, 2위 Grace"),
    ).toBeInTheDocument();
    expect(
      within(stalledCard).getByText("최다 담당자: 1위 Frank, 2위 Hank"),
    ).toBeInTheDocument();

    const mentionCard = screen.getByTestId(
      "follow-up-summary-unanswered-mentions",
    );
    expect(within(mentionCard).getByText("2건")).toBeInTheDocument();
    expect(within(mentionCard).getByText("11일")).toBeInTheDocument();

    const quickButtons = screen.getAllByRole("button", { name: "바로 보기" });
    const stuckCard = screen.getByTestId(
      "follow-up-summary-stuck-review-requests",
    );
    const quickView = within(stuckCard).getByRole("button", {
      name: "바로 보기",
    });
    expect(quickButtons).toHaveLength(7);

    await user.click(quickView);

    expect(
      screen.getByText(
        "2일 이상 (리뷰 제출·댓글·리액션 모두 없는) 응답 없는 리뷰 요청",
      ),
    ).toBeInTheDocument();

    const stuckNavButton = screen.getAllByRole("button", {
      name: /응답 없는 리뷰 요청/,
    })[0];
    expect(stuckNavButton).toHaveAttribute("aria-current", "true");
    expect(overviewButton).not.toHaveAttribute("aria-current", "true");

    await user.click(overviewButton);
    expect(overviewButton).toHaveAttribute("aria-current", "true");
  });
});

describe("FollowUpDetailContent", () => {
  it("renders linked references", () => {
    const item = buildActivityItem({
      id: "issue-linked",
      type: "issue",
      linkedPullRequests: [
        {
          id: "pr-linked",
          number: 123,
          title: "Linked PR",
          state: "OPEN",
          status: "open",
          repositoryNameWithOwner: "acme/repo-two",
          url: "https://example.com/acme/repo-two/pull/123",
          mergedAt: null,
          closedAt: null,
          updatedAt: null,
        },
      ],
    });
    const detail = buildActivityItemDetail({ item });

    render(
      <FollowUpDetailContent
        item={item}
        detail={detail}
        isLoading={false}
        timezone="UTC"
        dateTimeFormat="auto"
        isUpdatingStatus={false}
        isUpdatingProjectFields={false}
        onUpdateStatus={() => {}}
        onUpdateProjectField={async () => false}
      />,
    );

    expect(screen.getByText("연결된 PR")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "acme/repo-two#123" }),
    ).toBeInTheDocument();
  });
});

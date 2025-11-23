// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureActivityCaches } from "@/lib/activity/cache";
import {
  getActivityFilterOptions,
  getActivityItemDetail,
  getActivityItems,
} from "@/lib/activity/service";
import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import type {
  AttentionInsights,
  IssueAttentionItem,
  MentionAttentionItem,
  PullRequestAttentionItem,
} from "@/lib/dashboard/attention";
import { query } from "@/lib/db/client";
import type {
  DbActor,
  DbComment,
  DbIssue,
  DbPullRequest,
  DbReaction,
  DbRepository,
  DbReview,
  DbReviewRequest,
} from "@/lib/db/operations";
import { updateSyncConfig } from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  insertIssueProjectOverrides,
  insertIssueStatusHistory,
  resetActivityTables,
  seedActivityComments,
  seedActivityIssues,
  seedActivityPullRequests,
  seedActivityReactions,
  seedActivityRepositories,
  seedActivityReviewRequests,
  seedActivityReviews,
  seedActivityUsers,
} from "../../../tests/helpers/activity-data";

vi.mock("@/lib/dashboard/attention", () => ({
  getAttentionInsights: vi.fn(),
}));

import { getAttentionInsights } from "@/lib/dashboard/attention";

const mockedAttentionInsights = vi.mocked(getAttentionInsights);

const BASE_TIME = "2024-01-01T00:00:00.000Z";

const emptyInsights = (): AttentionInsights => ({
  generatedAt: BASE_TIME,
  timezone: "UTC",
  dateTimeFormat: "auto",
  staleOpenPrs: [],
  idleOpenPrs: [],
  stuckReviewRequests: [],
  backlogIssues: [],
  stalledInProgressIssues: [],
  unansweredMentions: [],
});

const originalProjectName = env.TODO_PROJECT_NAME;

beforeEach(async () => {
  mockedAttentionInsights.mockResolvedValue(emptyInsights());
  env.TODO_PROJECT_NAME = "Acme Project";
  await resetActivityTables();
  await updateSyncConfig({ excludedRepositories: [] });
});

afterEach(async () => {
  env.TODO_PROJECT_NAME = originalProjectName;
  vi.useRealTimers();
  vi.clearAllMocks();
  await updateSyncConfig({ excludedRepositories: [] });
});

type SeededData = {
  repoAlpha: DbRepository;
  repoBeta: DbRepository;
  userPriority: DbActor;
  userAlice: DbActor;
  userBob: DbActor;
  issueAlpha: DbIssue;
  pullRequestBeta: DbPullRequest;
};

async function seedBasicActivityData(): Promise<SeededData> {
  const userPriority: DbActor = {
    id: "user-octoaide",
    login: "octoaide",
    name: "Octo Aide",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };
  const userAlice: DbActor = {
    id: "user-alice",
    login: "alice",
    name: "Alice Reviewer",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };
  const userBob: DbActor = {
    id: "user-bob",
    login: "bob",
    name: "Bob Commenter",
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
  };

  await seedActivityUsers([userPriority, userAlice, userBob]);

  const repoAlpha: DbRepository = {
    id: "repo-alpha",
    name: "alpha",
    nameWithOwner: "octo/alpha",
    ownerId: userPriority.id,
    raw: { id: "repo-alpha" },
  };
  const repoBeta: DbRepository = {
    id: "repo-beta",
    name: "beta",
    nameWithOwner: "octo/beta",
    ownerId: userPriority.id,
    raw: { id: "repo-beta" },
  };

  await seedActivityRepositories([repoAlpha, repoBeta]);

  const issueAlpha: DbIssue = {
    id: "issue-alpha",
    number: 101,
    repositoryId: repoAlpha.id,
    authorId: userPriority.id,
    title: "Alpha issue",
    state: "OPEN",
    createdAt: BASE_TIME,
    updatedAt: "2024-01-05T12:00:00.000Z",
    closedAt: null,
    raw: {
      url: "https://example.com/alpha/101",
      assignees: { nodes: [{ id: userAlice.id }] },
      labels: {
        nodes: [{ name: "Bug" }, { name: "Needs Review" }],
      },
      issueType: { id: "label:issue_type:bug", name: "Bug" },
      milestone: {
        id: "milestone-1",
        title: "Sprint 1",
        state: "OPEN",
        dueOn: "2024-02-01T00:00:00.000Z",
        url: "https://example.com/milestones/1",
      },
      trackedIssues: {
        totalCount: 1,
        nodes: [
          {
            id: "issue-child",
            number: 205,
            title: "Child issue",
            state: "OPEN",
            url: "https://example.com/alpha/205",
            repository: { nameWithOwner: repoAlpha.nameWithOwner },
          },
        ],
      },
      trackedInIssues: {
        totalCount: 1,
        nodes: [
          {
            id: "issue-parent",
            number: 42,
            title: "Parent issue",
            state: "OPEN",
            url: "https://example.com/alpha/42",
            repository: { nameWithOwner: repoAlpha.nameWithOwner },
          },
        ],
      },
      projectStatusHistory: [
        {
          status: "Todo",
          occurredAt: "2024-01-06T00:00:00.000Z",
          project: { title: "Acme Project" },
          projectTitle: "Acme Project",
        },
        {
          status: "In Progress",
          occurredAt: "2024-01-08T00:00:00.000Z",
          project: { title: "Acme Project" },
          projectTitle: "Acme Project",
        },
        {
          status: "Todo",
          occurredAt: "2024-01-12T00:00:00.000Z",
          project: { title: "Acme Project" },
          projectTitle: "Acme Project",
        },
      ],
      body: "Issue body content",
    },
  };

  const pullRequestBeta: DbPullRequest = {
    id: "pr-beta",
    number: 202,
    repositoryId: repoBeta.id,
    authorId: userAlice.id,
    title: "Beta feature",
    state: "OPEN",
    merged: false,
    createdAt: "2024-01-03T00:00:00.000Z",
    updatedAt: "2024-01-08T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    raw: {
      url: "https://example.com/beta/202",
      assignees: { nodes: [{ id: userBob.id }] },
      labels: { nodes: [{ name: "Feature" }] },
      body: "Implement feature",
    },
  };

  await seedActivityIssues([issueAlpha]);
  await seedActivityPullRequests([pullRequestBeta]);

  const review: DbReview = {
    id: "review-1",
    pullRequestId: pullRequestBeta.id,
    authorId: userBob.id,
    state: "APPROVED",
    submittedAt: "2024-01-07T00:00:00.000Z",
    raw: { id: "review-1" },
  };
  await seedActivityReviews([review]);

  const reviewRequest: DbReviewRequest = {
    id: "review-request-1",
    pullRequestId: pullRequestBeta.id,
    reviewerId: userAlice.id,
    requestedAt: "2024-01-05T00:00:00.000Z",
    raw: { id: "review-request-1" },
  };
  await seedActivityReviewRequests([reviewRequest]);

  const comment: DbComment = {
    id: "comment-1",
    issueId: issueAlpha.id,
    pullRequestId: null,
    reviewId: null,
    authorId: userBob.id,
    createdAt: "2024-01-06T12:00:00.000Z",
    updatedAt: "2024-01-06T12:00:00.000Z",
    raw: { body: "Looks good to me" },
  };
  await seedActivityComments([comment]);

  const reaction: DbReaction = {
    id: "reaction-1",
    subjectType: "Issue",
    subjectId: issueAlpha.id,
    userId: userAlice.id,
    content: "THUMBS_UP",
    createdAt: "2024-01-07T00:00:00.000Z",
    raw: { content: "THUMBS_UP" },
  };
  await seedActivityReactions([reaction]);

  await refreshActivityItemsSnapshot();

  return {
    repoAlpha,
    repoBeta,
    userPriority,
    userAlice,
    userBob,
    issueAlpha,
    pullRequestBeta,
  };
}

describe("activity service integration", () => {
  it("returns filter options with normalized ordering and deduplicated values", async () => {
    const { repoAlpha, repoBeta } = await seedBasicActivityData();

    const options = await getActivityFilterOptions();

    expect(options.repositories.map((repo) => repo.id)).toEqual([
      repoAlpha.id,
      repoBeta.id,
    ]);
    expect(options.labels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `${repoAlpha.nameWithOwner}:Bug`,
          repositoryId: repoAlpha.id,
          name: "Bug",
        }),
        expect.objectContaining({
          key: `${repoBeta.nameWithOwner}:Feature`,
          repositoryId: repoBeta.id,
          name: "Feature",
        }),
      ]),
    );
    expect(options.issueTypes).toEqual(
      expect.arrayContaining([{ id: "label:issue_type:bug", name: "Bug" }]),
    );
    expect(options.milestones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "milestone-1",
          title: "Sprint 1",
          state: "OPEN",
        }),
      ]),
    );
    expect(options.issuePriorities).toEqual(["P0", "P1", "P2"]);
    expect(options.issueWeights).toEqual(["Heavy", "Medium", "Light"]);
    expect(options.users.map((user) => user.id)).toEqual([
      "user-octoaide",
      "user-alice",
      "user-bob",
    ]);
  });

  it("omits repositories that were excluded in sync settings", async () => {
    const { repoAlpha, repoBeta } = await seedBasicActivityData();

    await updateSyncConfig({ excludedRepositories: [repoAlpha.id] });
    await ensureActivityCaches({ force: true });

    const options = await getActivityFilterOptions();

    expect(options.repositories.map((repo) => repo.id)).toEqual([repoBeta.id]);
    expect(
      options.labels.every((label) => label.repositoryId !== repoAlpha.id),
    ).toBe(true);

    const result = await getActivityItems();

    expect(
      result.items.every(
        (item) =>
          item.repository === null || item.repository.id !== repoAlpha.id,
      ),
    ).toBe(true);
  });

  it("returns pagination metadata with totals", async () => {
    await seedBasicActivityData();

    const result = await getActivityItems({ perPage: 1 });

    expect(result.pageInfo).toEqual({
      page: 1,
      perPage: 1,
      totalCount: 2,
      totalPages: 2,
    });
  });

  it("filters issues by to-do project status when other project history entries exist", async () => {
    const { issueAlpha } = await seedBasicActivityData();

    const updatedHistory = [
      {
        status: "Todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
      {
        status: "In Progress",
        occurredAt: "2024-01-08T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
      {
        status: "Review",
        occurredAt: "2024-01-15T00:00:00.000Z",
        project: { title: "Other Project" },
        projectTitle: "Other Project",
      },
    ];

    await query(
      `UPDATE issues
       SET data = jsonb_set(data, '{projectStatusHistory}', $1::jsonb)
     WHERE id = $2`,
      [JSON.stringify(updatedHistory), issueAlpha.id],
    );

    await rebuildActivitySnapshot();

    const result = await getActivityItems({
      types: ["issue"],
      statuses: ["in_progress"],
    });

    expect(result.items.map((item) => item.id)).toEqual([issueAlpha.id]);
  });

  it("includes issues when activity status matches even if project status differs", async () => {
    const { issueAlpha } = await seedBasicActivityData();

    await insertIssueStatusHistory([
      {
        issueId: issueAlpha.id,
        status: "todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "in_progress",
        occurredAt: "2024-01-08T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "done",
        occurredAt: "2024-01-20T00:00:00.000Z",
      },
    ]);

    await rebuildActivitySnapshot();

    const result = await getActivityItems({
      types: ["issue"],
      statuses: ["done"],
    });

    expect(result.items.map((item) => item.id)).toEqual([issueAlpha.id]);
  });

  it("does not include issues in progress filter when the to-do project locks a different status", async () => {
    const { issueAlpha } = await seedBasicActivityData();

    const projectHistory = [
      {
        status: "Todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
      {
        status: "In Progress",
        occurredAt: "2024-01-08T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
      {
        status: "Done",
        occurredAt: "2024-01-15T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
    ];

    await query(
      `UPDATE issues
         SET data = jsonb_set(data, '{projectStatusHistory}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(projectHistory), issueAlpha.id],
    );

    await insertIssueStatusHistory([
      {
        issueId: issueAlpha.id,
        status: "todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "in_progress",
        occurredAt: "2024-01-20T00:00:00.000Z",
      },
    ]);

    await rebuildActivitySnapshot();

    const inProgressResult = await getActivityItems({
      types: ["issue"],
      statuses: ["in_progress"],
    });

    expect(inProgressResult.items.map((item) => item.id)).not.toContain(
      issueAlpha.id,
    );

    const doneResult = await getActivityItems({
      types: ["issue"],
      statuses: ["done"],
    });

    expect(doneResult.items.map((item) => item.id)).toEqual([issueAlpha.id]);
  });

  it("prefers the most recent activity status when the project status is older", async () => {
    const { issueAlpha } = await seedBasicActivityData();

    const projectHistory = [
      {
        status: "Todo",
        occurredAt: "2024-01-01T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
    ];

    await query(
      `UPDATE issues
         SET data = jsonb_set(data, '{projectStatusHistory}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(projectHistory), issueAlpha.id],
    );

    await insertIssueStatusHistory([
      {
        issueId: issueAlpha.id,
        status: "todo",
        occurredAt: "2024-01-01T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "done",
        occurredAt: "2024-01-10T00:00:00.000Z",
      },
    ]);

    await rebuildActivitySnapshot();

    const result = await getActivityItems({
      types: ["issue"],
      statuses: ["done"],
    });

    expect(result.items.map((item) => item.id)).toEqual([issueAlpha.id]);
    expect(result.items[0]?.issueProjectStatus).toBe("done");

    const detail = await getActivityItemDetail(issueAlpha.id);
    expect(detail?.item.issueProjectStatus).toBe("done");
  }, 30000);

  it("allows filtering issues by canceled status and records timeline entries", async () => {
    const { issueAlpha } = await seedBasicActivityData();

    const rawIssue = issueAlpha.raw as { projectStatusHistory?: unknown[] };
    const projectHistory = [
      ...(Array.isArray(rawIssue.projectStatusHistory)
        ? [...rawIssue.projectStatusHistory]
        : []),
      {
        status: "Canceled",
        occurredAt: "2024-01-22T00:00:00.000Z",
        project: { title: "Acme Project" },
        projectTitle: "Acme Project",
      },
    ];

    await query(
      `UPDATE issues
         SET data = jsonb_set(data, '{projectStatusHistory}', $1::jsonb)
       WHERE id = $2`,
      [JSON.stringify(projectHistory), issueAlpha.id],
    );

    await insertIssueStatusHistory([
      {
        issueId: issueAlpha.id,
        status: "todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "in_progress",
        occurredAt: "2024-01-08T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "canceled",
        occurredAt: "2024-01-25T00:00:00.000Z",
      },
    ]);

    await rebuildActivitySnapshot();

    const result = await getActivityItems({
      types: ["issue"],
      statuses: ["canceled"],
    });

    expect(result.items.map((item) => item.id)).toEqual([issueAlpha.id]);
    expect(result.items[0]?.issueProjectStatus).toBe("canceled");

    const detail = await getActivityItemDetail(issueAlpha.id);
    expect(detail?.item.issueProjectStatus).toBe("canceled");
    expect(detail?.todoStatusTimes?.canceled).toBe("2024-01-22T00:00:00.000Z");
    expect(detail?.activityStatusTimes?.canceled).toBe(
      "2024-01-25T00:00:00.000Z",
    );
  });

  it("returns paginated activity items filtered by repository with attention flags applied", async () => {
    const { repoAlpha, repoBeta, issueAlpha, pullRequestBeta, userAlice } =
      await seedBasicActivityData();

    const attention: AttentionInsights = {
      ...emptyInsights(),
      staleOpenPrs: [
        {
          id: pullRequestBeta.id,
          number: pullRequestBeta.number,
          title: pullRequestBeta.title ?? null,
          url: "https://example.com/beta/202",
          repository: {
            id: repoBeta.id,
            name: repoBeta.name,
            nameWithOwner: repoBeta.nameWithOwner,
          },
          author: null,
          reviewers: [],
          linkedIssues: [],
          createdAt: pullRequestBeta.createdAt,
          updatedAt: pullRequestBeta.updatedAt,
          ageDays: 25,
        } satisfies PullRequestAttentionItem,
      ],
      backlogIssues: [
        {
          id: issueAlpha.id,
          number: issueAlpha.number,
          title: issueAlpha.title ?? null,
          url: "https://example.com/alpha/101",
          repository: {
            id: repoAlpha.id,
            name: repoAlpha.name,
            nameWithOwner: repoAlpha.nameWithOwner,
          },
          repositoryMaintainers: [],
          author: null,
          assignees: [],
          linkedPullRequests: [],
          labels: [],
          issueType: null,
          milestone: null,
          createdAt: issueAlpha.createdAt,
          updatedAt: issueAlpha.updatedAt,
          ageDays: 45,
        } satisfies IssueAttentionItem,
      ],
      stuckReviewRequests: [
        {
          id: "rr-attention",
          requestedAt: "2024-01-05T00:00:00.000Z",
          waitingDays: 7,
          reviewer: {
            id: userAlice.id,
            login: userAlice.login ?? null,
            name: userAlice.name ?? null,
          },
          pullRequest: {
            id: pullRequestBeta.id,
            number: pullRequestBeta.number,
            title: pullRequestBeta.title ?? null,
            url: "https://example.com/beta/202",
            repository: {
              id: repoBeta.id,
              name: repoBeta.name,
              nameWithOwner: repoBeta.nameWithOwner,
            },
            author: null,
            reviewers: [],
            linkedIssues: [],
          },
        },
      ],
    };
    mockedAttentionInsights.mockResolvedValue(attention);

    const repoItems = await getActivityItems({
      repositoryIds: [repoBeta.id],
      perPage: 1,
    });

    expect(repoItems.items).toHaveLength(1);
    const [pullRequestItem] = repoItems.items;
    expect(pullRequestItem.id).toBe(pullRequestBeta.id);
    expect(pullRequestItem.type).toBe("pull_request");
    expect(pullRequestItem.attention.staleOpenPr).toBeTruthy();
    expect(pullRequestItem.attention.reviewRequestPending).toBeTruthy();
    expect(repoItems.pageInfo).toEqual({
      page: 1,
      perPage: 1,
      totalCount: 1,
      totalPages: 1,
    });

    const issueItems = await getActivityItems({
      repositoryIds: [repoAlpha.id],
      perPage: 5,
    });

    expect(issueItems.items).toHaveLength(1);
    const [issueItem] = issueItems.items;
    expect(issueItem.id).toBe(issueAlpha.id);
    expect(issueItem.type).toBe("issue");
    expect(issueItem.attention.backlogIssue).toBe(true);
    expect(issueItems.pageInfo).toEqual({
      page: 1,
      perPage: 5,
      totalCount: 1,
      totalPages: 1,
    });
  });

  it("excludes pull requests that no longer satisfy selected attention filters", async () => {
    const { repoBeta, pullRequestBeta } = await seedBasicActivityData();

    await query(
      `UPDATE pull_requests
         SET state = 'CLOSED',
             merged = FALSE,
             github_closed_at = '2024-02-01T00:00:00.000Z',
             github_updated_at = '2024-02-01T00:00:00.000Z'
       WHERE id = $1`,
      [pullRequestBeta.id],
    );
    await refreshActivityItemsSnapshot();

    const attention: AttentionInsights = {
      ...emptyInsights(),
      staleOpenPrs: [
        {
          id: pullRequestBeta.id,
          number: pullRequestBeta.number,
          title: pullRequestBeta.title ?? null,
          url: `https://example.com/beta/${pullRequestBeta.number}`,
          repository: {
            id: repoBeta.id,
            name: repoBeta.name,
            nameWithOwner: repoBeta.nameWithOwner,
          },
          author: null,
          reviewers: [],
          linkedIssues: [],
          createdAt: pullRequestBeta.createdAt,
          updatedAt: pullRequestBeta.updatedAt,
          ageDays: 30,
        } satisfies PullRequestAttentionItem,
      ],
    };
    mockedAttentionInsights.mockResolvedValueOnce(attention);

    const result = await getActivityItems({
      attention: ["pr_open_too_long"],
    });

    expect(result.items).toHaveLength(0);
    expect(result.pageInfo.totalCount).toBe(0);
  });

  it("filters combined attention results by selected people", async () => {
    const { repoAlpha, userAlice, userBob, issueAlpha } =
      await seedBasicActivityData();

    await query(
      `INSERT INTO repository_maintainers (repository_id, user_id)
       VALUES ($1, $2)`,
      [repoAlpha.id, userAlice.id],
    );

    await refreshActivityItemsSnapshot();

    const backlogAttention: IssueAttentionItem = {
      id: issueAlpha.id,
      number: issueAlpha.number,
      title: issueAlpha.title ?? null,
      url: `https://example.com/${repoAlpha.nameWithOwner}/issues/${issueAlpha.number}`,
      repository: {
        id: repoAlpha.id,
        name: repoAlpha.name,
        nameWithOwner: repoAlpha.nameWithOwner,
      },
      repositoryMaintainers: [],
      author: {
        id: userAlice.id,
        login: userAlice.login ?? null,
        name: userAlice.name ?? null,
      },
      assignees: [],
      linkedPullRequests: [],
      labels: [],
      issueType: null,
      milestone: null,
      createdAt: issueAlpha.createdAt,
      updatedAt: issueAlpha.updatedAt,
      ageDays: 60,
    };

    const mentionAttention: MentionAttentionItem = {
      commentId: "comment-alpha",
      url: `https://example.com/${repoAlpha.nameWithOwner}/issues/${issueAlpha.number}#comment-alpha`,
      mentionedAt: "2024-02-01T00:00:00.000Z",
      waitingDays: 7,
      author: {
        id: userBob.id,
        login: userBob.login ?? null,
        name: userBob.name ?? null,
      },
      target: {
        id: userAlice.id,
        login: userAlice.login ?? null,
        name: userAlice.name ?? null,
      },
      container: {
        type: "issue",
        id: issueAlpha.id,
        number: issueAlpha.number,
        title: issueAlpha.title ?? null,
        url: `https://example.com/${repoAlpha.nameWithOwner}/issues/${issueAlpha.number}`,
        repository: {
          id: repoAlpha.id,
          name: repoAlpha.name,
          nameWithOwner: repoAlpha.nameWithOwner,
        },
      },
      commentExcerpt: "ping @alice",
      classification: {
        requiresResponse: true,
        manualRequiresResponse: null,
        manualRequiresResponseAt: null,
        manualDecisionIsStale: false,
        lastEvaluatedAt: null,
      },
    };

    mockedAttentionInsights.mockResolvedValue({
      ...emptyInsights(),
      backlogIssues: [backlogAttention],
      unansweredMentions: [mentionAttention],
    });

    const activeAttentions = ["issue_backlog", "unanswered_mentions"] as const;

    const withAlice = await getActivityItems({
      attention: [...activeAttentions],
      peopleSelection: [userAlice.id],
    });

    const withBob = await getActivityItems({
      attention: [...activeAttentions],
      peopleSelection: [userBob.id],
    });

    expect(withAlice.items.map((item) => item.id)).toEqual([issueAlpha.id]);
    expect(withBob.items.map((item) => item.id)).toEqual([]);
  });

  it("returns empty results without errors when attention matches are empty but peopleSelection is set", async () => {
    mockedAttentionInsights.mockResolvedValueOnce(emptyInsights());

    await refreshActivityItemsSnapshot();

    const result = await getActivityItems({
      attention: ["unanswered_mentions", "review_requests_pending"],
      peopleSelection: ["user-missing"],
    });

    expect(result.items).toHaveLength(0);
    expect(result.pageInfo.totalCount).toBe(0);
  });

  it("limits unanswered mention attention results to unresolved targets", async () => {
    const mentionAuthor: DbActor = {
      id: "user-mention-author",
      login: "henry0715-dev",
      name: "Henry",
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    };
    const unresolvedTarget: DbActor = {
      id: "user-unresolved",
      login: "sehkone",
      name: "Sehkone Kim",
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    };
    const respondedTarget: DbActor = {
      id: "user-responded",
      login: "msk",
      name: "Min S. Kim",
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    };

    await seedActivityUsers([mentionAuthor, unresolvedTarget, respondedTarget]);

    const repository: DbRepository = {
      id: "repo-mentions",
      name: "review-web",
      nameWithOwner: "aicers/review-web",
      ownerId: mentionAuthor.id,
      raw: { id: "repo-mentions" },
    };

    await seedActivityRepositories([repository]);

    const issue: DbIssue = {
      id: "issue-unanswered-mentions",
      number: 33,
      repositoryId: repository.id,
      authorId: mentionAuthor.id,
      title: "Add backupList API",
      state: "OPEN",
      createdAt: BASE_TIME,
      updatedAt: "2024-02-01T00:00:00.000Z",
      closedAt: null,
      raw: {
        id: "issue-unanswered-mentions",
        number: 33,
        title: "Add backupList API",
        url: `https://example.com/${repository.nameWithOwner}/issues/33`,
        repository: {
          id: repository.id,
          nameWithOwner: repository.nameWithOwner,
        },
      },
    };

    await seedActivityIssues([issue]);

    const comment: DbComment = {
      id: "comment-unanswered-mentions",
      issueId: issue.id,
      pullRequestId: null,
      reviewId: null,
      authorId: mentionAuthor.id,
      createdAt: "2024-01-15T09:00:00.000Z",
      updatedAt: "2024-01-15T09:00:00.000Z",
      raw: {
        id: "comment-unanswered-mentions",
        body: "@sehkone, @msk Could we close this issue?",
        url: `https://example.com/${repository.nameWithOwner}/issues/33#comment-1`,
      },
    };

    await seedActivityComments([comment]);
    await refreshActivityItemsSnapshot();

    const unansweredMention: MentionAttentionItem = {
      commentId: comment.id,
      url: (comment.raw as { url?: string | null })?.url ?? null,
      mentionedAt: "2024-01-15T09:00:00.000Z",
      waitingDays: 7,
      author: {
        id: mentionAuthor.id,
        login: mentionAuthor.login ?? null,
        name: mentionAuthor.name ?? null,
      },
      target: {
        id: unresolvedTarget.id,
        login: unresolvedTarget.login ?? null,
        name: unresolvedTarget.name ?? null,
      },
      container: {
        type: "issue",
        id: issue.id,
        number: issue.number,
        title: issue.title ?? null,
        url: (issue.raw as { url?: string | null })?.url ?? null,
        repository: {
          id: repository.id,
          name: repository.name,
          nameWithOwner: repository.nameWithOwner,
        },
      },
      commentExcerpt: "@sehkone, @msk Could we close this issue?",
      classification: {
        requiresResponse: true,
        manualRequiresResponse: null,
        manualRequiresResponseAt: null,
        manualDecisionIsStale: false,
        lastEvaluatedAt: null,
      },
    };

    const attention: AttentionInsights = {
      ...emptyInsights(),
      unansweredMentions: [unansweredMention],
    };

    mockedAttentionInsights.mockResolvedValueOnce(attention);

    const withUnresolvedTarget = await getActivityItems({
      attention: ["unanswered_mentions"],
      peopleSelection: [unresolvedTarget.id],
    });

    expect(withUnresolvedTarget.items.map((item) => item.id)).toEqual([
      issue.id,
    ]);

    mockedAttentionInsights.mockResolvedValueOnce(attention);

    const withRespondedTarget = await getActivityItems({
      attention: ["unanswered_mentions"],
      peopleSelection: [respondedTarget.id],
    });

    expect(withRespondedTarget.items).toHaveLength(0);

    mockedAttentionInsights.mockResolvedValueOnce(attention);

    const withMentionAuthor = await getActivityItems({
      attention: ["unanswered_mentions"],
      peopleSelection: [mentionAuthor.id],
    });

    expect(withMentionAuthor.items).toHaveLength(0);
  });

  it("populates linked pull requests and issues for activity items", async () => {
    const { repoAlpha, issueAlpha, pullRequestBeta } =
      await seedBasicActivityData();

    await query(
      `INSERT INTO pull_request_issues (
         pull_request_id,
         issue_id,
         issue_number,
         issue_title,
         issue_state,
         issue_url,
         issue_repository,
         inserted_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        pullRequestBeta.id,
        issueAlpha.id,
        issueAlpha.number,
        issueAlpha.title ?? null,
        issueAlpha.state ?? "OPEN",
        `https://github.com/${repoAlpha.nameWithOwner}/issues/${issueAlpha.number}`,
        repoAlpha.nameWithOwner,
      ],
    );

    await ensureActivityCaches({
      force: true,
      reason: "test:activity-service:linked-items",
    });

    const issueResult = await getActivityItems({ types: ["issue"] });
    const linkedIssue = issueResult.items.find(
      (entry) => entry.id === issueAlpha.id,
    );
    expect(linkedIssue?.linkedPullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: pullRequestBeta.id, status: "open" }),
      ]),
    );

    const prResult = await getActivityItems({ types: ["pull_request"] });
    const linkedPr = prResult.items.find(
      (entry) => entry.id === pullRequestBeta.id,
    );
    expect(linkedPr?.linkedIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: issueAlpha.id })]),
    );

    const detail = await getActivityItemDetail(issueAlpha.id);
    expect(detail?.linkedPullRequests).toEqual(
      linkedIssue?.linkedPullRequests ?? [],
    );
  });

  it("does not apply issue attention badges to discussions", async () => {
    const { repoAlpha, userPriority } = await seedBasicActivityData();

    const discussionRaw = {
      __typename: "Discussion",
      url: "https://example.com/discussions/303",
      assignees: { nodes: [] },
      labels: { nodes: [] },
      body: "Discussion body content",
    };

    const discussion: DbIssue = {
      id: "discussion-alpha",
      number: 303,
      repositoryId: repoAlpha.id,
      authorId: userPriority.id,
      title: "Alpha discussion",
      state: "OPEN",
      createdAt: BASE_TIME,
      updatedAt: "2024-01-04T00:00:00.000Z",
      closedAt: null,
      raw: discussionRaw,
    };

    await seedActivityIssues([discussion]);

    await rebuildActivitySnapshot();

    const attention: AttentionInsights = {
      ...emptyInsights(),
      backlogIssues: [
        {
          id: discussion.id,
          number: discussion.number,
          title: discussion.title ?? null,
          url: discussionRaw.url,
          repository: {
            id: repoAlpha.id,
            name: repoAlpha.name,
            nameWithOwner: repoAlpha.nameWithOwner,
          },
          repositoryMaintainers: [],
          author: null,
          assignees: [],
          linkedPullRequests: [],
          labels: [],
          issueType: null,
          milestone: null,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
          ageDays: 60,
        } satisfies IssueAttentionItem,
      ],
      stalledInProgressIssues: [
        {
          id: discussion.id,
          number: discussion.number,
          title: discussion.title ?? null,
          url: discussionRaw.url,
          repository: {
            id: repoAlpha.id,
            name: repoAlpha.name,
            nameWithOwner: repoAlpha.nameWithOwner,
          },
          repositoryMaintainers: [],
          author: null,
          assignees: [],
          linkedPullRequests: [],
          labels: [],
          issueType: null,
          milestone: null,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
          ageDays: 60,
          startedAt: discussion.createdAt,
          inProgressAgeDays: 40,
        } satisfies IssueAttentionItem,
      ],
      unansweredMentions: [
        {
          commentId: "discussion-comment-1",
          url: `${discussionRaw.url}#comment-1`,
          mentionedAt: "2024-01-10T00:00:00.000Z",
          waitingDays: 10,
          author: null,
          target: null,
          container: {
            type: "discussion",
            id: discussion.id,
            number: discussion.number,
            title: discussion.title ?? null,
            url: discussionRaw.url,
            repository: {
              id: repoAlpha.id,
              name: repoAlpha.name,
              nameWithOwner: repoAlpha.nameWithOwner,
            },
          },
          commentExcerpt: null,
          classification: {
            requiresResponse: true,
            manualRequiresResponse: null,
            manualRequiresResponseAt: null,
            manualDecisionIsStale: false,
            lastEvaluatedAt: null,
          },
        },
      ],
    };

    mockedAttentionInsights.mockResolvedValue(attention);

    const discussionItems = await getActivityItems({
      types: ["discussion"],
      perPage: 5,
    });

    expect(discussionItems.items).toHaveLength(1);
    const [discussionItem] = discussionItems.items;
    expect(discussionItem.type).toBe("discussion");
    expect(discussionItem.attention.unansweredMention).toBe(true);
    expect(discussionItem.attention.reviewRequestPending).toBe(false);
    expect(discussionItem.attention.staleOpenPr).toBe(false);
    expect(discussionItem.attention.idlePr).toBe(false);
    expect(discussionItem.attention.backlogIssue).toBe(false);
    expect(discussionItem.attention.stalledIssue).toBe(false);
  });

  it("returns detailed activity item with project overrides and status timelines", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-31T00:00:00.000Z"));

    const { issueAlpha } = await seedBasicActivityData();

    await insertIssueStatusHistory([
      {
        issueId: issueAlpha.id,
        status: "todo",
        occurredAt: "2024-01-06T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "in_progress",
        occurredAt: "2024-01-08T00:00:00.000Z",
      },
      {
        issueId: issueAlpha.id,
        status: "done",
        occurredAt: "2024-01-15T00:00:00.000Z",
      },
    ]);

    await insertIssueProjectOverrides([
      {
        issueId: issueAlpha.id,
        priorityValue: "High",
        priorityUpdatedAt: "2024-01-09T00:00:00.000Z",
        initiationValue: "Design",
        initiationUpdatedAt: "2024-01-10T00:00:00.000Z",
        startDateValue: "2024-01-11",
        startDateUpdatedAt: "2024-01-11T00:00:00.000Z",
      },
    ]);

    await rebuildActivitySnapshot();

    mockedAttentionInsights.mockResolvedValue(emptyInsights());

    const detail = await getActivityItemDetail(issueAlpha.id);

    expect(detail).not.toBeNull();
    if (!detail) {
      throw new Error("Expected detail to be returned");
    }

    expect(detail.item.id).toBe(issueAlpha.id);
    expect(detail.item.issueTodoProjectPriority).toBe("High");
    expect(detail.todoStatusTimes ?? {}).toMatchObject({
      todo: "2024-01-12T00:00:00.000Z",
      in_progress: "2024-01-08T00:00:00.000Z",
    });
    expect(detail.activityStatusTimes ?? {}).toMatchObject({
      todo: "2024-01-06T00:00:00.000Z",
      in_progress: "2024-01-08T00:00:00.000Z",
      done: "2024-01-15T00:00:00.000Z",
    });
    expect(detail.parentIssues?.[0]).toMatchObject({
      id: "issue-parent",
      number: 42,
    });
    expect(detail.subIssues?.[0]).toMatchObject({
      id: "issue-child",
      number: 205,
    });
    expect(detail.body).toBe("Issue body content");
    expect(detail.item.businessDaysOpen).toBeGreaterThan(0);
    expect(detail.commentCount).toBe(1);
    expect(detail.comments).toHaveLength(1);
    expect(detail.reactions).toEqual([
      {
        content: "THUMBS_UP",
        count: 1,
        users: [
          expect.objectContaining({
            id: "user-alice",
          }),
        ],
      },
    ]);
    expect(detail.comments[0]).toMatchObject({
      id: "comment-1",
      body: "Looks good to me",
      author: {
        id: "user-bob",
      },
      reactions: [],
    });
  });
});
async function rebuildActivitySnapshot() {
  await refreshActivityItemsSnapshot();
}

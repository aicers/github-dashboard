// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshActivityItemsSnapshot } from "@/lib/activity/snapshot";
import { getAttentionInsights } from "@/lib/dashboard/attention";
import { ensureSchema } from "@/lib/db";
import {
  type DbIssue,
  type DbRepository,
  updateSyncConfig,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import {
  buildActor,
  buildRepository,
  businessDaysBetween,
} from "../../../tests/helpers/attention-fixtures";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

const FIXED_NOW = "2024-02-20T00:00:00.000Z";
const EXCLUDED_REPOSITORY_ID = "repo-excluded";
const EXCLUDED_AUTHOR_ID = "user-excluded-author";
const EXCLUDED_ASSIGNEE_ID = "user-excluded-assignee";

type ProjectStatusInput = {
  projectTitle: string;
  status: string;
  occurredAt: string;
};

function buildIssue(params: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  state?: string;
  assigneeIds?: string[];
  projectStatuses?: ProjectStatusInput[];
}): DbIssue {
  const {
    id,
    number,
    repository,
    authorId,
    title,
    createdAt,
    updatedAt,
    state = "OPEN",
    assigneeIds = [],
    projectStatuses = [],
  } = params;

  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title,
    state,
    createdAt,
    updatedAt,
    closedAt: null,
    raw: {
      id,
      url: `https://github.com/${repository.nameWithOwner}/issues/${number.toString()}`,
      title,
      projectStatusHistory: projectStatuses.map((status) => ({
        projectTitle: status.projectTitle,
        status: status.status,
        occurredAt: status.occurredAt,
      })),
      assignees: {
        nodes: assigneeIds.map((assigneeId) => ({ id: assigneeId })),
      },
    },
  } satisfies DbIssue;
}

describe("attention insights for backlog issues", () => {
  const originalTodoProjectName = env.TODO_PROJECT_NAME;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    env.TODO_PROJECT_NAME = "to-do list";
    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [EXCLUDED_REPOSITORY_ID],
      excludedUsers: [EXCLUDED_AUTHOR_ID, EXCLUDED_ASSIGNEE_ID],
    });
  });

  afterEach(() => {
    env.TODO_PROJECT_NAME = originalTodoProjectName;
    vi.useRealTimers();
  });

  it("returns backlog issues with business-day metrics and filters applied", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const excludedAuthor = buildActor(
      EXCLUDED_AUTHOR_ID,
      "excluded-author",
      "Excluded Author",
    );
    const excludedAssignee = buildActor(
      EXCLUDED_ASSIGNEE_ID,
      "excluded-assignee",
      "Excluded Assignee",
    );

    for (const actor of [
      owner,
      alice,
      bob,
      carol,
      excludedAuthor,
      excludedAssignee,
    ]) {
      await upsertUser(actor);
    }

    const includedRepo = buildRepository(
      "repo-included",
      "included",
      owner.id,
      owner.login ?? "owner",
    );
    const excludedRepo = buildRepository(
      EXCLUDED_REPOSITORY_ID,
      "excluded",
      owner.id,
      owner.login ?? "owner",
    );

    await upsertRepository(includedRepo);
    await upsertRepository(excludedRepo);

    const backlogCreatedAt = "2023-12-01T00:00:00.000Z";
    const backlogUpdatedAt = "2024-02-10T12:00:00.000Z";
    const backlogSecondaryCreatedAt = "2023-12-08T00:00:00.000Z";
    const backlogSecondaryUpdatedAt = "2024-02-15T12:00:00.000Z";
    const inProgressStartedAt = "2024-01-02T09:00:00.000Z";

    const backlogPrimary = buildIssue({
      id: "issue-backlog-primary",
      number: 401,
      repository: includedRepo,
      authorId: alice.id,
      title: "Investigate legacy backlog task",
      createdAt: backlogCreatedAt,
      updatedAt: backlogUpdatedAt,
      assigneeIds: [bob.id, excludedAssignee.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: backlogCreatedAt,
        },
      ],
    });

    const backlogSecondary = buildIssue({
      id: "issue-backlog-secondary",
      number: 402,
      repository: includedRepo,
      authorId: carol.id,
      title: "Second backlog item waiting to start",
      createdAt: backlogSecondaryCreatedAt,
      updatedAt: backlogSecondaryUpdatedAt,
      assigneeIds: [],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: backlogSecondaryCreatedAt,
        },
      ],
    });

    const excludedByRepository = buildIssue({
      id: "issue-excluded-repo",
      number: 410,
      repository: excludedRepo,
      authorId: alice.id,
      title: "Should be hidden because repository is excluded",
      createdAt: backlogCreatedAt,
      updatedAt: backlogUpdatedAt,
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: backlogCreatedAt,
        },
      ],
    });

    const excludedByAuthor = buildIssue({
      id: "issue-excluded-author",
      number: 411,
      repository: includedRepo,
      authorId: excludedAuthor.id,
      title: "Should be hidden because author is excluded",
      createdAt: backlogCreatedAt,
      updatedAt: backlogUpdatedAt,
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: backlogCreatedAt,
        },
      ],
    });

    const recentIssue = buildIssue({
      id: "issue-recent",
      number: 420,
      repository: includedRepo,
      authorId: alice.id,
      title: "Recent backlog addition",
      createdAt: "2024-02-05T00:00:00.000Z",
      updatedAt: "2024-02-19T12:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2024-02-05T00:00:00.000Z",
        },
      ],
    });

    const stalledIssue = buildIssue({
      id: "issue-in-progress",
      number: 430,
      repository: includedRepo,
      authorId: alice.id,
      title: "Issue already in progress",
      createdAt: "2023-12-20T00:00:00.000Z",
      updatedAt: "2024-02-18T12:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: "2023-12-20T00:00:00.000Z",
        },
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: inProgressStartedAt,
        },
      ],
    });

    for (const issue of [
      backlogPrimary,
      backlogSecondary,
      excludedByRepository,
      excludedByAuthor,
      recentIssue,
      stalledIssue,
    ]) {
      await upsertIssue(issue);
    }

    await refreshActivityItemsSnapshot({ truncate: true });

    const insights = await getAttentionInsights();

    expect(insights.backlogIssues).toHaveLength(2);
    expect(insights.backlogIssues.map((issue) => issue.id)).toEqual([
      backlogPrimary.id,
      backlogSecondary.id,
    ]);

    const primary = insights.backlogIssues.find(
      (issue) => issue.id === backlogPrimary.id,
    );
    const secondary = insights.backlogIssues.find(
      (issue) => issue.id === backlogSecondary.id,
    );

    if (!primary || !secondary) {
      throw new Error("Expected backlog issues to be returned in insights");
    }

    expect(primary.repository).toEqual({
      id: includedRepo.id,
      name: includedRepo.name,
      nameWithOwner: includedRepo.nameWithOwner,
    });
    expect(primary.author).toEqual({
      id: alice.id,
      login: alice.login,
      name: alice.name,
    });
    expect(primary.assignees).toEqual([
      {
        id: bob.id,
        login: bob.login,
        name: bob.name,
      },
    ]);
    expect(primary.ageDays).toBe(
      businessDaysBetween(backlogCreatedAt, FIXED_NOW),
    );
    expect(primary.startedAt).toBeNull();
    expect(primary.inProgressAgeDays).toBeUndefined();

    expect(secondary.author).toEqual({
      id: carol.id,
      login: carol.login,
      name: carol.name,
    });
    expect(secondary.assignees).toHaveLength(0);
    expect(secondary.ageDays).toBe(
      businessDaysBetween(backlogSecondaryCreatedAt, FIXED_NOW),
    );
    expect(secondary.startedAt).toBeNull();
    expect(secondary.inProgressAgeDays).toBeUndefined();

    expect(insights.stalledInProgressIssues.map((issue) => issue.id)).toContain(
      stalledIssue.id,
    );
  });
});

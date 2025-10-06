// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  closedAt?: string | null;
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
    closedAt = null,
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
    closedAt,
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

describe("attention insights for stalled in-progress issues", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    await ensureSchema();
    await resetDashboardTables();
    await updateSyncConfig({
      timezone: "Asia/Seoul",
      excludedRepositories: [EXCLUDED_REPOSITORY_ID],
      excludedUsers: [EXCLUDED_AUTHOR_ID, EXCLUDED_ASSIGNEE_ID],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stalled issues with business-day metrics, project filters, and exclusions applied", async () => {
    const owner = buildActor("user-owner", "owner", "Owner");
    const alice = buildActor("user-alice", "alice", "Alice");
    const bob = buildActor("user-bob", "bob", "Bob");
    const carol = buildActor("user-carol", "carol", "Carol");
    const dave = buildActor("user-dave", "dave", "Dave");
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
      dave,
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

    const stalledStartedAt = "2023-12-18T00:00:00.000Z";
    const stalledCreatedAt = "2023-11-20T00:00:00.000Z";
    const stalledSecondaryStartedAt = "2024-01-02T00:00:00.000Z";
    const stalledSecondaryCreatedAt = "2023-12-01T00:00:00.000Z";

    const stalledPrimary = buildIssue({
      id: "issue-stalled-primary",
      number: 510,
      repository: includedRepo,
      authorId: alice.id,
      title: "Investigate long-running feature",
      createdAt: stalledCreatedAt,
      updatedAt: "2024-02-18T12:00:00.000Z",
      assigneeIds: [bob.id, excludedAssignee.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: stalledCreatedAt,
        },
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: stalledStartedAt,
        },
      ],
    });

    const stalledSecondary = buildIssue({
      id: "issue-stalled-secondary",
      number: 511,
      repository: includedRepo,
      authorId: carol.id,
      title: "Debug flaky pipeline",
      createdAt: stalledSecondaryCreatedAt,
      updatedAt: "2024-02-19T12:00:00.000Z",
      assigneeIds: [dave.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "Todo",
          occurredAt: stalledSecondaryCreatedAt,
        },
        {
          projectTitle: "to-do list",
          status: "progress",
          occurredAt: stalledSecondaryStartedAt,
        },
      ],
    });

    const excludedByRepo = buildIssue({
      id: "issue-stalled-excluded-repo",
      number: 520,
      repository: excludedRepo,
      authorId: alice.id,
      title: "Hidden by excluded repository",
      createdAt: stalledCreatedAt,
      updatedAt: "2024-02-10T12:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: stalledStartedAt,
        },
      ],
    });

    const excludedByAuthor = buildIssue({
      id: "issue-stalled-excluded-author",
      number: 521,
      repository: includedRepo,
      authorId: excludedAuthor.id,
      title: "Hidden by excluded author",
      createdAt: stalledCreatedAt,
      updatedAt: "2024-02-10T12:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: stalledStartedAt,
        },
      ],
    });

    const recentInProgress = buildIssue({
      id: "issue-stalled-recent",
      number: 522,
      repository: includedRepo,
      authorId: alice.id,
      title: "Too recent to be stalled",
      createdAt: "2024-01-15T00:00:00.000Z",
      updatedAt: "2024-02-19T12:00:00.000Z",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: "2024-02-01T12:00:00.000Z",
        },
      ],
    });

    const closedInProgress = buildIssue({
      id: "issue-stalled-closed",
      number: 523,
      repository: includedRepo,
      authorId: alice.id,
      title: "Closed after work",
      createdAt: stalledCreatedAt,
      updatedAt: "2024-01-30T12:00:00.000Z",
      state: "CLOSED",
      assigneeIds: [bob.id],
      projectStatuses: [
        {
          projectTitle: "to-do list",
          status: "In Progress",
          occurredAt: stalledStartedAt,
        },
      ],
      closedAt: "2024-01-30T12:00:00.000Z",
    });

    for (const issue of [
      stalledPrimary,
      stalledSecondary,
      excludedByRepo,
      excludedByAuthor,
      recentInProgress,
      closedInProgress,
    ]) {
      await upsertIssue(issue);
    }

    const insights = await getAttentionInsights();
    const stalledIssues = insights.stalledInProgressIssues;

    expect(stalledIssues).toHaveLength(2);
    expect(stalledIssues.map((issue) => issue.id)).toEqual([
      stalledPrimary.id,
      stalledSecondary.id,
    ]);

    const primary = stalledIssues.find(
      (issue) => issue.id === stalledPrimary.id,
    );
    const secondary = stalledIssues.find(
      (issue) => issue.id === stalledSecondary.id,
    );

    if (!primary || !secondary) {
      throw new Error("Expected stalled issues to be present in insights");
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
      businessDaysBetween(stalledCreatedAt, FIXED_NOW),
    );
    expect(primary.startedAt).toBe(stalledStartedAt);
    expect(primary.inProgressAgeDays).toBe(
      businessDaysBetween(stalledStartedAt, FIXED_NOW),
    );

    expect(secondary.author).toEqual({
      id: carol.id,
      login: carol.login,
      name: carol.name,
    });
    expect(secondary.assignees).toEqual([
      {
        id: dave.id,
        login: dave.login,
        name: dave.name,
      },
    ]);
    expect(secondary.ageDays).toBe(
      businessDaysBetween(stalledSecondaryCreatedAt, FIXED_NOW),
    );
    expect(secondary.startedAt).toBe(stalledSecondaryStartedAt);
    expect(secondary.inProgressAgeDays).toBe(
      businessDaysBetween(stalledSecondaryStartedAt, FIXED_NOW),
    );
  });
});

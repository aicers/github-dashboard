import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbRepository,
  upsertIssue,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

const CURRENT_RANGE_START = "2024-01-01T00:00:00.000Z";
const CURRENT_RANGE_END = "2024-01-07T23:59:59.999Z";

async function insertIssue(issue: DbIssue) {
  await upsertIssue(issue);
}

describe("analytics issue creation metric", () => {
  beforeEach(async () => {
    await query(
      "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users RESTART IDENTITY CASCADE",
    );
  });

  it("counts issues created across current and previous ranges", async () => {
    const actor: DbActor = {
      id: "user-1",
      login: "octocat",
      name: "Octo Cat",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-1",
      name: "analytics-repo",
      nameWithOwner: "octo/analytics-repo",
      ownerId: actor.id,
      raw: { id: "repo-1" },
    };
    await upsertRepository(repository);

    const issues: DbIssue[] = [
      {
        id: "issue-current-1",
        number: 1,
        repositoryId: repository.id,
        authorId: actor.id,
        title: "Current window issue",
        state: "OPEN",
        createdAt: "2024-01-02T10:00:00.000Z",
        updatedAt: "2024-01-02T10:00:00.000Z",
        closedAt: null,
        raw: { title: "Current window issue" },
      },
      {
        id: "issue-current-2",
        number: 2,
        repositoryId: repository.id,
        authorId: actor.id,
        title: "Another current issue",
        state: "CLOSED",
        createdAt: "2024-01-05T09:00:00.000Z",
        updatedAt: "2024-01-05T09:00:00.000Z",
        closedAt: "2024-01-06T09:00:00.000Z",
        raw: { title: "Another current issue" },
      },
      {
        id: "issue-previous-1",
        number: 3,
        repositoryId: repository.id,
        authorId: actor.id,
        title: "Previous window issue",
        state: "OPEN",
        createdAt: "2023-12-27T12:00:00.000Z",
        updatedAt: "2023-12-27T12:00:00.000Z",
        closedAt: null,
        raw: { title: "Previous window issue" },
      },
      {
        id: "issue-outside-1",
        number: 4,
        repositoryId: repository.id,
        authorId: actor.id,
        title: "Outside range issue",
        state: "OPEN",
        createdAt: "2023-11-15T12:00:00.000Z",
        updatedAt: "2023-11-15T12:00:00.000Z",
        closedAt: null,
        raw: { title: "Outside range issue" },
      },
    ];

    for (const issue of issues) {
      await insertIssue(issue);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const issuesCreated = analytics.organization.metrics.issuesCreated;
    expect(issuesCreated.current).toBe(2);
    expect(issuesCreated.previous).toBe(1);
    expect(issuesCreated.absoluteChange).toBe(1);
    expect(issuesCreated.percentChange).not.toBeNull();
    expect(issuesCreated.percentChange ?? 0).toBeCloseTo(100, 5);

    const history = analytics.organization.metricHistory.issuesCreated;
    const currentEntry = history.find((entry) => entry.period === "current");
    const previousEntry = history.find((entry) => entry.period === "previous");

    expect(currentEntry?.value).toBe(2);
    expect(previousEntry?.value).toBe(1);
  });
});

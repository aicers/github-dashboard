import "../../../tests/helpers/postgres-container";
import "@testing-library/jest-dom";

import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbIssue,
  type DbPullRequest,
  type DbRepository,
  getSyncConfig,
  updateSyncConfig,
  upsertIssue,
  upsertPullRequest,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";
import { ensureSchema } from "@/lib/db/schema";
import { resetDashboardAndSyncTables } from "../../../tests/helpers/dashboard-metrics";

type TrendRow = {
  date: string;
  count: number | string;
};

async function fetchTrendCounts(
  table: "issues" | "pull_requests",
  column: "github_created_at" | "github_closed_at" | "github_merged_at",
  start: string,
  end: string,
  repositoryId: string,
  timeZone: string,
) {
  const params: unknown[] = [start, end, [repositoryId]];
  const alias = table === "issues" ? "i" : "p";
  const timeZoneParamIndex = params.length + 1;
  const result = await query<TrendRow>(
    `SELECT to_char(date_trunc('day', ${alias}.${column} AT TIME ZONE $${timeZoneParamIndex}), 'YYYY-MM-DD') AS date, COUNT(*)
     FROM ${table} ${alias}
     WHERE ${alias}.${column} BETWEEN $1 AND $2 AND ${alias}.repository_id = ANY($3::text[])
     GROUP BY date
     ORDER BY date`,
    [...params, timeZone],
  );

  const map = new Map<string, number>();
  result.rows.forEach((row) => {
    if (typeof row.date === "string" && row.date.length) {
      map.set(row.date, Number(row.count ?? 0));
    }
  });

  return map;
}

const CURRENT_RANGE_START = "2024-03-01T00:00:00.000Z";
const CURRENT_RANGE_END = "2024-03-04T23:59:59.999Z";

async function insertIssue(issue: DbIssue) {
  await upsertIssue(issue);
}

async function insertPullRequest(pullRequest: DbPullRequest) {
  await upsertPullRequest(pullRequest);
}

function buildDateKeys(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const keys: string[] = [];

  const current = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const endUtc = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );

  for (let time = current; time <= endUtc; time += 86_400_000) {
    const date = new Date(time);
    const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${date.getUTCDate()}`.padStart(2, "0");
    keys.push(`${date.getUTCFullYear()}-${month}-${day}`);
  }

  return keys;
}

function toValueMap(points: Array<{ date: string; value: number }>) {
  const map = new Map<string, number>();
  points.forEach((point) => {
    map.set(point.date, point.value);
  });
  return map;
}

function countByDate<T>(
  records: readonly T[],
  getTimestamp: (record: T) => string | null | undefined,
  timeZone: string,
) {
  const map = new Map<string, number>();

  records.forEach((record) => {
    const iso = getTimestamp(record);
    if (!iso) {
      return;
    }

    const date = DateTime.fromISO(iso, { zone: "utc" })
      .setZone(timeZone)
      .toISODate();

    if (!date) {
      return;
    }

    map.set(date, (map.get(date) ?? 0) + 1);
  });

  return map;
}

function buildNetSeries(
  dateKeys: readonly string[],
  positives: Array<{ date: string; value: number }>,
  negatives: Array<{ date: string; value: number }>,
) {
  const positiveMap = toValueMap(positives);
  const negativeMap = toValueMap(negatives);

  return dateKeys.map((date) => ({
    date,
    delta: (positiveMap.get(date) ?? 0) - (negativeMap.get(date) ?? 0),
  }));
}

describe("analytics net trends", () => {
  beforeEach(async () => {
    await ensureSchema();
    await resetDashboardAndSyncTables();
    await updateSyncConfig({
      timezone: "UTC",
      excludedRepositories: [],
      excludedUsers: [],
    });
  });

  it("builds issue and PR net deltas from database events", async () => {
    const actor: DbActor = {
      id: "actor-1",
      login: "octocat",
      name: "Octo Cat",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    await upsertUser(actor);

    const repository: DbRepository = {
      id: "repo-net-trend",
      name: "net-trend",
      nameWithOwner: "octo/net-trend",
      ownerId: actor.id,
      raw: { id: "repo-net-trend" },
    };
    await upsertRepository(repository);

    let issueNumber = 1;
    const makeIssue = ({
      id,
      createdAt,
      closedAt,
    }: {
      id: string;
      createdAt: string;
      closedAt?: string | null;
    }): DbIssue => {
      const resolvedClosedAt = closedAt ?? null;
      const state = resolvedClosedAt ? "CLOSED" : "OPEN";
      const updatedAt = resolvedClosedAt ?? createdAt;
      return {
        id,
        number: issueNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state,
        createdAt,
        updatedAt,
        closedAt: resolvedClosedAt,
        raw: { title: id },
      };
    };

    const issues: DbIssue[] = [
      makeIssue({
        id: "issue-1",
        createdAt: "2024-03-01T15:00:00.000Z",
        closedAt: "2024-03-01T21:00:00.000Z",
      }),
      makeIssue({
        id: "issue-2",
        createdAt: "2024-03-01T16:00:00.000Z",
      }),
      makeIssue({
        id: "issue-3",
        createdAt: "2024-03-01T17:00:00.000Z",
        closedAt: "2024-03-03T18:00:00.000Z",
      }),
      makeIssue({
        id: "issue-4",
        createdAt: "2024-03-02T15:00:00.000Z",
        closedAt: "2024-03-04T18:00:00.000Z",
      }),
      makeIssue({
        id: "issue-5",
        createdAt: "2024-03-04T15:00:00.000Z",
      }),
    ];

    for (const issue of issues) {
      await insertIssue(issue);
    }

    let prNumber = 1;
    const makePullRequest = ({
      id,
      createdAt,
      mergedAt,
    }: {
      id: string;
      createdAt: string;
      mergedAt?: string | null;
    }): DbPullRequest => {
      const resolvedMergedAt = mergedAt ?? null;
      const merged = Boolean(resolvedMergedAt);
      const state = merged ? "MERGED" : "OPEN";
      const updatedAt = resolvedMergedAt ?? createdAt;
      return {
        id,
        number: prNumber++,
        repositoryId: repository.id,
        authorId: actor.id,
        title: id,
        state,
        createdAt,
        updatedAt,
        closedAt: resolvedMergedAt,
        mergedAt: resolvedMergedAt,
        merged,
        raw: {
          author: { id: actor.id },
          comments: { totalCount: 0 },
          additions: 0,
          deletions: 0,
        },
      };
    };

    const pullRequests: DbPullRequest[] = [
      makePullRequest({
        id: "pr-1",
        createdAt: "2024-03-01T14:00:00.000Z",
        mergedAt: "2024-03-01T22:00:00.000Z",
      }),
      makePullRequest({
        id: "pr-2",
        createdAt: "2024-03-01T16:00:00.000Z",
        mergedAt: "2024-03-03T17:00:00.000Z",
      }),
      makePullRequest({
        id: "pr-3",
        createdAt: "2024-03-02T15:00:00.000Z",
      }),
      makePullRequest({
        id: "pr-4",
        createdAt: "2024-03-03T15:00:00.000Z",
        mergedAt: "2024-03-04T20:00:00.000Z",
      }),
      makePullRequest({
        id: "pr-5",
        createdAt: "2024-03-04T18:00:00.000Z",
      }),
    ];

    for (const pull of pullRequests) {
      await insertPullRequest(pull);
    }

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
      repositoryIds: [repository.id],
    });

    const { issuesCreated, issuesClosed, prsCreated, prsMerged } =
      analytics.organization.trends;

    const config = await getSyncConfig();
    const timeZone = config?.timezone ?? "UTC";

    const dateKeys = buildDateKeys(analytics.range.start, analytics.range.end);

    const dbIssuesCreated = await fetchTrendCounts(
      "issues",
      "github_created_at",
      analytics.range.start,
      analytics.range.end,
      repository.id,
      timeZone,
    );
    const dbIssuesClosed = await fetchTrendCounts(
      "issues",
      "github_closed_at",
      analytics.range.start,
      analytics.range.end,
      repository.id,
      timeZone,
    );
    const dbPrsCreated = await fetchTrendCounts(
      "pull_requests",
      "github_created_at",
      analytics.range.start,
      analytics.range.end,
      repository.id,
      timeZone,
    );
    const dbPrsMerged = await fetchTrendCounts(
      "pull_requests",
      "github_merged_at",
      analytics.range.start,
      analytics.range.end,
      repository.id,
      timeZone,
    );

    const manualIssuesCreated = countByDate(
      issues,
      (issue) => issue.createdAt,
      timeZone,
    );
    const manualIssuesClosed = countByDate(
      issues,
      (issue) => issue.closedAt ?? null,
      timeZone,
    );
    const manualPrsCreated = countByDate(
      pullRequests,
      (pr) => pr.createdAt,
      timeZone,
    );
    const manualPrsMerged = countByDate(
      pullRequests,
      (pr) => pr.mergedAt ?? null,
      timeZone,
    );

    const toObject = (map: Map<string, number>) =>
      Object.fromEntries(
        [...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
      );
    expect(toObject(dbIssuesCreated)).toEqual(toObject(manualIssuesCreated));
    expect(toObject(dbIssuesClosed)).toEqual(toObject(manualIssuesClosed));
    expect(toObject(dbPrsCreated)).toEqual(toObject(manualPrsCreated));
    expect(toObject(dbPrsMerged)).toEqual(toObject(manualPrsMerged));

    const issuesNet = buildNetSeries(dateKeys, issuesCreated, issuesClosed);
    const prsNet = buildNetSeries(dateKeys, prsCreated, prsMerged);

    const assertMatchesForDateKeys = (
      actual: Map<string, number>,
      expected: Map<string, number>,
    ) => {
      dateKeys.forEach((date) => {
        expect(actual.get(date) ?? 0).toBe(expected.get(date) ?? 0);
      });
    };

    assertMatchesForDateKeys(toValueMap(issuesCreated), dbIssuesCreated);
    assertMatchesForDateKeys(toValueMap(issuesClosed), dbIssuesClosed);
    assertMatchesForDateKeys(toValueMap(prsCreated), dbPrsCreated);
    assertMatchesForDateKeys(toValueMap(prsMerged), dbPrsMerged);

    const expectedIssuesNet = dateKeys.map((date) => ({
      date,
      delta:
        (manualIssuesCreated.get(date) ?? 0) -
        (manualIssuesClosed.get(date) ?? 0),
    }));
    const expectedPrsNet = dateKeys.map((date) => ({
      date,
      delta:
        (manualPrsCreated.get(date) ?? 0) - (manualPrsMerged.get(date) ?? 0),
    }));

    expect(issuesNet).toEqual(expectedIssuesNet);
    expect(prsNet).toEqual(expectedPrsNet);
  }, 25_000);
});

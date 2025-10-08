import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import { calculateBusinessHoursBetween } from "@/lib/dashboard/business-days";
import type { PeriodKey } from "@/lib/dashboard/types";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbComment,
  type DbPullRequest,
  type DbReaction,
  type DbRepository,
  type DbReview,
  type DbReviewRequest,
  upsertComment,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";
import {
  buildPeriodRanges as buildIsoPeriodRanges,
  CURRENT_RANGE_END,
  CURRENT_RANGE_START,
  PERIOD_KEYS,
  resetDashboardTables,
} from "../../../tests/helpers/dashboard-metrics";
import { formatMetricSnapshotForTest } from "../../../tests/helpers/metric-formatting";

const PERIODS = PERIOD_KEYS;

type ResponseType = "review" | "comment" | "reaction";

type ResponseSpec = {
  kind: ResponseType;
  respondedAt: string;
  actorId?: string;
};

type ReviewRequestSpec = {
  key: string;
  reviewerId: string;
  requestedAt: string;
  responses: ResponseSpec[];
  removedAt?: string;
};

type PullSpec = {
  key: string;
  authorId: string;
  createdAt: string;
  mergedAt: string;
  requests: ReviewRequestSpec[];
};

type PeriodSpecMap = Record<PeriodKey, PullSpec[]>;

type PeriodRange = {
  start: Date;
  end: Date;
};

type PeriodRanges = Record<PeriodKey, PeriodRange>;

type ResponseExpectations = Record<
  PeriodKey,
  {
    organization: number | null;
    individual: number | null;
  }
>;

function _subtractRange(
  previousOfStart: Date,
  previousOfEnd: Date,
): PeriodRange {
  const duration = previousOfEnd.getTime() - previousOfStart.getTime();
  const end = new Date(previousOfStart.getTime() - 1);
  const start = new Date(end.getTime() - duration);
  return { start, end };
}

function buildDatePeriodRanges(): PeriodRanges {
  const isoRanges = buildIsoPeriodRanges(
    CURRENT_RANGE_START,
    CURRENT_RANGE_END,
  );
  return PERIODS.reduce((ranges, key) => {
    const range = isoRanges[key];
    ranges[key] = {
      start: new Date(range.start),
      end: new Date(range.end),
    } satisfies PeriodRange;
    return ranges;
  }, {} as PeriodRanges);
}

function toMs(value: string) {
  const result = new Date(value).getTime();
  if (Number.isNaN(result)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return result;
}

function computeAverageResponseHours({
  periodSpecs,
  ranges,
  targetReviewerId,
  dependabotId,
}: {
  periodSpecs: PeriodSpecMap;
  ranges: PeriodRanges;
  targetReviewerId: string;
  dependabotId: string;
}): ResponseExpectations {
  const results = {} as ResponseExpectations;

  for (const period of PERIODS) {
    const pulls = periodSpecs[period] ?? [];
    const range = ranges[period];
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();

    const orgValues: number[] = [];
    const individualValues: number[] = [];

    for (const pull of pulls) {
      if (pull.authorId === dependabotId) {
        continue;
      }

      const pullCreatedMs = toMs(pull.createdAt);
      const pullMergedMs = toMs(pull.mergedAt);
      if (pullCreatedMs < startMs || pullCreatedMs > endMs) {
        continue;
      }
      if (pullMergedMs < startMs || pullMergedMs > endMs) {
        continue;
      }

      for (const request of pull.requests) {
        const requestedMs = toMs(request.requestedAt);
        if (requestedMs < startMs || requestedMs > endMs) {
          continue;
        }

        const cutoffMs = request.removedAt ? toMs(request.removedAt) : null;

        const validResponse = request.responses
          .map((response) => {
            const respondedMs = new Date(response.respondedAt).getTime();
            if (Number.isNaN(respondedMs)) {
              return null;
            }
            if (respondedMs < requestedMs) {
              return null;
            }
            if (respondedMs < startMs || respondedMs > endMs) {
              return null;
            }
            if (cutoffMs !== null && respondedMs >= cutoffMs) {
              return null;
            }
            if (response.actorId && response.actorId !== request.reviewerId) {
              return null;
            }
            return respondedMs;
          })
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b)[0];

        if (validResponse === undefined) {
          continue;
        }

        const requestedAt = request.requestedAt;
        const respondedAt = new Date(validResponse).toISOString();
        const hours = calculateBusinessHoursBetween(requestedAt, respondedAt);
        if (hours === null || !Number.isFinite(hours)) {
          continue;
        }

        orgValues.push(hours);
        if (request.reviewerId === targetReviewerId) {
          individualValues.push(hours);
        }
      }
    }

    const organization =
      orgValues.length > 0
        ? orgValues.reduce((sum, value) => sum + value, 0) / orgValues.length
        : null;
    const individual =
      individualValues.length > 0
        ? individualValues.reduce((sum, value) => sum + value, 0) /
          individualValues.length
        : null;

    results[period] = { organization, individual };
  }

  return results;
}

function buildPullRequest({
  repository,
  authorId,
  createdAt,
  mergedAt,
  key,
  number,
}: {
  repository: DbRepository;
  authorId: string;
  createdAt: string;
  mergedAt: string;
  key: string;
  number: number;
}): DbPullRequest {
  return {
    id: `${repository.id}-${key}`,
    number,
    repositoryId: repository.id,
    authorId,
    title: `${repository.name} #${number}`,
    state: "MERGED",
    createdAt,
    updatedAt: mergedAt,
    closedAt: mergedAt,
    mergedAt,
    merged: true,
    raw: {
      author: { id: authorId },
      additions: 0,
      deletions: 0,
      comments: { totalCount: 0 },
    },
  };
}

async function insertReviewRequest(
  request: DbReviewRequest,
  removedAt?: string,
) {
  await upsertReviewRequest(request);
  if (removedAt) {
    await query(`UPDATE review_requests SET removed_at = $2 WHERE id = $1`, [
      request.id,
      removedAt,
    ]);
  }
}

async function insertResponse({
  response,
  pullRequestId,
  reviewerId,
  reviewCounter,
  commentCounter,
  reactionCounter,
}: {
  response: ResponseSpec;
  pullRequestId: string;
  reviewerId: string;
  reviewCounter: { current: number };
  commentCounter: { current: number };
  reactionCounter: { current: number };
}) {
  const actorId = response.actorId ?? reviewerId;
  if (response.kind === "review") {
    const review: DbReview = {
      id: `${pullRequestId}-response-review-${reviewCounter.current++}`,
      pullRequestId,
      authorId: actorId,
      state: "APPROVED",
      submittedAt: response.respondedAt,
      raw: {},
    };
    await upsertReview(review);
    return;
  }

  if (response.kind === "comment") {
    const comment: DbComment = {
      id: `${pullRequestId}-response-comment-${commentCounter.current++}`,
      issueId: null,
      pullRequestId,
      reviewId: null,
      authorId: actorId,
      createdAt: response.respondedAt,
      updatedAt: response.respondedAt,
      raw: {},
    };
    await upsertComment(comment);
    return;
  }

  const reaction: DbReaction = {
    id: `${pullRequestId}-response-reaction-${reactionCounter.current++}`,
    subjectType: "pull_request",
    subjectId: pullRequestId,
    userId: actorId,
    content: "THUMBS_UP",
    createdAt: response.respondedAt,
    raw: {},
  };
  await upsertReaction(reaction);
}

describe("analytics review response time metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("computes organization review response time with history", async () => {
    const author: DbActor = {
      id: "review-response-author",
      login: "octo-response-author",
      name: "Octo Response Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const secondaryAuthor: DbActor = {
      id: "review-response-author-2",
      login: "octo-response-author-2",
      name: "Octo Response Author 2",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "review-response-reviewer",
      login: "octo-review-responder",
      name: "Octo Review Responder",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const backupReviewer: DbActor = {
      id: "review-response-backup",
      login: "octo-backup-responder",
      name: "Octo Backup Responder",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const thirdReviewer: DbActor = {
      id: "review-response-third",
      login: "octo-third-responder",
      name: "Octo Third Responder",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const dependabot: DbActor = {
      id: "dependabot",
      login: "dependabot[bot]",
      name: "Dependabot",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };

    await upsertUser(author);
    await upsertUser(secondaryAuthor);
    await upsertUser(reviewer);
    await upsertUser(backupReviewer);
    await upsertUser(thirdReviewer);
    await upsertUser(dependabot);

    const repository: DbRepository = {
      id: "review-response-repo",
      name: "review-response-repo",
      nameWithOwner: "octo/review-response-repo",
      ownerId: author.id,
      raw: { id: "review-response-repo" },
    };
    await upsertRepository(repository);

    const periodSpecs: PeriodSpecMap = {
      previous4: [
        {
          key: "prev4-1",
          authorId: author.id,
          createdAt: "2023-12-04T09:00:00.000Z",
          mergedAt: "2023-12-05T12:00:00.000Z",
          requests: [
            {
              key: "prev4-1-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-04T10:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2023-12-04T15:00:00.000Z",
                },
              ],
            },
          ],
        },
        {
          key: "prev4-2",
          authorId: secondaryAuthor.id,
          createdAt: "2023-12-06T08:30:00.000Z",
          mergedAt: "2023-12-06T18:30:00.000Z",
          requests: [
            {
              key: "prev4-2-req",
              reviewerId: backupReviewer.id,
              requestedAt: "2023-12-06T09:00:00.000Z",
              responses: [
                {
                  kind: "comment",
                  respondedAt: "2023-12-06T11:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      previous3: [
        {
          key: "prev3-1",
          authorId: author.id,
          createdAt: "2023-12-11T09:00:00.000Z",
          mergedAt: "2023-12-12T14:00:00.000Z",
          requests: [
            {
              key: "prev3-1-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-11T10:00:00.000Z",
              responses: [
                {
                  kind: "comment",
                  respondedAt: "2023-12-11T09:55:00.000Z",
                },
                {
                  kind: "review",
                  respondedAt: "2023-12-11T16:00:00.000Z",
                },
              ],
            },
            {
              key: "prev3-1-backup",
              reviewerId: backupReviewer.id,
              requestedAt: "2023-12-11T11:30:00.000Z",
              responses: [
                {
                  kind: "reaction",
                  respondedAt: "2023-12-11T18:00:00.000Z",
                },
              ],
            },
          ],
        },
        {
          key: "prev3-2",
          authorId: secondaryAuthor.id,
          createdAt: "2023-12-13T12:00:00.000Z",
          mergedAt: "2023-12-14T08:00:00.000Z",
          requests: [
            {
              key: "prev3-2-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-13T13:00:00.000Z",
              responses: [],
            },
          ],
        },
      ],
      previous2: [
        {
          key: "prev2-1",
          authorId: author.id,
          createdAt: "2023-12-18T09:00:00.000Z",
          mergedAt: "2023-12-19T17:00:00.000Z",
          requests: [
            {
              key: "prev2-1-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-18T16:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2023-12-19T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      previous: [
        {
          key: "prev-1",
          authorId: author.id,
          createdAt: "2023-12-26T10:00:00.000Z",
          mergedAt: "2023-12-27T13:00:00.000Z",
          requests: [
            {
              key: "prev-1-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-26T11:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2023-12-27T15:00:00.000Z",
                },
              ],
            },
            {
              key: "prev-1-backup",
              reviewerId: backupReviewer.id,
              requestedAt: "2023-12-26T12:30:00.000Z",
              responses: [
                {
                  kind: "comment",
                  respondedAt: "2023-12-28T10:00:00.000Z",
                },
              ],
              removedAt: "2023-12-27T00:00:00.000Z",
            },
          ],
        },
        {
          key: "prev-dependabot",
          authorId: dependabot.id,
          createdAt: "2023-12-29T10:00:00.000Z",
          mergedAt: "2023-12-30T12:00:00.000Z",
          requests: [
            {
              key: "prev-dependabot-req",
              reviewerId: reviewer.id,
              requestedAt: "2023-12-29T11:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2023-12-29T13:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
      current: [
        {
          key: "cur-1",
          authorId: author.id,
          createdAt: "2024-01-02T09:00:00.000Z",
          mergedAt: "2024-01-03T10:00:00.000Z",
          requests: [
            {
              key: "cur-1-req",
              reviewerId: reviewer.id,
              requestedAt: "2024-01-02T10:00:00.000Z",
              responses: [
                {
                  kind: "comment",
                  respondedAt: "2024-01-02T15:00:00.000Z",
                },
              ],
            },
            {
              key: "cur-1-backup",
              reviewerId: backupReviewer.id,
              requestedAt: "2024-01-02T16:00:00.000Z",
              responses: [
                {
                  kind: "reaction",
                  respondedAt: "2024-01-05T09:00:00.000Z",
                },
              ],
            },
          ],
        },
        {
          key: "cur-2",
          authorId: secondaryAuthor.id,
          createdAt: "2024-01-04T09:00:00.000Z",
          mergedAt: "2024-01-04T20:00:00.000Z",
          requests: [
            {
              key: "cur-2-req",
              reviewerId: reviewer.id,
              requestedAt: "2024-01-04T10:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2024-01-08T09:00:00.000Z",
                },
              ],
            },
            {
              key: "cur-2-third",
              reviewerId: thirdReviewer.id,
              requestedAt: "2024-01-04T11:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2024-01-04T13:00:00.000Z",
                  actorId: backupReviewer.id,
                },
                {
                  kind: "reaction",
                  respondedAt: "2024-01-04T14:00:00.000Z",
                },
              ],
            },
          ],
        },
        {
          key: "cur-dependabot",
          authorId: dependabot.id,
          createdAt: "2024-01-06T09:00:00.000Z",
          mergedAt: "2024-01-06T17:00:00.000Z",
          requests: [
            {
              key: "cur-dependabot-req",
              reviewerId: reviewer.id,
              requestedAt: "2024-01-06T10:00:00.000Z",
              responses: [
                {
                  kind: "review",
                  respondedAt: "2024-01-06T12:00:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    };

    let pullNumber = 1;
    const reviewCounter = { current: 1 };
    const commentCounter = { current: 1 };
    const reactionCounter = { current: 1 };

    for (const period of PERIODS) {
      for (const pull of periodSpecs[period]) {
        const pullRequest = buildPullRequest({
          repository,
          authorId: pull.authorId,
          createdAt: pull.createdAt,
          mergedAt: pull.mergedAt,
          key: pull.key,
          number: pullNumber++,
        });
        await upsertPullRequest(pullRequest);

        for (const request of pull.requests) {
          const requestId = `${pullRequest.id}-request-${request.key}`;
          const reviewRequest: DbReviewRequest = {
            id: requestId,
            pullRequestId: pullRequest.id,
            reviewerId: request.reviewerId,
            requestedAt: request.requestedAt,
            raw: {},
          };
          await insertReviewRequest(reviewRequest, request.removedAt);

          for (const response of request.responses) {
            await insertResponse({
              response,
              pullRequestId: pullRequest.id,
              reviewerId: request.reviewerId,
              reviewCounter,
              commentCounter,
              reactionCounter,
            });
          }
        }
      }
    }

    const outOfRangeRequest: DbReviewRequest = {
      id: `${repository.id}-out-of-range-request`,
      pullRequestId: `${repository.id}-prev-1`,
      reviewerId: reviewer.id,
      requestedAt: "2023-11-20T10:00:00.000Z",
      raw: {},
    };
    await insertReviewRequest(outOfRangeRequest);

    await upsertReview({
      id: `${repository.id}-prev-1-response-late`,
      pullRequestId: `${repository.id}-prev-1`,
      authorId: reviewer.id,
      state: "APPROVED",
      submittedAt: "2023-11-20T15:00:00.000Z",
      raw: {},
    });

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const ranges = buildDatePeriodRanges();
    const expectations = computeAverageResponseHours({
      periodSpecs,
      ranges,
      targetReviewerId: reviewer.id,
      dependabotId: dependabot.id,
    });

    const organizationMetric =
      analytics.organization.metrics.reviewResponseTime;
    const organizationHistory =
      analytics.organization.metricHistory.reviewResponseTime;

    const expectedOrgCurrent = expectations.current.organization ?? 0;
    const expectedOrgPrevious = expectations.previous.organization ?? 0;

    expect(organizationMetric.current ?? Number.NaN).toBeCloseTo(
      expectedOrgCurrent,
      5,
    );
    expect(organizationMetric.previous ?? Number.NaN).toBeCloseTo(
      expectedOrgPrevious,
      5,
    );
    expect(organizationMetric.absoluteChange ?? Number.NaN).toBeCloseTo(
      expectedOrgCurrent - expectedOrgPrevious,
      5,
    );

    const expectedOrgPercent = (() => {
      if (expectations.previous.organization === null) {
        return null;
      }
      if (expectations.previous.organization === 0) {
        return expectations.current.organization === 0 ? 0 : null;
      }
      if (expectations.current.organization === null) {
        return null;
      }
      return (
        (((expectations.current.organization ?? 0) -
          (expectations.previous.organization ?? 0)) /
          (expectations.previous.organization ?? 1)) *
        100
      );
    })();

    if (expectedOrgPercent === null) {
      expect(organizationMetric.percentChange).toBeNull();
    } else {
      expect(organizationMetric.percentChange ?? Number.NaN).toBeCloseTo(
        expectedOrgPercent,
        5,
      );
    }

    organizationHistory.forEach((entry, index) => {
      expect(entry.period).toBe(PERIODS[index]);
      const expectedValue = expectations[PERIODS[index]].organization;
      if (expectedValue == null) {
        expect(entry.value).toBeNull();
      } else {
        expect(entry.value ?? Number.NaN).toBeCloseTo(expectedValue, 5);
      }
    });

    const organizationSnapshot = formatMetricSnapshotForTest(
      {
        current: organizationMetric.current ?? Number.NaN,
        absoluteChange: organizationMetric.absoluteChange ?? Number.NaN,
        percentChange: organizationMetric.percentChange,
        unit: organizationMetric.unit,
      },
      "hours",
    );
    const expectedOrganizationSnapshot = formatMetricSnapshotForTest(
      {
        current: expectedOrgCurrent,
        absoluteChange: expectedOrgCurrent - expectedOrgPrevious,
        percentChange: expectedOrgPercent,
        unit: organizationMetric.unit,
      },
      "hours",
    );
    expect(organizationSnapshot.valueLabel).toBe(
      expectedOrganizationSnapshot.valueLabel,
    );
    expect(
      `${organizationSnapshot.changeLabel} (${organizationSnapshot.percentLabel})`,
    ).toBe(
      `${expectedOrganizationSnapshot.changeLabel} (${expectedOrganizationSnapshot.percentLabel})`,
    );
  });
});

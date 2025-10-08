import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardAnalytics } from "@/lib/dashboard/analytics";
import type { PeriodKey } from "@/lib/dashboard/types";
import {
  type DbActor,
  type DbPullRequest,
  type DbRepository,
  type DbReview,
  upsertPullRequest,
  upsertRepository,
  upsertReview,
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

type ReviewerSpec = {
  reviewerId: string;
  submittedAt?: string | null;
};

type ParticipationSpec = {
  key: string;
  mergedAt: string;
  authorId?: string;
  reviewers: ReviewerSpec[];
};

function hoursBefore(iso: string, hours: number) {
  const base = new Date(iso).getTime();
  return new Date(base - hours * 3_600_000).toISOString();
}

function buildPullRequest({
  repository,
  authorId,
  mergedAt,
  key,
  number,
}: {
  repository: DbRepository;
  authorId: string;
  mergedAt: string;
  key: string;
  number: number;
}): DbPullRequest {
  const createdAt = hoursBefore(mergedAt, 18);
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

async function insertReviews({
  pullRequestId,
  reviewers,
  defaultSubmittedAt,
}: {
  pullRequestId: string;
  reviewers: ReviewerSpec[];
  defaultSubmittedAt: string;
}) {
  if (!reviewers.length) {
    return;
  }

  await Promise.all(
    reviewers.map((entry, index) => {
      const review: DbReview = {
        id: `${pullRequestId}-review-${index + 1}`,
        pullRequestId,
        authorId: entry.reviewerId,
        state: entry.submittedAt === null ? "COMMENTED" : "APPROVED",
        submittedAt:
          entry.submittedAt === undefined
            ? defaultSubmittedAt
            : entry.submittedAt,
        raw: {},
      } satisfies DbReview;

      if (entry.submittedAt === null) {
        review.submittedAt = null;
      }

      return upsertReview(review);
    }),
  );
}

type PeriodRange = {
  start: Date;
  end: Date;
};

type PeriodRanges = Record<PeriodKey, PeriodRange>;

type ParticipationExpectations = Record<
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

function computeExpectedParticipation({
  periodSpecs,
  ranges,
  targetReviewerId,
  dependabotId,
}: {
  periodSpecs: Record<PeriodKey, ParticipationSpec[]>;
  ranges: PeriodRanges;
  targetReviewerId: string;
  dependabotId: string;
}): ParticipationExpectations {
  const results = {} as ParticipationExpectations;

  for (const period of PERIODS) {
    const specs = periodSpecs[period] ?? [];
    const range = ranges[period];
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();

    const orgCounts: number[] = [];
    const individualCounts: number[] = [];

    for (const spec of specs) {
      if (spec.authorId === dependabotId) {
        continue;
      }

      const mergedMs = new Date(spec.mergedAt).getTime();
      if (Number.isNaN(mergedMs)) {
        continue;
      }
      if (mergedMs < startMs || mergedMs > endMs) {
        continue;
      }

      const uniqueReviewers = new Set<string>();
      let reviewerParticipated = false;

      for (const entry of spec.reviewers) {
        if (entry.submittedAt === null) {
          continue;
        }

        const submittedMs =
          entry.submittedAt === undefined
            ? mergedMs
            : new Date(entry.submittedAt).getTime();
        if (Number.isNaN(submittedMs)) {
          continue;
        }
        if (submittedMs < startMs || submittedMs > endMs) {
          continue;
        }

        uniqueReviewers.add(entry.reviewerId);
        if (entry.reviewerId === targetReviewerId) {
          reviewerParticipated = true;
        }
      }

      const count = uniqueReviewers.size;
      orgCounts.push(count);

      if (reviewerParticipated) {
        individualCounts.push(count);
      }
    }

    const organization =
      orgCounts.length > 0
        ? orgCounts.reduce((sum, value) => sum + value, 0) / orgCounts.length
        : null;
    const individual =
      individualCounts.length > 0
        ? individualCounts.reduce((sum, value) => sum + value, 0) /
          individualCounts.length
        : null;

    results[period] = { organization, individual };
  }

  return results;
}

describe("analytics review participation metrics", () => {
  beforeEach(async () => {
    await resetDashboardTables();
  });

  it("computes organization review participation with history", async () => {
    const author: DbActor = {
      id: "review-participation-author",
      login: "octo-review-author",
      name: "Octo Review Author",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const secondaryAuthor: DbActor = {
      id: "review-participation-secondary-author",
      login: "octo-review-author-2",
      name: "Octo Review Author 2",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const reviewer: DbActor = {
      id: "review-participation-reviewer",
      login: "octo-reviewer",
      name: "Octo Reviewer",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const backupReviewer: DbActor = {
      id: "review-participation-backup",
      login: "octo-backup",
      name: "Octo Backup",
      createdAt: CURRENT_RANGE_START,
      updatedAt: CURRENT_RANGE_START,
    };
    const thirdReviewer: DbActor = {
      id: "review-participation-third",
      login: "octo-third",
      name: "Octo Third",
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
      id: "review-participation-repo",
      name: "review-participation-repo",
      nameWithOwner: "octo/review-participation-repo",
      ownerId: author.id,
      raw: { id: "review-participation-repo" },
    };
    await upsertRepository(repository);

    const periodSpecs: Record<PeriodKey, ParticipationSpec[]> = {
      previous4: [
        {
          key: "prev4-1",
          mergedAt: "2023-12-04T12:00:00.000Z",
          reviewers: [{ reviewerId: reviewer.id }],
        },
        {
          key: "prev4-2",
          mergedAt: "2023-12-06T15:30:00.000Z",
          reviewers: [
            { reviewerId: backupReviewer.id },
            { reviewerId: reviewer.id, submittedAt: null },
          ],
        },
        {
          key: "prev4-3",
          mergedAt: "2023-12-07T18:45:00.000Z",
          reviewers: [
            { reviewerId: backupReviewer.id },
            { reviewerId: thirdReviewer.id },
          ],
        },
      ],
      previous3: [
        {
          key: "prev3-1",
          mergedAt: "2023-12-11T09:20:00.000Z",
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
            {
              reviewerId: thirdReviewer.id,
              submittedAt: "2023-12-10T23:00:00.000Z",
            },
          ],
        },
        {
          key: "prev3-2",
          mergedAt: "2023-12-13T11:10:00.000Z",
          reviewers: [{ reviewerId: backupReviewer.id }],
        },
        {
          key: "prev3-3",
          mergedAt: "2023-12-14T16:05:00.000Z",
          reviewers: [],
        },
      ],
      previous2: [],
      previous: [
        {
          key: "prev-1",
          mergedAt: "2023-12-26T10:45:00.000Z",
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
          ],
        },
        {
          key: "prev-2",
          mergedAt: "2023-12-27T14:30:00.000Z",
          reviewers: [{ reviewerId: backupReviewer.id }],
        },
        {
          key: "prev-3",
          mergedAt: "2023-12-29T09:15:00.000Z",
          reviewers: [],
        },
        {
          key: "prev-4",
          mergedAt: "2023-12-30T17:25:00.000Z",
          reviewers: [{ reviewerId: reviewer.id }],
        },
        {
          key: "prev-dependabot",
          mergedAt: "2023-12-31T12:00:00.000Z",
          authorId: dependabot.id,
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
          ],
        },
      ],
      current: [
        {
          key: "cur-1",
          mergedAt: "2024-01-02T09:40:00.000Z",
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
            { reviewerId: thirdReviewer.id, submittedAt: null },
          ],
        },
        {
          key: "cur-2",
          mergedAt: "2024-01-03T15:55:00.000Z",
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: thirdReviewer.id },
          ],
        },
        {
          key: "cur-3",
          mergedAt: "2024-01-05T08:05:00.000Z",
          reviewers: [{ reviewerId: backupReviewer.id }],
        },
        {
          key: "cur-4",
          mergedAt: "2024-01-06T13:10:00.000Z",
          reviewers: [
            { reviewerId: backupReviewer.id },
            {
              reviewerId: thirdReviewer.id,
              submittedAt: "2023-12-31T23:50:00.000Z",
            },
          ],
        },
        {
          key: "cur-dependabot",
          mergedAt: "2024-01-07T19:20:00.000Z",
          authorId: dependabot.id,
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
          ],
        },
      ],
    };

    let pullNumber = 1;
    const seedingTasks: Promise<void>[] = [];

    for (const period of PERIODS) {
      for (const spec of periodSpecs[period]) {
        const number = pullNumber++;
        seedingTasks.push(
          (async () => {
            const pullRequest = buildPullRequest({
              repository,
              authorId: spec.authorId ?? author.id,
              mergedAt: spec.mergedAt,
              key: spec.key,
              number,
            });
            await upsertPullRequest(pullRequest);
            await insertReviews({
              pullRequestId: pullRequest.id,
              reviewers: spec.reviewers,
              defaultSubmittedAt: spec.mergedAt,
            });
          })(),
        );
      }
    }

    const outOfRangeNumber = pullNumber++;
    seedingTasks.push(
      (async () => {
        const outOfRangePull = buildPullRequest({
          repository,
          authorId: author.id,
          mergedAt: "2023-11-20T10:00:00.000Z",
          key: "out-of-range",
          number: outOfRangeNumber,
        });
        await upsertPullRequest(outOfRangePull);
        await insertReviews({
          pullRequestId: outOfRangePull.id,
          reviewers: [
            { reviewerId: reviewer.id },
            { reviewerId: backupReviewer.id },
          ],
          defaultSubmittedAt: "2023-11-20T10:00:00.000Z",
        });
      })(),
    );

    await Promise.all(seedingTasks);

    const analytics = await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });

    const ranges = buildDatePeriodRanges();
    const expectations = computeExpectedParticipation({
      periodSpecs,
      ranges,
      targetReviewerId: reviewer.id,
      dependabotId: dependabot.id,
    });

    const organizationMetric =
      analytics.organization.metrics.reviewParticipation;
    const organizationHistory =
      analytics.organization.metricHistory.reviewParticipation;

    const expectedOrganizationCurrent = expectations.current.organization ?? 0;
    const expectedOrganizationPrevious =
      expectations.previous.organization ?? 0;

    expect(organizationMetric.current).toBeCloseTo(
      expectedOrganizationCurrent,
      5,
    );
    expect(organizationMetric.previous).toBeCloseTo(
      expectedOrganizationPrevious,
      5,
    );
    expect(organizationMetric.absoluteChange).toBeCloseTo(
      expectedOrganizationCurrent - expectedOrganizationPrevious,
      5,
    );

    const expectedOrganizationPercent = (() => {
      const previous = expectedOrganizationPrevious;
      const current = expectedOrganizationCurrent;
      if (previous === 0) {
        return current === 0 ? 0 : null;
      }
      return ((current - previous) / previous) * 100;
    })();

    if (expectedOrganizationPercent == null) {
      expect(organizationMetric.percentChange).toBeNull();
    } else {
      expect(organizationMetric.percentChange ?? Number.NaN).toBeCloseTo(
        expectedOrganizationPercent,
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
        current: organizationMetric.current ?? 0,
        absoluteChange: organizationMetric.absoluteChange ?? 0,
        percentChange: organizationMetric.percentChange,
      },
      "percentage",
    );
    const expectedOrganizationSnapshot = formatMetricSnapshotForTest(
      {
        current: expectedOrganizationCurrent,
        absoluteChange:
          expectedOrganizationCurrent - expectedOrganizationPrevious,
        percentChange: expectedOrganizationPercent,
      },
      "percentage",
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

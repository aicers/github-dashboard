import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  type AttentionInsights,
  addUserId,
  buildRepositoryReference,
  type Dataset,
  differenceInDays,
  differenceInDaysOrNull,
  fetchLinkedIssuesForPullRequests,
  fetchReviewerMap,
  type IssueAttentionItem,
  type MentionAttentionItem,
  type PullRequestAttentionItem,
  type ReviewRequestAttentionItem,
  type ReviewRequestRawItem,
  type ReviewRequestRow,
  STUCK_REVIEW_BUSINESS_DAYS,
  toIssueReference,
  toPullRequestReference,
  toUserReference,
} from "@/lib/dashboard/attention/types";
import { loadCombinedHolidaySet } from "@/lib/dashboard/business-days";
import { createPersonalHolidaySetLoader } from "@/lib/dashboard/personal-holidays";

export * from "@/lib/dashboard/attention/mentions";
export * from "@/lib/dashboard/attention/project-fields";
export * from "@/lib/dashboard/attention/queries";
export * from "@/lib/dashboard/attention/types";

import { fetchUnansweredMentions } from "@/lib/dashboard/attention/mentions";
import {
  fetchIssueInsights,
  fetchMergeDelayedPullRequests,
  fetchOrganizationMaintainerIds,
  fetchRepositoryMaintainersByRepository,
  fetchReviewStalledPullRequests,
  fetchReviewUnassignedPullRequests,
} from "@/lib/dashboard/attention/queries";
import { normalizeOrganizationHolidayCodes } from "@/lib/dashboard/holiday-utils";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import {
  getSyncConfig,
  getUserPreferencesByIds,
  getUserProfiles,
  listUserPersonalHolidaysByIds,
} from "@/lib/db/operations";
import { env } from "@/lib/env";
import type { HolidayCalendarCode } from "@/lib/holidays/constants";
import { readUserTimeSettings } from "@/lib/user/time-settings";

export async function fetchStuckReviewRequests(
  excludedRepositoryIds: readonly string[],
  excludedUserIds: readonly string[],
  now: Date,
  organizationHolidayCodes: HolidayCalendarCode[],
  organizationHolidaySet: ReadonlySet<string>,
): Promise<Dataset<ReviewRequestRawItem>> {
  const result = await query<ReviewRequestRow>(
    `WITH base AS (
       SELECT
         rr.id,
         rr.pull_request_id,
         rr.reviewer_id,
         rr.requested_at,
         pr.number AS pr_number,
         pr.title AS pr_title,
         pr.data->>'url' AS pr_url,
         pr.github_created_at AS pr_created_at,
         pr.github_updated_at AS pr_updated_at,
         pr.repository_id AS pr_repository_id,
         pr.author_id AS pr_author_id,
         repo.name AS repository_name,
         repo.name_with_owner AS repository_name_with_owner
       FROM review_requests rr
       JOIN pull_requests pr ON pr.id = rr.pull_request_id
       JOIN repositories repo ON repo.id = pr.repository_id
       WHERE rr.reviewer_id IS NOT NULL
         AND rr.removed_at IS NULL
         AND rr.requested_at <= $3::timestamptz - INTERVAL '2 days'
         AND pr.github_closed_at IS NULL
         AND COALESCE(pr.data->>'reviewDecision', '') <> 'APPROVED'
         AND NOT (pr.repository_id = ANY($1::text[]))
         AND (pr.author_id IS NULL OR NOT (pr.author_id = ANY($2::text[])))
         AND NOT (rr.reviewer_id = ANY($2::text[]))
         AND NOT EXISTS (
           SELECT 1
           FROM reviews r
           WHERE r.pull_request_id = rr.pull_request_id
             AND r.author_id = rr.reviewer_id
             AND r.github_submitted_at IS NOT NULL
             AND r.github_submitted_at >= rr.requested_at
         )
         AND NOT EXISTS (
           SELECT 1
           FROM comments c
           WHERE c.pull_request_id = rr.pull_request_id
             AND c.author_id = rr.reviewer_id
             AND c.github_created_at >= rr.requested_at
         )
         AND NOT EXISTS (
           SELECT 1
           FROM reactions reac
           LEFT JOIN comments comment ON comment.id = reac.subject_id
           LEFT JOIN reviews review ON review.id = reac.subject_id
            WHERE reac.user_id = rr.reviewer_id
              AND (
                (LOWER(reac.subject_type) LIKE 'pullrequest%' AND reac.subject_id = rr.pull_request_id) OR
                (comment.pull_request_id = rr.pull_request_id) OR
                (review.pull_request_id = rr.pull_request_id)
              )
             AND COALESCE(reac.github_created_at, NOW()) >= rr.requested_at
         )
     )
     SELECT
       base.id,
       base.pull_request_id,
       base.reviewer_id,
       base.requested_at,
       base.pr_number,
       base.pr_title,
       base.pr_url,
       base.pr_created_at,
       base.pr_updated_at,
       base.pr_repository_id,
       base.pr_author_id,
       base.repository_name,
       base.repository_name_with_owner,
       ARRAY(SELECT DISTINCT reviewer_id
             FROM review_requests
             WHERE pull_request_id = base.pull_request_id
               AND reviewer_id IS NOT NULL
               AND removed_at IS NULL
               AND NOT (reviewer_id = ANY($2::text[])))
         || ARRAY(SELECT DISTINCT author_id
                 FROM reviews
                 WHERE pull_request_id = base.pull_request_id
                   AND author_id IS NOT NULL
                   AND NOT (author_id = ANY($2::text[])))
         AS pr_reviewers
     FROM base
     ORDER BY base.requested_at ASC`,
    [excludedRepositoryIds, excludedUserIds, now],
  );

  const userIds = new Set<string>();
  const prIds = result.rows.map((row) => row.pull_request_id);
  const [prReviewerMap, linkedIssuesMap] = await Promise.all([
    fetchReviewerMap(prIds, excludedUserIds),
    fetchLinkedIssuesForPullRequests(prIds),
  ]);

  const reviewerIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.reviewer_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [preferencesMap, personalHolidayMap] = await Promise.all([
    getUserPreferencesByIds(reviewerIds),
    listUserPersonalHolidaysByIds(reviewerIds),
  ]);

  const getPersonalHolidaySet = createPersonalHolidaySetLoader({
    organizationHolidayCodes,
    organizationHolidaySet,
    preferencesMap,
    personalHolidayMap,
  });

  const items: ReviewRequestRawItem[] = [];

  for (const row of result.rows) {
    const reviewerHolidays = await getPersonalHolidaySet(row.reviewer_id);
    const waitingDays = differenceInDays(
      row.requested_at,
      now,
      reviewerHolidays,
    );
    if (waitingDays < STUCK_REVIEW_BUSINESS_DAYS) {
      continue;
    }

    const reviewerSet =
      prReviewerMap.get(row.pull_request_id) ?? new Set<string>();
    const combinedReviewers = new Set<string>(reviewerSet);
    (row.pr_reviewers ?? []).forEach((id) => {
      if (id) {
        combinedReviewers.add(id);
      }
    });
    if (row.reviewer_id) {
      combinedReviewers.add(row.reviewer_id);
    }

    const reviewerIdList = Array.from(combinedReviewers);
    for (const id of reviewerIdList) {
      addUserId(userIds, id);
    }
    addUserId(userIds, row.pr_author_id);
    addUserId(userIds, row.reviewer_id);

    const pullRequestAgeDays = differenceInDaysOrNull(
      row.pr_created_at,
      now,
      organizationHolidaySet,
    );
    const pullRequestInactivityDays = differenceInDaysOrNull(
      row.pr_updated_at,
      now,
      organizationHolidaySet,
    );

    items.push({
      id: row.id,
      requestedAt: row.requested_at,
      waitingDays,
      reviewerId: row.reviewer_id,
      pullRequest: {
        id: row.pull_request_id,
        number: row.pr_number,
        title: row.pr_title,
        url: row.pr_url,
        repositoryId: row.pr_repository_id,
        repositoryName: row.repository_name,
        repositoryNameWithOwner: row.repository_name_with_owner,
        authorId: row.pr_author_id,
        reviewerIds: reviewerIdList,
        linkedIssues: linkedIssuesMap.get(row.pull_request_id) ?? [],
      },
      pullRequestCreatedAt: row.pr_created_at,
      pullRequestAgeDays,
      pullRequestInactivityDays,
      pullRequestUpdatedAt: row.pr_updated_at,
    });
  }

  return { items, userIds };
}

export async function getAttentionInsights(options?: {
  userId?: string | null;
  useMentionClassifier?: boolean;
  reviewerUnassignedPrDays?: number;
  reviewStalledPrDays?: number;
  mergeDelayedPrDays?: number;
}): Promise<AttentionInsights> {
  await ensureSchema();

  const [config, userTimeSettings] = await Promise.all([
    getSyncConfig(),
    readUserTimeSettings(options?.userId ?? null),
  ]);
  const organizationHolidayCodes = normalizeOrganizationHolidayCodes(config);
  const organizationHolidaySet = await loadCombinedHolidaySet(
    organizationHolidayCodes,
  );
  const excludedUserIds = new Set<string>(
    Array.isArray(config?.excluded_user_ids)
      ? (config?.excluded_user_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const excludedRepositoryIds = new Set<string>(
    Array.isArray(config?.excluded_repository_ids)
      ? (config?.excluded_repository_ids as string[]).filter(
          (id) => typeof id === "string" && id.trim().length > 0,
        )
      : [],
  );
  const timezone = userTimeSettings.timezone;
  const dateTimeFormat = userTimeSettings.dateTimeFormat;
  const excludedUsersArray = Array.from(excludedUserIds);
  const excludedReposArray = Array.from(excludedRepositoryIds);
  const now = new Date();
  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);
  const reviewerUnassignedPrDays = Math.max(
    1,
    options?.reviewerUnassignedPrDays ?? 2,
  );
  const reviewStalledPrDays = Math.max(1, options?.reviewStalledPrDays ?? 2);
  const mergeDelayedPrDays = Math.max(1, options?.mergeDelayedPrDays ?? 2);

  const [
    reviewerUnassigned,
    reviewStalled,
    mergeDelayed,
    stuckReviews,
    issueInsights,
    mentions,
    organizationMaintainerIds,
  ] = await Promise.all([
    fetchReviewUnassignedPullRequests(
      excludedReposArray,
      excludedUsersArray,
      reviewerUnassignedPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchReviewStalledPullRequests(
      excludedReposArray,
      excludedUsersArray,
      reviewStalledPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchMergeDelayedPullRequests(
      excludedReposArray,
      excludedUsersArray,
      mergeDelayedPrDays,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchStuckReviewRequests(
      excludedReposArray,
      excludedUsersArray,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
    ),
    fetchIssueInsights(
      excludedReposArray,
      excludedUsersArray,
      targetProject,
      now,
      organizationHolidaySet,
    ),
    fetchUnansweredMentions(
      excludedReposArray,
      excludedUsersArray,
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
      targetProject,
      {
        useClassifier: options?.useMentionClassifier ?? true,
      },
    ),
    fetchOrganizationMaintainerIds(),
  ]);

  const reviewStalledExcludedPullRequestIds = new Set<string>();
  reviewerUnassigned.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.id);
  });
  mergeDelayed.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.id);
  });
  stuckReviews.items.forEach((item) => {
    reviewStalledExcludedPullRequestIds.add(item.pullRequest.id);
  });
  if (reviewStalledExcludedPullRequestIds.size > 0) {
    reviewStalled.items = reviewStalled.items.filter(
      (item) => !reviewStalledExcludedPullRequestIds.has(item.id),
    );
    reviewStalled.userIds = new Set<string>();
    reviewStalled.items.forEach((item) => {
      if (item.authorId) {
        reviewStalled.userIds.add(item.authorId);
      }
      item.reviewerIds.forEach((id) => {
        reviewStalled.userIds.add(id);
      });
    });
  }

  const userIdSet = new Set<string>();
  reviewerUnassigned.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  reviewStalled.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  mergeDelayed.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  stuckReviews.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  issueInsights.backlog.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  issueInsights.stalled.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  mentions.userIds.forEach((id) => {
    userIdSet.add(id);
  });
  organizationMaintainerIds.forEach((id) => {
    userIdSet.add(id);
  });

  const userProfiles = userIdSet.size
    ? await getUserProfiles(Array.from(userIdSet))
    : [];
  const userMap = new Map<
    string,
    { id: string; login: string | null; name: string | null }
  >();
  userProfiles.forEach((profile) => {
    const reference = toUserReference(profile);
    if (reference) {
      userMap.set(reference.id, reference);
    }
  });
  const organizationMaintainers = organizationMaintainerIds
    .map((id) => userMap.get(id))
    .filter(
      (
        user,
      ): user is { id: string; login: string | null; name: string | null } =>
        Boolean(user),
    );
  const allRepositoryIds = new Set<string>();
  issueInsights.repositoryMaintainersByRepository.forEach((_ids, repoId) => {
    allRepositoryIds.add(repoId);
  });
  reviewerUnassigned.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  reviewStalled.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  mergeDelayed.items.forEach((item) => {
    if (item.repositoryId) {
      allRepositoryIds.add(item.repositoryId);
    }
  });
  stuckReviews.items.forEach((item) => {
    if (item.pullRequest.repositoryId) {
      allRepositoryIds.add(item.pullRequest.repositoryId);
    }
  });
  const allMaintainersByRepository =
    await fetchRepositoryMaintainersByRepository(Array.from(allRepositoryIds));
  const repositoryMaintainersByRepository: Record<
    string,
    { id: string; login: string | null; name: string | null }[]
  > = {};
  allMaintainersByRepository.forEach((ids, repoId) => {
    const entries = ids
      .map((id) => userMap.get(id))
      .filter(
        (
          user,
        ): user is { id: string; login: string | null; name: string | null } =>
          Boolean(user),
      );
    if (entries.length) {
      repositoryMaintainersByRepository[repoId] = entries;
    }
  });

  const reviewerUnassignedPrs =
    reviewerUnassigned.items.map<PullRequestAttentionItem>((item) => ({
      ...toPullRequestReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }));

  const reviewStalledPrs = reviewStalled.items.map<PullRequestAttentionItem>(
    (item) => ({
      ...toPullRequestReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }),
  );

  const mergeDelayedPrs = mergeDelayed.items.map<PullRequestAttentionItem>(
    (item) => ({
      ...toPullRequestReference(item, userMap),
      assignees: (item.assigneeIds ?? [])
        .map((id) => userMap.get(id))
        .filter(
          (
            user,
          ): user is {
            id: string;
            login: string | null;
            name: string | null;
          } => Boolean(user),
        ),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays,
      waitingDays: item.waitingDays,
    }),
  );

  const stuckReviewRequests =
    stuckReviews.items.map<ReviewRequestAttentionItem>((item) => ({
      id: item.id,
      requestedAt: item.requestedAt,
      waitingDays: item.waitingDays,
      reviewer: item.reviewerId ? (userMap.get(item.reviewerId) ?? null) : null,
      pullRequest: toPullRequestReference(item.pullRequest, userMap),
      pullRequestAgeDays: item.pullRequestAgeDays ?? undefined,
      pullRequestInactivityDays: item.pullRequestInactivityDays,
      pullRequestUpdatedAt: item.pullRequestUpdatedAt,
    }));

  const backlogIssues = issueInsights.backlog.items.map<IssueAttentionItem>(
    (item) => ({
      ...toIssueReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays ?? undefined,
      startedAt: item.startedAt,
      inProgressAgeDays: item.inProgressAgeDays ?? undefined,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }),
  );

  const stalledInProgressIssues =
    issueInsights.stalled.items.map<IssueAttentionItem>((item) => ({
      ...toIssueReference(item, userMap),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      ageDays: item.ageDays,
      inactivityDays: item.inactivityDays ?? undefined,
      startedAt: item.startedAt,
      inProgressAgeDays: item.inProgressAgeDays ?? undefined,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }));

  const unansweredMentions = mentions.items.map<MentionAttentionItem>(
    (item) => ({
      commentId: item.commentId,
      url: item.url,
      mentionedAt: item.mentionedAt,
      waitingDays: item.waitingDays,
      author: item.commentAuthorId
        ? (userMap.get(item.commentAuthorId) ?? null)
        : null,
      target: item.targetUserId
        ? (userMap.get(item.targetUserId) ?? null)
        : null,
      container: {
        type: item.container.type,
        id: item.container.id,
        number: item.container.number,
        title: item.container.title,
        url: item.container.url,
        repository: buildRepositoryReference(
          item.container.repositoryId,
          item.container.repositoryName,
          item.container.repositoryNameWithOwner,
        ),
      },
      commentExcerpt: item.commentExcerpt,
      classification: item.classification
        ? {
            requiresResponse: item.classification.requiresResponse,
            manualRequiresResponse:
              item.classification.manualRequiresResponse ?? null,
            manualRequiresResponseAt:
              item.classification.manualRequiresResponseAt ?? null,
            manualDecisionIsStale:
              item.classification.manualDecisionIsStale ?? false,
            lastEvaluatedAt: item.classification.lastEvaluatedAt ?? null,
          }
        : null,
      issueProjectStatus: item.issueProjectStatus,
      issueProjectStatusSource: item.issueProjectStatusSource,
      issueProjectStatusLocked: item.issueProjectStatusLocked,
      issueTodoProjectStatus: item.issueTodoProjectStatus,
      issueTodoProjectPriority: item.issueTodoProjectPriority,
      issueTodoProjectWeight: item.issueTodoProjectWeight,
      issueTodoProjectInitiationOptions: item.issueTodoProjectInitiationOptions,
      issueTodoProjectStartDate: item.issueTodoProjectStartDate,
    }),
  );

  return {
    generatedAt: now.toISOString(),
    timezone,
    dateTimeFormat,
    reviewerUnassignedPrs,
    reviewStalledPrs,
    mergeDelayedPrs,
    stuckReviewRequests,
    backlogIssues,
    stalledInProgressIssues,
    unansweredMentions,
    organizationMaintainers,
    repositoryMaintainersByRepository,
  } satisfies AttentionInsights;
}

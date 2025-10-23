import type {
  ActivityIssueBaseStatusFilter,
  ActivityStatusFilter,
  IssueProjectStatus,
} from "@/lib/activity/types";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbComment,
  type DbIssue,
  type DbPullRequest,
  type DbReaction,
  type DbRepository,
  type DbReview,
  type DbReviewRequest,
  upsertComment,
  upsertIssue,
  upsertPullRequest,
  upsertReaction,
  upsertRepository,
  upsertReview,
  upsertReviewRequest,
  upsertUser,
} from "@/lib/db/operations";

export async function resetActivityTables() {
  await query(
    `
      TRUNCATE TABLE
        activity_items,
        activity_comment_participants,
        activity_comment_mentions,
        activity_reaction_users,
        activity_issue_status_history,
        activity_issue_project_overrides,
        review_requests,
        reactions,
        comments,
        reviews,
        pull_requests,
        issues,
        repositories,
        users
      RESTART IDENTITY CASCADE
    `,
  );
}

export async function seedActivityUsers(actors: readonly DbActor[]) {
  for (const actor of actors) {
    await upsertUser(actor);
  }
}

export async function seedActivityRepositories(
  repositories: readonly DbRepository[],
) {
  for (const repository of repositories) {
    await upsertRepository(repository);
  }
}

export async function seedActivityIssue(issue: DbIssue) {
  await upsertIssue(issue);
}

export async function seedActivityIssues(issues: readonly DbIssue[]) {
  for (const issue of issues) {
    await seedActivityIssue(issue);
  }
}

export async function seedActivityPullRequest(pullRequest: DbPullRequest) {
  await upsertPullRequest(pullRequest);
}

export async function seedActivityPullRequests(
  pullRequests: readonly DbPullRequest[],
) {
  for (const pullRequest of pullRequests) {
    await seedActivityPullRequest(pullRequest);
  }
}

export async function seedActivityReviews(reviews: readonly DbReview[]) {
  for (const review of reviews) {
    await upsertReview(review);
  }
}

export async function seedActivityComments(comments: readonly DbComment[]) {
  for (const comment of comments) {
    await upsertComment(comment);
  }
}

export async function seedActivityReactions(reactions: readonly DbReaction[]) {
  for (const reaction of reactions) {
    await upsertReaction(reaction);
  }
}

export async function seedActivityReviewRequests(
  reviewRequests: readonly DbReviewRequest[],
) {
  for (const request of reviewRequests) {
    await upsertReviewRequest(request);
  }
}

export async function insertIssueStatusHistory(
  events: {
    issueId: string;
    status: IssueProjectStatus;
    occurredAt?: string;
    source?: "activity" | "todo_project" | string;
  }[],
) {
  if (!events.length) {
    return;
  }

  await query(
    `
      INSERT INTO activity_issue_status_history
        (issue_id, status, occurred_at, source)
      VALUES ${events
        .map(
          (_, index) =>
            `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${
              index * 4 + 4
            })`,
        )
        .join(", ")}
    `,
    events.flatMap((event) => [
      event.issueId,
      event.status,
      event.occurredAt ?? new Date().toISOString(),
      event.source ?? "activity",
    ]),
  );
}

export async function insertIssueProjectOverrides(
  overrides: {
    issueId: string;
    priorityValue?: string | null;
    priorityUpdatedAt?: string | null;
    weightValue?: string | null;
    weightUpdatedAt?: string | null;
    initiationValue?: string | null;
    initiationUpdatedAt?: string | null;
    startDateValue?: string | null;
    startDateUpdatedAt?: string | null;
  }[],
) {
  if (!overrides.length) {
    return;
  }

  await query(
    `
      INSERT INTO activity_issue_project_overrides (
        issue_id,
        priority_value,
        priority_updated_at,
        weight_value,
        weight_updated_at,
        initiation_value,
        initiation_updated_at,
        start_date_value,
        start_date_updated_at,
        updated_at
      )
      VALUES ${overrides
        .map(
          (_, index) =>
            `($${index * 9 + 1}, $${index * 9 + 2}, $${index * 9 + 3}, $${
              index * 9 + 4
            }, $${index * 9 + 5}, $${index * 9 + 6}, $${index * 9 + 7}, $${
              index * 9 + 8
            }, $${index * 9 + 9}, NOW())`,
        )
        .join(", ")}
      ON CONFLICT (issue_id) DO UPDATE SET
        priority_value = EXCLUDED.priority_value,
        priority_updated_at = EXCLUDED.priority_updated_at,
        weight_value = EXCLUDED.weight_value,
        weight_updated_at = EXCLUDED.weight_updated_at,
        initiation_value = EXCLUDED.initiation_value,
        initiation_updated_at = EXCLUDED.initiation_updated_at,
        start_date_value = EXCLUDED.start_date_value,
        start_date_updated_at = EXCLUDED.start_date_updated_at,
        updated_at = NOW()
    `,
    overrides.flatMap((override) => [
      override.issueId,
      override.priorityValue ?? null,
      override.priorityUpdatedAt ?? null,
      override.weightValue ?? null,
      override.weightUpdatedAt ?? null,
      override.initiationValue ?? null,
      override.initiationUpdatedAt ?? null,
      override.startDateValue ?? null,
      override.startDateUpdatedAt ?? null,
    ]),
  );
}

export function toIssueBaseStatus(
  value: string | null | undefined,
): ActivityIssueBaseStatusFilter | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized === "issue_open") {
    return "issue_open";
  }
  if (normalized === "issue_closed") {
    return "issue_closed";
  }
  if (normalized === "open") {
    return "issue_open";
  }
  if (normalized === "closed") {
    return "issue_closed";
  }
  return null;
}

export function toActivityStatus(
  value: string | null | undefined,
): ActivityStatusFilter {
  if (!value) {
    return "open";
  }
  const normalized = value.toLowerCase();
  if (normalized === "closed") {
    return "closed";
  }
  if (normalized === "merged") {
    return "merged";
  }
  return "open";
}

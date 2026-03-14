import type { AttentionSets } from "@/lib/activity/service-builders";
import type { ActivityThresholds, ActivityUser } from "@/lib/activity/types";
import {
  getAttentionInsights,
  type MentionAttentionItem,
  type ReviewRequestAttentionItem,
} from "@/lib/dashboard/attention";
import { query } from "@/lib/db/client";

export type UserReferenceLike = {
  id: string;
  login: string | null;
  name: string | null;
} | null;

export function coerceArray(value: string[] | null | undefined) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function toUserMap(profiles: ActivityUser[]) {
  const map = new Map<string, ActivityUser>();
  profiles.forEach((profile) => {
    map.set(profile.id, profile);
  });
  return map;
}

export function mapUser(id: string | null, users: Map<string, ActivityUser>) {
  if (!id) {
    return null;
  }

  const profile = users.get(id);
  if (profile) {
    return profile;
  }

  return {
    id,
    login: null,
    name: null,
    avatarUrl: null,
  };
}

export function mapUsers(ids: string[], users: Map<string, ActivityUser>) {
  const seen = new Set<string>();
  const result: ActivityUser[] = [];
  ids.forEach((id) => {
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    const user = mapUser(id, users);
    if (user) {
      result.push(user);
    }
  });
  return result;
}

export function mapReferencedUser(
  reference: UserReferenceLike,
  users: Map<string, ActivityUser>,
): ActivityUser | null {
  if (!reference?.id) {
    return null;
  }

  const profile = users.get(reference.id);
  if (profile) {
    return {
      ...profile,
      login: profile.login ?? reference.login,
      name: profile.name ?? reference.name,
    };
  }

  return {
    id: reference.id,
    login: reference.login ?? null,
    name: reference.name ?? null,
    avatarUrl: null,
  };
}

export function dedupeReviewRequestDetails(
  details: ReviewRequestAttentionItem[],
) {
  const byReviewer = new Map<string, ReviewRequestAttentionItem>();
  const fallback = new Map<string, ReviewRequestAttentionItem>();

  details.forEach((detail) => {
    const reviewerId = detail.reviewer?.id?.trim();
    const key = reviewerId && reviewerId.length > 0 ? reviewerId : detail.id;
    const targetMap = reviewerId ? byReviewer : fallback;
    const existing = targetMap.get(key);
    if (!existing || detail.waitingDays > existing.waitingDays) {
      targetMap.set(key, detail);
    }
  });

  return [
    ...byReviewer.values(),
    ...fallback.values().filter((detail) => !byReviewer.has(detail.id)),
  ];
}

export function dedupeMentionDetails(details: MentionAttentionItem[]) {
  const byMention = new Map<string, MentionAttentionItem>();

  details.forEach((detail, index) => {
    const commentKey = detail.commentId?.trim() ?? `comment-${index}`;
    const targetKey = detail.target?.id?.trim();
    const tieBreaker =
      targetKey && targetKey.length > 0
        ? targetKey
        : (detail.mentionedAt?.trim() ?? `unknown-${index}`);
    const key = `${commentKey}::${tieBreaker}`;
    const existing = byMention.get(key);
    if (!existing || detail.waitingDays > existing.waitingDays) {
      byMention.set(key, detail);
    }
  });

  return Array.from(byMention.values());
}

export function toStatus(value: string | null): "open" | "closed" | "merged" {
  if (value === "merged" || value === "closed" || value === "open") {
    return value;
  }

  return "open";
}

export function coerceSearch(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function toRawObject(value: unknown) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
}

export const DEFAULT_THRESHOLDS: Required<ActivityThresholds> = {
  unansweredMentionDays: 2,
  reviewRequestDays: 2,
  backlogIssueDays: 40,
  stalledIssueDays: 20,
  reviewerUnassignedPrDays: 2,
  reviewStalledPrDays: 2,
  mergeDelayedPrDays: 2,
};

export async function resolveAttentionSets(
  thresholds: Required<ActivityThresholds>,
  options?: { userId?: string | null; useMentionClassifier?: boolean },
): Promise<AttentionSets> {
  const insights = await getAttentionInsights({
    userId: options?.userId ?? null,
    useMentionClassifier: options?.useMentionClassifier ?? true,
    reviewerUnassignedPrDays: thresholds.reviewerUnassignedPrDays,
    reviewStalledPrDays: thresholds.reviewStalledPrDays,
    mergeDelayedPrDays: thresholds.mergeDelayedPrDays,
  });
  const unansweredMentions = new Set<string>();
  const reviewRequests = new Set<string>();
  const reviewerUnassignedPullRequests = new Set<string>();
  const reviewStalledPullRequests = new Set<string>();
  const mergeDelayedPullRequests = new Set<string>();
  const backlogIssues = new Set<string>();
  const stalledIssues = new Set<string>();
  const reviewRequestDetails = new Map<string, ReviewRequestAttentionItem[]>();
  const mentionDetails = new Map<string, MentionAttentionItem[]>();

  insights.unansweredMentions.forEach((item) => {
    if (item.waitingDays >= thresholds.unansweredMentionDays) {
      const id = item.container.id;
      if (id) {
        unansweredMentions.add(id);
      }
    }

    const containerId = item.container.id;
    if (containerId) {
      const existing = mentionDetails.get(containerId) ?? [];
      existing.push(item);
      mentionDetails.set(containerId, existing);
    }
  });

  insights.stuckReviewRequests.forEach((item) => {
    if (item.waitingDays >= thresholds.reviewRequestDays) {
      reviewRequests.add(item.pullRequest.id);
    }

    const pullRequestId = item.pullRequest.id;
    const existing = reviewRequestDetails.get(pullRequestId) ?? [];
    existing.push(item);
    reviewRequestDetails.set(pullRequestId, existing);
  });

  insights.reviewerUnassignedPrs.forEach((item) => {
    if ((item.waitingDays ?? 0) >= thresholds.reviewerUnassignedPrDays) {
      reviewerUnassignedPullRequests.add(item.id);
    }
  });

  insights.reviewStalledPrs.forEach((item) => {
    if ((item.waitingDays ?? 0) >= thresholds.reviewStalledPrDays) {
      reviewStalledPullRequests.add(item.id);
    }
  });

  insights.mergeDelayedPrs.forEach((item) => {
    if ((item.waitingDays ?? 0) >= thresholds.mergeDelayedPrDays) {
      mergeDelayedPullRequests.add(item.id);
    }
  });

  insights.backlogIssues.forEach((item) => {
    if (item.ageDays >= thresholds.backlogIssueDays) {
      backlogIssues.add(item.id);
    }
  });

  insights.stalledInProgressIssues.forEach((item) => {
    const inProgressAge = item.inProgressAgeDays ?? 0;
    if (inProgressAge >= thresholds.stalledIssueDays) {
      stalledIssues.add(item.id);
    }
  });

  return {
    unansweredMentions,
    reviewRequests,
    reviewerUnassignedPullRequests,
    reviewStalledPullRequests,
    mergeDelayedPullRequests,
    backlogIssues,
    stalledIssues,
    reviewRequestDetails,
    mentionDetails,
  };
}

export async function fetchRepositoryMaintainers(repositoryIds: string[]) {
  if (!repositoryIds.length) {
    return new Map<string, string[]>();
  }

  const result = await query<{
    repository_id: string;
    maintainer_ids: string[] | null;
  }>(
    `SELECT repository_id,
            ARRAY_AGG(user_id ORDER BY user_id) AS maintainer_ids
       FROM repository_maintainers
      WHERE repository_id = ANY($1::text[])
      GROUP BY repository_id`,
    [repositoryIds],
  );

  const map = new Map<string, string[]>();
  result.rows.forEach((row) => {
    map.set(
      row.repository_id,
      Array.isArray(row.maintainer_ids) ? row.maintainer_ids : [],
    );
  });
  return map;
}

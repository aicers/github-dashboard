export type TableCountKey = "issues" | "pull_requests" | "reviews" | "comments";

export type TableCountSummary = {
  type: TableCountKey;
  count: number;
};

export type RangeSummary = {
  oldest: string | null;
  newest: string | null;
};

export type UserProfile = {
  id: string;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export type RepositoryProfile = {
  id: string;
  name: string | null;
  nameWithOwner: string | null;
  maintainerIds: string[];
};

export type TopUserIssueSummary = {
  authorId: string;
  issueCount: number;
  profile: UserProfile | null;
};

export type TopRepositoryActivitySummary = {
  repositoryId: string;
  issueCount: number;
  pullRequestCount: number;
  repository: RepositoryProfile | null;
};

export type DashboardSummary = {
  counts: TableCountSummary[];
  issuesRange: RangeSummary;
  pullRequestsRange: RangeSummary;
  topUsers: TopUserIssueSummary[];
  topRepositories: TopRepositoryActivitySummary[];
};

export type DbActor = {
  id: string;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  __typename?: string;
};

export type DbRepository = {
  id: string;
  name: string;
  nameWithOwner: string;
  url?: string | null;
  isPrivate?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  ownerId?: string | null;
  raw: unknown;
};

export type DbIssue = {
  id: string;
  number: number;
  repositoryId: string;
  authorId?: string | null;
  title?: string | null;
  state?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  raw: unknown;
};

export type DbPullRequest = {
  id: string;
  number: number;
  repositoryId: string;
  authorId?: string | null;
  title?: string | null;
  state?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  merged?: boolean | null;
  raw: unknown;
};

export type DbPullRequestIssueLink = {
  issueId: string;
  issueNumber?: number | null;
  issueTitle?: string | null;
  issueState?: string | null;
  issueUrl?: string | null;
  issueRepository?: string | null;
};

export type DbReview = {
  id: string;
  pullRequestId: string;
  authorId?: string | null;
  state?: string | null;
  submittedAt?: string | null;
  raw: unknown;
};

export type DbComment = {
  id: string;
  issueId?: string | null;
  pullRequestId?: string | null;
  reviewId?: string | null;
  authorId?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  raw: unknown;
};

export type DbReaction = {
  id: string;
  subjectType: string;
  subjectId: string;
  userId?: string | null;
  content?: string | null;
  createdAt?: string | null;
  raw: unknown;
};

export type DbReviewRequest = {
  id: string;
  pullRequestId: string;
  reviewerId?: string | null;
  requestedAt: string;
  raw: unknown;
};

export type PendingReviewRequest = {
  id: string;
  pullRequestId: string;
  reviewerId: string | null;
  requestedAt: string;
};

export type SyncLogStatus = "success" | "failed" | "running";

export function toJsonb(value: unknown) {
  return JSON.stringify(value ?? null);
}

export type StoredUserProfile = {
  originalAvatarUrl: string | null;
  customAvatarUrl: string | null;
};

export type ParsedUserData = {
  actor: DbActor | null;
  profile: StoredUserProfile;
  raw: Record<string, unknown>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseStoredUserData(raw: unknown): ParsedUserData {
  const rawObject = isPlainObject(raw) ? { ...raw } : {};

  let actor: DbActor | null = null;
  if (rawObject.actor && isPlainObject(rawObject.actor)) {
    actor = rawObject.actor as DbActor;
  } else if ("avatarUrl" in rawObject) {
    const candidate = rawObject as Record<string, unknown>;
    if (
      typeof candidate.avatarUrl === "string" ||
      candidate.avatarUrl === null
    ) {
      actor = candidate as unknown as DbActor;
    }
  }

  const profileSource =
    rawObject.profile && isPlainObject(rawObject.profile)
      ? (rawObject.profile as Record<string, unknown>)
      : {};

  let originalAvatarUrl: string | null = null;
  if (typeof profileSource.originalAvatarUrl === "string") {
    originalAvatarUrl = profileSource.originalAvatarUrl;
  } else if (profileSource.originalAvatarUrl === null) {
    originalAvatarUrl = null;
  }

  if (!originalAvatarUrl && actor?.avatarUrl) {
    originalAvatarUrl = actor.avatarUrl;
  }

  const customAvatarUrl =
    typeof profileSource.customAvatarUrl === "string"
      ? profileSource.customAvatarUrl
      : null;

  return {
    actor,
    profile: {
      originalAvatarUrl: originalAvatarUrl ?? null,
      customAvatarUrl,
    },
    raw: rawObject,
  };
}

export function buildStoredUserData(
  actor: DbActor | null,
  profile: StoredUserProfile,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  delete next.profile;

  if (actor) {
    Object.assign(next, actor as Record<string, unknown>);
    next.actor = actor;
  } else {
    delete next.actor;
  }

  next.profile = {
    originalAvatarUrl: profile.originalAvatarUrl ?? null,
    customAvatarUrl: profile.customAvatarUrl ?? null,
  };

  return next;
}

export function toIsoString(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return value;
}

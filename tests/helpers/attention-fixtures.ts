import type {
  DbActor,
  DbPullRequest,
  DbRepository,
  DbReview,
  DbReviewRequest,
} from "@/lib/db/operations";

export function buildActor(id: string, login: string, name?: string): DbActor {
  return {
    id,
    login,
    name: name ?? login,
    avatarUrl: null,
    createdAt: "2023-01-01T00:00:00.000Z",
    updatedAt: "2023-01-01T00:00:00.000Z",
  } satisfies DbActor;
}

export function buildRepository(
  id: string,
  name: string,
  ownerId: string,
  ownerLogin: string,
): DbRepository {
  const owner = ownerLogin ?? "owner";
  return {
    id,
    name,
    nameWithOwner: `${owner}/${name}`,
    ownerId,
    raw: {
      id,
      name,
      nameWithOwner: `${owner}/${name}`,
    },
  } satisfies DbRepository;
}

export function buildPullRequest(params: {
  id: string;
  number: number;
  repository: DbRepository;
  authorId: string | null;
  title: string;
  url: string;
  state?: string;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string | null;
  mergedAt?: string | null;
  merged?: boolean;
}): DbPullRequest {
  const {
    id,
    number,
    repository,
    authorId,
    title,
    url,
    state,
    createdAt,
    updatedAt,
    closedAt,
    mergedAt,
    merged,
  } = params;

  return {
    id,
    number,
    repositoryId: repository.id,
    authorId,
    title,
    state: state ?? "OPEN",
    merged: merged ?? false,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
    closedAt: closedAt ?? null,
    mergedAt: mergedAt ?? null,
    raw: {
      id,
      url,
      title,
      author: authorId ? { id: authorId } : null,
      repository: {
        id: repository.id,
        name: repository.name,
        nameWithOwner: repository.nameWithOwner,
      },
    },
  } satisfies DbPullRequest;
}

export function buildReviewRequest(params: {
  id: string;
  pullRequestId: string;
  reviewerId: string | null;
  requestedAt: string;
}): DbReviewRequest {
  const { id, pullRequestId, reviewerId, requestedAt } = params;
  return {
    id,
    pullRequestId,
    reviewerId,
    requestedAt,
    raw: {
      id,
      pullRequestId,
      reviewerId,
      requestedAt,
    },
  } satisfies DbReviewRequest;
}

export function buildReview(params: {
  id: string;
  pullRequestId: string;
  authorId: string | null;
  submittedAt: string | null;
  state?: string;
}): DbReview {
  const { id, pullRequestId, authorId, submittedAt, state } = params;
  return {
    id,
    pullRequestId,
    authorId,
    submittedAt,
    state: state ?? "COMMENTED",
    raw: {
      id,
      pullRequestId,
      authorId,
      submittedAt,
      state: state ?? "COMMENTED",
    },
  } satisfies DbReview;
}

export function businessDaysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid ISO timestamp input");
  }

  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const endUtc = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
  );

  let count = 0;
  while (cursor < endUtc) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

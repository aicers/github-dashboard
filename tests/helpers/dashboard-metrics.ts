import { waitForPendingActivityCacheRefresh } from "@/lib/activity/cache";
import { query } from "@/lib/db/client";
import {
  type DbActor,
  type DbRepository,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

export const CURRENT_RANGE_START = "2024-01-01T00:00:00.000Z";
export const CURRENT_RANGE_END = "2024-01-07T23:59:59.999Z";

export const PERIOD_KEYS = [
  "previous4",
  "previous3",
  "previous2",
  "previous",
  "current",
] as const;

export type PeriodKey = (typeof PERIOD_KEYS)[number];

export type PeriodRange = {
  start: string;
  end: string;
};

export type PeriodMap = Record<PeriodKey, PeriodRange>;

export function buildPeriodRanges(startIso: string, endIso: string): PeriodMap {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("Invalid period range inputs");
  }
  if (endMs < startMs) {
    throw new Error("End must be after start");
  }

  const durationMs = Math.max(0, endMs - startMs);

  const ranges: Partial<Record<PeriodKey, PeriodRange>> = {};

  const currentStart = startMs;
  const currentEnd = endMs;
  ranges.current = {
    start: new Date(currentStart).toISOString(),
    end: new Date(currentEnd).toISOString(),
  };

  let previousEnd = currentStart - 1;
  let previousStart = previousEnd - durationMs;
  (["previous", "previous2", "previous3", "previous4"] as const).forEach(
    (key) => {
      ranges[key] = {
        start: new Date(previousStart).toISOString(),
        end: new Date(previousEnd).toISOString(),
      };
      previousEnd = previousStart - 1;
      previousStart = previousEnd - durationMs;
    },
  );

  return ranges as PeriodMap;
}

export async function resetDashboardTables() {
  await waitForPendingActivityCacheRefresh();
  await query(
    "TRUNCATE TABLE issues, pull_requests, reviews, comments, reactions, review_requests, repositories, users, unanswered_mention_classifications RESTART IDENTITY CASCADE",
  );
}

export async function resetDashboardAndSyncTables() {
  await resetDashboardTables();
  await query("TRUNCATE TABLE sync_log, sync_state RESTART IDENTITY CASCADE");
}

export async function seedPersonAndRepo() {
  const actor: DbActor = {
    id: "person-actor",
    login: "person-actor",
    name: "Person Actor",
    createdAt: CURRENT_RANGE_START,
    updatedAt: CURRENT_RANGE_START,
  };
  await upsertUser(actor);

  const repository: DbRepository = {
    id: "person-repo",
    name: "person-repo",
    nameWithOwner: "octo/person-repo",
    ownerId: actor.id,
    raw: { id: "person-repo" },
  };
  await upsertRepository(repository);

  return { actor, repository };
}

export async function seedActors(actors: readonly DbActor[]) {
  for (const actor of actors) {
    await upsertUser(actor);
  }
}

export async function seedRepositories(repositories: readonly DbRepository[]) {
  for (const repository of repositories) {
    await upsertRepository(repository);
  }
}

export function shiftHours(baseIso: string, hours: number) {
  const base = new Date(baseIso);
  const time = base.getTime();
  if (Number.isNaN(time)) {
    throw new Error(`Invalid ISO timestamp: ${baseIso}`);
  }
  const adjusted = time + hours * 3_600_000;
  return new Date(adjusted).toISOString();
}

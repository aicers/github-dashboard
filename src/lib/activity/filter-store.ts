import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  type ActivityFilterPayload,
  activityFilterPayloadSchema,
} from "@/lib/activity/filter-schema";
import type { ActivitySavedFilter } from "@/lib/activity/types";
import { query, withTransaction } from "@/lib/db/client";
import { env } from "@/lib/env";

export const SAVED_FILTER_LIMIT = env.ACTIVITY_SAVED_FILTER_LIMIT;

type ActivitySavedFilterRow = {
  id: string;
  user_id: string;
  name: string;
  payload: unknown;
  created_at: string;
  updated_at: string;
};

function toIsoString(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp value.");
  }
  return date.toISOString();
}

function normalizeExpectedTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function mapRow(row: ActivitySavedFilterRow): ActivitySavedFilter {
  const payload = activityFilterPayloadSchema.parse(
    row.payload ?? {},
  ) as ActivityFilterPayload;

  return {
    id: row.id,
    name: row.name,
    payload,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function fetchFilterForUpdate(
  client: PoolClient,
  userId: string,
  filterId: string,
) {
  const result = await client.query<ActivitySavedFilterRow>(
    `SELECT id, user_id, name, payload, created_at, updated_at
     FROM activity_saved_filters
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [filterId, userId],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export class ActivitySavedFilterLimitError extends Error {
  readonly limit = SAVED_FILTER_LIMIT;
  constructor() {
    super("Saved filter limit reached.");
    this.name = "ActivitySavedFilterLimitError";
  }
}

export type UpdateSavedFilterResult =
  | { status: "not_found" }
  | { status: "conflict"; filter: ActivitySavedFilter }
  | { status: "ok"; filter: ActivitySavedFilter };

export type DeleteSavedFilterResult =
  | { status: "not_found" }
  | { status: "conflict"; filter: ActivitySavedFilter }
  | { status: "deleted"; filter: ActivitySavedFilter };

export async function listSavedFilters(
  userId: string,
): Promise<ActivitySavedFilter[]> {
  const result = await query<ActivitySavedFilterRow>(
    `SELECT id, user_id, name, payload, created_at, updated_at
     FROM activity_saved_filters
     WHERE user_id = $1
     ORDER BY updated_at DESC, created_at DESC`,
    [userId],
  );

  return result.rows.map(mapRow);
}

export async function getSavedFilter(
  userId: string,
  filterId: string,
): Promise<ActivitySavedFilter | null> {
  const result = await query<ActivitySavedFilterRow>(
    `SELECT id, user_id, name, payload, created_at, updated_at
     FROM activity_saved_filters
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [filterId, userId],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export async function createSavedFilter(
  userId: string,
  name: string,
  payload: ActivityFilterPayload,
): Promise<ActivitySavedFilter> {
  const normalizedName = name.trim();
  if (!normalizedName.length) {
    throw new Error("Filter name is required.");
  }

  const sanitizedPayload = activityFilterPayloadSchema.parse(
    payload,
  ) as ActivityFilterPayload;

  return withTransaction(async (client) => {
    const countResult = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM activity_saved_filters
       WHERE user_id = $1`,
      [userId],
    );

    const count = countResult.rows[0]?.count ?? 0;
    if (count >= SAVED_FILTER_LIMIT) {
      throw new ActivitySavedFilterLimitError();
    }

    const id = randomUUID();
    const insertResult = await client.query<ActivitySavedFilterRow>(
      `INSERT INTO activity_saved_filters (id, user_id, name, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, user_id, name, payload, created_at, updated_at`,
      [id, userId, normalizedName, JSON.stringify(sanitizedPayload)],
    );

    return mapRow(insertResult.rows[0]);
  });
}

export async function updateSavedFilter(
  userId: string,
  filterId: string,
  options: {
    name?: string;
    payload?: ActivityFilterPayload;
    expectedUpdatedAt?: string | null;
  },
): Promise<UpdateSavedFilterResult> {
  return withTransaction(async (client) => {
    const existing = await fetchFilterForUpdate(client, userId, filterId);
    if (!existing) {
      return { status: "not_found" };
    }

    const expected = normalizeExpectedTimestamp(options.expectedUpdatedAt);
    if (expected && expected !== existing.updatedAt) {
      return { status: "conflict", filter: existing };
    }

    const nextName =
      options.name !== undefined ? options.name.trim() : existing.name;
    if (options.name !== undefined && !nextName.length) {
      throw new Error("Filter name is required.");
    }

    const nextPayload =
      options.payload !== undefined
        ? (activityFilterPayloadSchema.parse(
            options.payload,
          ) as ActivityFilterPayload)
        : existing.payload;

    if (options.name === undefined && options.payload === undefined) {
      return { status: "ok", filter: existing };
    }

    const updateResult = await client.query<ActivitySavedFilterRow>(
      `UPDATE activity_saved_filters
       SET name = $3,
           payload = $4::jsonb,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, name, payload, created_at, updated_at`,
      [filterId, userId, nextName, JSON.stringify(nextPayload)],
    );

    const updated = mapRow(updateResult.rows[0]);
    return { status: "ok", filter: updated };
  });
}

export async function deleteSavedFilter(
  userId: string,
  filterId: string,
  options: { expectedUpdatedAt?: string | null } = {},
): Promise<DeleteSavedFilterResult> {
  return withTransaction(async (client) => {
    const existing = await fetchFilterForUpdate(client, userId, filterId);
    if (!existing) {
      return { status: "not_found" };
    }

    const expected = normalizeExpectedTimestamp(options.expectedUpdatedAt);
    if (expected && expected !== existing.updatedAt) {
      return { status: "conflict", filter: existing };
    }

    await client.query(
      `DELETE FROM activity_saved_filters WHERE id = $1 AND user_id = $2`,
      [filterId, userId],
    );

    return { status: "deleted", filter: existing };
  });
}

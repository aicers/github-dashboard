// @vitest-environment node

import "../../../../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activityFilterPayloadSchema } from "@/lib/activity/filter-schema";
import {
  createSavedFilter,
  getSavedFilter,
  updateSavedFilter,
} from "@/lib/activity/filter-store";
import { readActiveSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import type { DbActor } from "@/lib/db/operations";
import { upsertUser } from "@/lib/db/operations";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

type RouteHandlers = typeof import("./route");

let handlers: RouteHandlers;

const START_TIME = new Date("2024-01-01T00:00:00.000Z");

async function resetDatabaseState() {
  await ensureSchema();
  await query("TRUNCATE TABLE activity_saved_filters RESTART IDENTITY CASCADE");
  await query(
    "TRUNCATE TABLE users, user_preferences RESTART IDENTITY CASCADE",
  );
}

async function seedUser(id: string) {
  const actor: DbActor = {
    id,
    login: id,
    name: `${id} name`,
    avatarUrl: null,
    createdAt: START_TIME.toISOString(),
    updatedAt: START_TIME.toISOString(),
  };

  await upsertUser(actor);
}

async function createFilterForUser(
  userId: string,
  name: string,
  payload: unknown = {},
) {
  const parsed = activityFilterPayloadSchema.parse(payload);
  return createSavedFilter(userId, name, parsed);
}

describe("activity saved filters routes (detail)", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await resetDatabaseState();
    await seedUser("user-1");

    vi.mocked(readActiveSession).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: true,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      refreshExpiresAt: new Date(Date.now() + 60_000),
      maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      lastReauthAt: new Date(),
      deviceId: "device-1",
      ipCountry: "KR",
    });

    handlers = await import("./route");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("updates filter name and payload with optimistic concurrency", async () => {
    const filter = await createFilterForUser("user-1", "Original", {
      perPage: 25,
      repositoryIds: ["repo-1"],
    });

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/filters/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Renamed filter",
          payload: {
            perPage: 10,
            repositoryIds: ["repo-2"],
            search: " urgent ",
          },
          expected: {
            updatedAt: filter.updatedAt,
          },
        }),
      }),
      { params: Promise.resolve({ id: filter.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      filter: {
        name: string;
        payload: {
          perPage?: number;
          repositoryIds?: string[];
          search?: string;
        };
        updatedAt: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.filter.name).toBe("Renamed filter");
    expect(body.filter.payload.perPage).toBe(10);
    expect(body.filter.payload.repositoryIds).toEqual(["repo-2"]);
    expect(body.filter.payload.search).toBe("urgent");

    const stored = await getSavedFilter("user-1", filter.id);
    expect(stored?.name).toBe("Renamed filter");
    expect(stored?.payload.repositoryIds).toEqual(["repo-2"]);
  });

  it("returns 409 when update payload is stale", async () => {
    const filter = await createFilterForUser("user-1", "Concurrent", {
      perPage: 25,
    });

    await updateSavedFilter("user-1", filter.id, {
      name: "Server-updated",
    });

    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/filters/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Client update",
          expected: {
            updatedAt: filter.updatedAt,
          },
        }),
      }),
      { params: Promise.resolve({ id: filter.id }) },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      success: boolean;
      message: string;
      filter: { name: string; updatedAt: string };
    };
    expect(body.success).toBe(false);
    expect(body.message).toContain("이미 변경되었어요");
    expect(body.filter.name).toBe("Server-updated");
  });

  it("returns 404 when filter does not exist", async () => {
    const response = await handlers.PATCH(
      new Request("http://localhost/api/activity/filters/missing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Does not matter",
          expected: {
            updatedAt: new Date().toISOString(),
          },
        }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain("찾을 수 없어요");
  });

  it("deletes a filter when expected timestamp matches", async () => {
    const filter = await createFilterForUser("user-1", "Remove me", {});

    const response = await handlers.DELETE(
      new Request("http://localhost/api/activity/filters/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected: { updatedAt: filter.updatedAt },
        }),
      }),
      { params: Promise.resolve({ id: filter.id }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      filter: { id: string };
    };
    expect(body.success).toBe(true);
    expect(body.filter.id).toBe(filter.id);

    const stored = await getSavedFilter("user-1", filter.id);
    expect(stored).toBeNull();
  });

  it("returns 409 when delete request is stale", async () => {
    const filter = await createFilterForUser("user-1", "Keep me", {});

    await updateSavedFilter("user-1", filter.id, {
      name: "Updated name",
    });

    const response = await handlers.DELETE(
      new Request("http://localhost/api/activity/filters/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expected: { updatedAt: filter.updatedAt },
        }),
      }),
      { params: Promise.resolve({ id: filter.id }) },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      success: boolean;
      message: string;
      filter: { name: string };
    };
    expect(body.success).toBe(false);
    expect(body.message).toContain("이미 변경되었어요");
    expect(body.filter.name).toBe("Updated name");

    const stored = await getSavedFilter("user-1", filter.id);
    expect(stored?.name).toBe("Updated name");
  });
});

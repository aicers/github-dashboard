// @vitest-environment node

import "../../../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAVED_FILTER_LIMIT } from "@/lib/activity/filter-store";
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

describe("activity saved filters routes (collection)", () => {
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
    });

    handlers = await import("./route");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns empty list when no filters are saved", async () => {
    const response = await handlers.GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      filters: unknown[];
      limit: number;
    };
    expect(body.success).toBe(true);
    expect(body.filters).toEqual([]);
    expect(body.limit).toBe(SAVED_FILTER_LIMIT);
  });

  it("creates a new saved filter and returns normalized payload", async () => {
    const createResponse = await handlers.POST(
      new Request("http://localhost/api/activity/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "  My Filter  ",
          payload: {
            perPage: 50,
            types: ["issue", "issue", "pull_request"],
            repositoryIds: [" repo-1 ", "repo-1", "repo-2"],
            search: "   needs-triage   ",
            thresholds: {
              stalePrDays: "10",
              idlePrDays: 5,
            },
          },
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const createBody = (await createResponse.json()) as {
      success: boolean;
      filter: {
        id: string;
        name: string;
        payload: {
          perPage?: number;
          types?: string[];
          repositoryIds?: string[];
          search?: string;
          thresholds?: Record<string, number>;
        };
        createdAt: string;
        updatedAt: string;
      };
      limit: number;
    };

    expect(createBody.success).toBe(true);
    expect(createBody.filter.name).toBe("My Filter");
    expect(createBody.filter.payload.perPage).toBe(50);
    expect(createBody.filter.payload.types).toEqual(["issue", "pull_request"]);
    expect(createBody.filter.payload.repositoryIds).toEqual([
      "repo-1",
      "repo-2",
    ]);
    expect(createBody.filter.payload.search).toBe("needs-triage");
    expect(createBody.filter.payload.thresholds).toEqual({
      stalePrDays: 10,
      idlePrDays: 5,
    });
    expect(createBody.limit).toBe(SAVED_FILTER_LIMIT);

    const listResponse = await handlers.GET();
    const listBody = (await listResponse.json()) as {
      success: boolean;
      filters: Array<{ id: string; name: string }>;
    };
    expect(listBody.filters).toHaveLength(1);
    expect(listBody.filters[0]?.id).toBe(createBody.filter.id);
  });

  it("rejects creation when the saved filter limit is reached", async () => {
    for (let index = 0; index < SAVED_FILTER_LIMIT; index += 1) {
      const response = await handlers.POST(
        new Request("http://localhost/api/activity/filters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: `Filter ${index + 1}`,
            payload: {
              perPage: 25,
            },
          }),
        }),
      );
      expect(response.status).toBe(201);
    }

    const overflowResponse = await handlers.POST(
      new Request("http://localhost/api/activity/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Filter ${SAVED_FILTER_LIMIT + 1}`,
          payload: {
            perPage: 25,
          },
        }),
      }),
    );

    expect(overflowResponse.status).toBe(400);
    const body = (await overflowResponse.json()) as {
      success: boolean;
      message: string;
    };
    expect(body.success).toBe(false);
    expect(body.message).toContain(`최대 ${SAVED_FILTER_LIMIT}개`);
  });

  it("returns 401 when session is missing", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce(null);

    const response = await handlers.GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Authentication required.");
  });
});

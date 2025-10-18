// @vitest-environment node

import "../../../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readActiveSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import type { DbActor, DbRepository } from "@/lib/db/operations";
import {
  getSyncConfig,
  listAllRepositories,
  listAllUsers,
  updateSyncConfig,
  upsertRepository,
  upsertUser,
} from "@/lib/db/operations";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

type RouteHandlers = typeof import("./route");

let handlers: RouteHandlers;

const START_TIME = new Date("2024-06-01T00:00:00.000Z");

async function resetDatabaseState() {
  await ensureSchema();
  await query(
    "TRUNCATE TABLE users, repositories, sync_log, sync_state RESTART IDENTITY CASCADE",
  );
  await query(
    `UPDATE sync_config
     SET org_name = 'seed-org',
         auto_sync_enabled = FALSE,
         sync_interval_minutes = 60,
         timezone = 'UTC',
         week_start = 'monday',
         excluded_repository_ids = '{}',
         excluded_user_ids = '{}',
         allowed_team_slugs = '{}',
         allowed_user_ids = '{}',
         date_time_format = 'auto',
         last_sync_started_at = NULL,
         last_sync_completed_at = NULL,
         last_successful_sync_at = NULL,
         updated_at = NOW()
     WHERE id = 'default'`,
  );
}

async function seedRepository(id: string, ownerId: string) {
  const repository: DbRepository = {
    id,
    name: id,
    nameWithOwner: `acme/${id}`,
    ownerId,
    raw: { id },
    createdAt: START_TIME.toISOString(),
    updatedAt: START_TIME.toISOString(),
  };
  await upsertRepository(repository);
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

describe("sync config API routes", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await resetDatabaseState();
    vi.mocked(readActiveSession).mockResolvedValue({
      id: "session",
      userId: "user",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: true,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(),
    });
    handlers = await import("./route");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("updates sync configuration fields and normalizes payload values", async () => {
    await seedUser("user-1");
    await seedUser("user-2");
    await seedRepository("repo-1", "user-1");
    await seedRepository("repo-2", "user-1");

    await query(
      "UPDATE sync_config SET auto_sync_enabled = TRUE WHERE id = 'default'",
    );

    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: "  new-org  ",
          syncIntervalMinutes: 24,
          timezone: "Asia/Seoul",
          weekStart: "sunday",
          dateTimeFormat: "en-gb-24h",
          excludedRepositories: [" repo-1 ", "repo-2", "repo-1"],
          excludedPeople: [" user-1 ", "user-2", "user-1"],
          allowedTeams: [" team-alpha ", "team-beta", "team-alpha"],
          allowedUsers: [" user-3 ", "user-3", "user-4 "],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      status: {
        config: Awaited<ReturnType<typeof getSyncConfig>>;
      };
    };

    expect(body.success).toBe(true);
    expect(body.status.config?.org_name).toBe("new-org");

    const config = await getSyncConfig();
    expect(config?.org_name).toBe("new-org");
    expect(config?.sync_interval_minutes).toBe(24);
    expect(config?.timezone).toBe("Asia/Seoul");
    expect(config?.week_start).toBe("sunday");
    expect(config?.date_time_format).toBe("en-gb-24h");
    expect(config?.excluded_repository_ids).toEqual(["repo-1", "repo-2"]);
    expect(config?.excluded_user_ids).toEqual(["user-1", "user-2"]);
    expect(config?.allowed_team_slugs).toEqual(["team-alpha", "team-beta"]);
    expect(config?.allowed_user_ids).toEqual(["user-3", "user-4"]);

    const intervalCall = setIntervalSpy.mock.calls[0];
    expect(intervalCall?.[1]).toBe(24 * 60 * 1000);

    const repositories = await listAllRepositories();
    expect(repositories.map((repo) => repo.id)).toEqual(["repo-1", "repo-2"]);

    const users = await listAllUsers();
    expect(users.map((user) => user.id)).toEqual(["user-1", "user-2"]);
  });

  it("rejects organization control updates from non-admin users", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      id: "session",
      userId: "user",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(),
    });

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: "unauthorized-update",
          excludedRepositories: ["repo-1"],
        }),
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe(
      "Administrator access is required to update organization controls.",
    );

    const config = await getSyncConfig();
    expect(config?.org_name).toBe("seed-org");
    expect(config?.excluded_repository_ids).toEqual([]);
  });

  it("allows non-admin users to update personal configuration", async () => {
    vi.mocked(readActiveSession).mockResolvedValueOnce({
      id: "session",
      userId: "user",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(),
    });

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: "Europe/London",
          weekStart: "sunday",
          dateTimeFormat: "dot-24h",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const config = await getSyncConfig();
    expect(config?.timezone).toBe("Europe/London");
    expect(config?.week_start).toBe("sunday");
    expect(config?.date_time_format).toBe("dot-24h");
    expect(config?.org_name).toBe("seed-org");
  });

  it("rejects invalid sync interval updates and leaves persisted state unchanged", async () => {
    await query(
      "UPDATE sync_config SET auto_sync_enabled = TRUE WHERE id = 'default'",
    );

    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncIntervalMinutes: 0,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Invalid request payload.");

    const config = await getSyncConfig();
    expect(config?.sync_interval_minutes).toBe(60);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid timezone identifiers", async () => {
    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: "Not/AZone",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Invalid timezone identifier.");

    const config = await getSyncConfig();
    expect(config?.timezone).toBe("UTC");
  });

  it("rejects empty organization names", async () => {
    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: "   ",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Organization name cannot be empty.");

    const config = await getSyncConfig();
    expect(config?.org_name).toBe("seed-org");
  });

  it("does not schedule automatic sync when auto sync is disabled", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncIntervalMinutes: 90,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const config = await getSyncConfig();
    expect(config?.sync_interval_minutes).toBe(90);
    expect(config?.auto_sync_enabled).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("returns the current sync status payload", async () => {
    await updateSyncConfig({
      orgName: "acme-inc",
      syncIntervalMinutes: 42,
      timezone: "Europe/London",
      weekStart: "sunday",
      excludedRepositories: ["repo-1"],
      excludedUsers: ["user-1"],
      dateTimeFormat: "en-us-12h",
    });

    const response = await handlers.GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.status.config?.org_name).toBe("acme-inc");
    expect(body.status.config?.sync_interval_minutes).toBe(42);
    expect(body.status.config?.timezone).toBe("Europe/London");
    expect(body.status.config?.week_start).toBe("sunday");
    expect(body.status.config?.excluded_repository_ids).toEqual(["repo-1"]);
    expect(body.status.config?.excluded_user_ids).toEqual(["user-1"]);
    expect(body.status.config?.date_time_format).toBe("en-us-12h");
  });
});

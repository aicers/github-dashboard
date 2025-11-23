// @vitest-environment node

import "../../../../../tests/helpers/postgres-container";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readActiveSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import type { DbActor, DbRepository } from "@/lib/db/operations";
import {
  getSyncConfig,
  getUserPreferences,
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
    "TRUNCATE TABLE repository_maintainers, users, user_preferences, repositories, sync_log, sync_state, db_backups RESTART IDENTITY CASCADE",
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
         backup_enabled = TRUE,
         backup_hour_local = 2,
         backup_timezone = 'UTC',
         backup_last_started_at = NULL,
         backup_last_completed_at = NULL,
         backup_last_status = 'idle',
         backup_last_error = NULL,
         transfer_sync_hour_local = 4,
         transfer_sync_minute_local = 0,
         transfer_sync_timezone = 'UTC',
         transfer_sync_last_started_at = NULL,
         transfer_sync_last_completed_at = NULL,
         transfer_sync_last_status = 'idle',
         transfer_sync_last_error = NULL,
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
    await seedUser("user");
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
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

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
          backupHour: 4,
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
    expect(config?.timezone).toBe("UTC");
    expect(config?.week_start).toBe("monday");
    expect(config?.date_time_format).toBe("auto");
    expect(config?.excluded_repository_ids).toEqual(["repo-1", "repo-2"]);
    expect(config?.excluded_user_ids).toEqual(["user-1", "user-2"]);
    expect(config?.allowed_team_slugs).toEqual(["team-alpha", "team-beta"]);
    expect(config?.allowed_user_ids).toEqual(["user-3", "user-4"]);
    expect(config?.backup_hour_local).toBe(4);
    expect(config?.backup_timezone).toBe("Asia/Seoul");

    const preferences = await getUserPreferences("user");
    expect(preferences?.timezone).toBe("Asia/Seoul");
    expect(preferences?.weekStart).toBe("sunday");
    expect(preferences?.dateTimeFormat).toBe("en-gb-24h");
    expect(preferences?.activityRowsPerPage).toBe(25);

    await Promise.resolve();
    await Promise.resolve();

    const getSchedulerCalls = () =>
      setTimeoutSpy.mock.calls.filter(
        (call) =>
          typeof call?.[0] === "function" &&
          call[0]?.toString().includes("runIncrementalSync"),
      ) as Array<[TimerHandler, number?, ...unknown[]]>;

    const initialSchedulerCalls = getSchedulerCalls();
    const firstTimeout = initialSchedulerCalls[0];
    expect(firstTimeout?.[1]).toBe(0);

    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    const scheduler = (
      globalThis as {
        __githubDashboardScheduler?: {
          intervalMs: number | null;
          isEnabled: boolean;
        };
      }
    ).__githubDashboardScheduler;
    expect(scheduler?.intervalMs).toBe(24 * 60 * 1000);
    expect(scheduler?.isEnabled).toBe(true);

    const repositories = await listAllRepositories();
    expect(repositories.map((repo) => repo.id)).toEqual(["repo-1", "repo-2"]);

    const users = await listAllUsers();
    expect(users.map((user) => user.id)).toEqual(["user", "user-1", "user-2"]);
  });

  it("updates repository maintainers when requested by an admin user", async () => {
    await seedRepository("repo-1", "user");
    await seedRepository("repo-2", "user");
    await seedRepository("repo-3", "user");
    await seedUser("maintainer-1");
    await seedUser("maintainer-2");

    const response = await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryMaintainers: {
            "repo-1": [" maintainer-2 ", "maintainer-1", "missing"],
            "repo-2": [],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);

    const repositoriesAfter = await listAllRepositories();
    const repo1 = repositoriesAfter.find((repo) => repo.id === "repo-1");
    const repo2 = repositoriesAfter.find((repo) => repo.id === "repo-2");
    const repo3 = repositoriesAfter.find((repo) => repo.id === "repo-3");

    expect(repo1).toBeDefined();
    expect(repo2).toBeDefined();
    expect(repo3).toBeDefined();
    expect(repo1?.maintainerIds).toEqual(["maintainer-1", "maintainer-2"]);
    expect(repo2?.maintainerIds).toEqual([]);
    expect(repo3?.maintainerIds).toEqual([]);
  });

  it("allows clearing repository maintainer assignments on subsequent updates", async () => {
    await seedRepository("repo-1", "user");
    await seedUser("maintainer-1");
    await seedUser("maintainer-2");

    await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryMaintainers: {
            "repo-1": ["maintainer-1", "maintainer-2"],
          },
        }),
      }),
    );

    let repositories = await listAllRepositories();
    expect(
      repositories.find((repo) => repo.id === "repo-1")?.maintainerIds,
    ).toEqual(["maintainer-1", "maintainer-2"]);

    await handlers.PATCH(
      new Request("http://localhost/api/sync/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryMaintainers: {
            "repo-1": [],
          },
        }),
      }),
    );

    repositories = await listAllRepositories();
    expect(
      repositories.find((repo) => repo.id === "repo-1")?.maintainerIds,
    ).toEqual([]);
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
          repositoryMaintainers: { "repo-1": ["user-1"] },
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
          activityRowsPerPage: 40,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const preferences = await getUserPreferences("user");
    expect(preferences?.timezone).toBe("Europe/London");
    expect(preferences?.weekStart).toBe("sunday");
    expect(preferences?.dateTimeFormat).toBe("dot-24h");
    expect(preferences?.activityRowsPerPage).toBe(40);

    const config = await getSyncConfig();
    expect(config?.timezone).toBe("UTC");
    expect(config?.week_start).toBe("monday");
    expect(config?.date_time_format).toBe("auto");
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

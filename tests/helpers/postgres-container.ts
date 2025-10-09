import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll } from "vitest";

import { closePool } from "@/lib/db/client";
import { ensureSchema } from "@/lib/db/schema";
import { env } from "@/lib/env";

let container: StartedPostgreSqlContainer | null = null;

beforeAll(async () => {
  try {
    container = await new PostgreSqlContainer("postgres:16").start();
  } catch (error) {
    const hint =
      "PostgreSQL Testcontainer failed to start. Ensure Docker/Colima is running and accessible.";
    if (error instanceof Error) {
      error.message = `${hint}\n${error.message}`;
      throw error;
    }

    throw new Error(hint);
  }

  process.env.DATABASE_URL = container.getConnectionUri();
  env.DATABASE_URL = process.env.DATABASE_URL;
  await ensureSchema();
  await warmupDashboardAnalytics();
}, 60_000);

afterAll(async () => {
  await closePool();

  if (container) {
    await container.stop();
    container = null;
  }
});

async function warmupDashboardAnalytics() {
  try {
    const [
      { resetDashboardTables, CURRENT_RANGE_START, CURRENT_RANGE_END },
      { getDashboardAnalytics },
    ] = await Promise.all([
      import("./dashboard-metrics"),
      import("@/lib/dashboard/analytics"),
    ]);

    await resetDashboardTables();
    await getDashboardAnalytics({
      start: CURRENT_RANGE_START,
      end: CURRENT_RANGE_END,
    });
    await resetDashboardTables();
  } catch (error) {
    console.warn(
      "[tests] Failed to warm up dashboard analytics before DB tests:",
      error,
    );
  }
}

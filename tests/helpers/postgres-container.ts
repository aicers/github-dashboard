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
}, 60_000);

afterAll(async () => {
  await closePool();

  if (container) {
    await container.stop();
    container = null;
  }
});

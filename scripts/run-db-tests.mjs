#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

async function canStartTestcontainer() {
  const explicitUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
  if (explicitUrl) {
    return true;
  }

  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  try {
    const container = await new PostgreSqlContainer("postgres:16")
      .withReuse()
      .start();
    await container.stop();
    return true;
  } catch (error) {
    const hint =
      "[test:db] Skipping database-backed tests: PostgreSQL container unavailable.";
    const detail =
      error instanceof Error ? error.message : JSON.stringify(error);
    console.warn(`${hint}\n${detail}`);
    return false;
  }
}

async function runVitest() {
  const runner = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(runner, [
    "vitest",
    "run",
    "--config",
    "vitest.db.config.ts",
  ], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

const available = await canStartTestcontainer();
if (!available) {
  process.exit(0);
}

await runVitest();

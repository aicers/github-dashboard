import "@/lib/setup-env";

import { closePool, ensureSchema } from "@/lib/db";
import {
  type RepositoryRealignmentOptions,
  realignRepositoryMismatches,
} from "@/lib/github/repository-realignment";

type CliOptions = {
  dryRun: boolean;
  limit: number;
  chunkSize: number;
  ids: string[];
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit = 500;
  let chunkSize = 25;
  const ids: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
      continue;
    }
    if (arg === "--limit") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--chunk-size=")) {
      const value = Number.parseInt(arg.slice("--chunk-size=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        chunkSize = Math.min(value, 50);
      }
      continue;
    }
    if (arg === "--chunk-size") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        chunkSize = Math.min(value, 50);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--id=")) {
      const value = arg.slice("--id=".length).trim();
      if (value.length) {
        ids.push(value);
      }
      continue;
    }
    if (arg === "--id") {
      const value = (args[index + 1] ?? "").trim();
      if (value.length) {
        ids.push(value);
        index += 1;
      }
    }
  }

  const normalizedIds = Array.from(
    new Set(ids.map((value) => value.trim()).filter((value) => value.length)),
  );

  return { dryRun, limit, chunkSize, ids: normalizedIds };
}

async function main() {
  await ensureSchema();

  const cliOptions = parseArgs();
  const options: RepositoryRealignmentOptions = {
    dryRun: cliOptions.dryRun,
    limit: cliOptions.limit,
    chunkSize: cliOptions.chunkSize,
    refreshArtifacts: !cliOptions.dryRun,
    logger: (message: string) => console.info(`[backfill] ${message}`),
    ids: cliOptions.ids,
  };

  const summary = await realignRepositoryMismatches(options);
  if (summary.dryRun) {
    console.info(
      `[backfill] Dry run complete. Candidates: ${summary.candidates}.`,
    );
  } else {
    console.info(
      `[backfill] Updated ${summary.updated} issues/discussions (candidates: ${summary.candidates}).`,
    );
  }
}

main()
  .catch((error) => {
    console.error("[backfill] Failed to realign repositories:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch((closeError) => {
      console.error("[backfill] Failed to close database pool", closeError);
    });
  });

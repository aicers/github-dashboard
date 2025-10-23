#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import process, { exit } from "node:process";
import { constants as fsConstants } from "node:fs";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      // Treat as positional output dir override.
      options.dir = arg;
      continue;
    }

    const [flag, value] = arg.split("=", 2);
    switch (flag) {
      case "--dir":
        options.dir = value ?? argv[++i];
        break;
      case "--label":
        options.label = value ?? argv[++i];
        break;
      case "--format":
        options.format = value ?? argv[++i];
        break;
      case "--pg-dump":
        options.pgDump = value ?? argv[++i];
        break;
      default:
        console.warn(`Ignoring unknown option: ${flag}`);
        break;
    }
  }
  return options;
}

function resolveFormat(rawFormat) {
  if (!rawFormat) {
    return "custom";
  }
  const normalized = rawFormat.toLowerCase();
  if (!["custom", "plain", "directory", "tar"].includes(normalized)) {
    console.warn(
      `Unsupported format "${rawFormat}", falling back to "custom".`,
    );
    return "custom";
  }
  return normalized;
}

function timestampLabel() {
  const now = new Date();
  const pad = (value) => value.toString().padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

async function ensureDir(dirPath) {
  try {
    await access(dirPath, fsConstants.W_OK);
    return;
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(dirPath, { recursive: true });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Export the connection string before running this script.",
    );
    exit(1);
  }

  const {
    dir: cliDir,
    label: cliLabel,
    format: cliFormat,
    pgDump: cliPgDump,
  } = parseArgs(process.argv.slice(2));

  const outputDir = path.resolve(process.cwd(), cliDir ?? "backups");
  const format = resolveFormat(cliFormat);
  const label = cliLabel ? cliLabel.replace(/[^a-zA-Z0-9_-]/g, "") : null;
  const pgDumpExecutable = cliPgDump ?? "pg_dump";
  const basenameParts = ["activity"];
  if (label?.length) {
    basenameParts.push(label);
  }
  basenameParts.push(timestampLabel());

  const filename =
    format === "plain"
      ? `${basenameParts.join("-")}.sql`
      : `${basenameParts.join("-")}.dump`;
  const outputPath = path.join(outputDir, filename);

  try {
    await ensureDir(outputDir);
  } catch (error) {
    console.error(`Failed to ensure backup directory: ${error.message}`);
    exit(1);
  }

  const pgDumpArgs = [];

  switch (format) {
    case "custom":
      pgDumpArgs.push("--format=custom");
      break;
    case "directory":
      pgDumpArgs.push("--format=directory");
      break;
    case "tar":
      pgDumpArgs.push("--format=tar");
      break;
    case "plain":
      pgDumpArgs.push("--format=plain");
      break;
    default:
      break;
  }

  pgDumpArgs.push("--file", outputPath);
  pgDumpArgs.push("--no-owner", "--no-privileges");
  pgDumpArgs.push(process.env.DATABASE_URL);

  console.log(
    `Creating backup with ${pgDumpExecutable} ${pgDumpArgs
      .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
      .join(" ")}`,
  );

  const child = spawn(pgDumpExecutable, pgDumpArgs, {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    if (code === 0) {
      console.log(`Backup completed: ${outputPath}`);
    } else {
      console.error(`Backup failed with exit code ${code}`);
      exit(code ?? 1);
    }
  });
}

main().catch((error) => {
  console.error("Unexpected error while running backup:", error);
  exit(1);
});


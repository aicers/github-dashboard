#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process, { exit } from "node:process";
import { Pool } from "pg";
import ts from "typescript";

const ACTIVITY_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS activity_items (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    number INTEGER,
    title TEXT,
    state TEXT,
    url TEXT,
    status TEXT NOT NULL,
    issue_project_status TEXT,
    issue_project_status_at TIMESTAMPTZ,
    issue_project_status_source TEXT,
    issue_project_status_locked BOOLEAN NOT NULL DEFAULT FALSE,
    issue_todo_project_status TEXT,
    issue_todo_project_status_at TIMESTAMPTZ,
    issue_todo_project_priority TEXT,
    issue_todo_project_priority_updated_at TIMESTAMPTZ,
    issue_todo_project_weight TEXT,
    issue_todo_project_weight_updated_at TIMESTAMPTZ,
    issue_todo_project_initiation_options TEXT,
    issue_todo_project_initiation_options_updated_at TIMESTAMPTZ,
    issue_todo_project_start_date TEXT,
    issue_todo_project_start_date_updated_at TIMESTAMPTZ,
    issue_activity_status TEXT,
    issue_activity_status_at TIMESTAMPTZ,
    repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
    repository_name TEXT,
    repository_name_with_owner TEXT,
    author_id TEXT REFERENCES users(id),
    assignee_ids TEXT[] NOT NULL DEFAULT '{}',
    reviewer_ids TEXT[] NOT NULL DEFAULT '{}',
    mentioned_ids TEXT[] NOT NULL DEFAULT '{}',
    commenter_ids TEXT[] NOT NULL DEFAULT '{}',
    reactor_ids TEXT[] NOT NULL DEFAULT '{}',
    label_keys TEXT[] NOT NULL DEFAULT '{}',
    label_names TEXT[] NOT NULL DEFAULT '{}',
    issue_type_id TEXT,
    issue_type_name TEXT,
    milestone_id TEXT,
    milestone_title TEXT,
    milestone_state TEXT,
    milestone_due_on TEXT,
    milestone_url TEXT,
    tracked_issues_count INTEGER NOT NULL DEFAULT 0,
    tracked_in_issues_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    merged_at TIMESTAMPTZ,
    is_merged BOOLEAN NOT NULL DEFAULT FALSE,
    issue_priority_value TEXT,
    issue_weight_value TEXT,
    activity_status TEXT,
    activity_status_at TIMESTAMPTZ,
    issue_display_status TEXT,
    body_text TEXT,
    attention_unanswered_mention BOOLEAN NOT NULL DEFAULT FALSE,
    attention_review_request_pending BOOLEAN NOT NULL DEFAULT FALSE,
    attention_stale_open_pr BOOLEAN NOT NULL DEFAULT FALSE,
    attention_idle_pr BOOLEAN NOT NULL DEFAULT FALSE,
    attention_backlog_issue BOOLEAN NOT NULL DEFAULT FALSE,
    attention_stalled_issue BOOLEAN NOT NULL DEFAULT FALSE,
    raw_data JSONB,
    project_history JSONB,
    snapshot_inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS activity_items_updated_idx ON activity_items(updated_at DESC NULLS LAST)`,
  `CREATE INDEX IF NOT EXISTS activity_items_status_idx ON activity_items(status)`,
  `CREATE INDEX IF NOT EXISTS activity_items_repository_idx ON activity_items(repository_id, updated_at DESC NULLS LAST)`,
];

function parseArgs(argv) {
  const options = {
    truncate: true,
    yes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--retain") {
      options.truncate = false;
      continue;
    }
    if (arg === "--no-truncate") {
      options.truncate = false;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    console.warn(`Unknown option ignored: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/db/backfill-activity-items.mjs [options]

Options:
  --no-truncate, --retain  Preserve existing rows; upsert missing ids only.
  --yes, -y                Skip interactive confirmation.
  --help, -h               Show this help message.
`);
}

async function loadTsModule(relativePath) {
  const modulePath = path.resolve(process.cwd(), relativePath);
  const source = await readFile(modulePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    transpiled.outputText,
    "utf8",
  ).toString("base64")}`;

  return import(moduleUrl);
}

async function confirmExecution(pool, options) {
  if (options.yes) {
    return true;
  }

  const { rows } = await pool.query(
    "SELECT COUNT(*)::bigint AS count FROM activity_items",
  );
  const existingCount = BigInt(rows[0]?.count ?? 0n);

  const prompt = await import("node:readline/promises");
  const rl = prompt.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const action = options.truncate
    ? "This will truncate activity_items and rebuild it"
    : "This will upsert into activity_items";
  const answer = await rl.question(
    `${action} (current rows: ${existingCount}). Continue? [y/N] `,
  );
  rl.close();
  return typeof answer === "string" && answer.trim().toLowerCase().startsWith("y");
}

function buildInsertStatement(targetProject, buildActivityBaseQuery) {
  const cte = buildActivityBaseQuery(targetProject);

  const insertColumns = [
    "id",
    "item_type",
    "number",
    "title",
    "state",
    "url",
    "status",
    "issue_project_status",
    "issue_project_status_at",
    "issue_project_status_locked",
    "repository_id",
    "repository_name",
    "repository_name_with_owner",
    "author_id",
    "assignee_ids",
    "reviewer_ids",
    "mentioned_ids",
    "commenter_ids",
    "reactor_ids",
    "label_keys",
    "label_names",
    "issue_type_id",
    "issue_type_name",
    "milestone_id",
    "milestone_title",
    "milestone_state",
    "milestone_due_on",
    "milestone_url",
    "tracked_issues_count",
    "tracked_in_issues_count",
    "created_at",
    "updated_at",
    "closed_at",
    "merged_at",
    "is_merged",
    "issue_priority_value",
    "issue_weight_value",
    "activity_status",
    "activity_status_at",
    "issue_display_status",
    "body_text",
    "raw_data",
    "project_history",
  ];

  const selectColumns = [
    "items.id",
    "items.item_type",
    "items.number",
    "items.title",
    "items.state",
    "items.url",
    "items.status",
    "items.issue_project_status",
    "items.issue_project_status_at",
    "items.issue_project_status_locked",
    "items.repository_id",
    "items.repository_name",
    "items.repository_name_with_owner",
    "items.author_id",
    "items.assignee_ids",
    "items.reviewer_ids",
    "items.mentioned_ids",
    "items.commenter_ids",
    "items.reactor_ids",
    "items.label_keys",
    "items.label_names",
    "items.issue_type_id",
    "items.issue_type_name",
    "items.milestone_id",
    "items.milestone_title",
    "items.milestone_state",
    "items.milestone_due_on",
    "items.milestone_url",
    "items.tracked_issues_count",
    "items.tracked_in_issues_count",
    "items.created_at",
    "items.updated_at",
    "items.closed_at",
    "items.merged_at",
    "items.is_merged",
    "items.issue_priority_value",
    "items.issue_weight_value",
    "items.activity_status",
    "items.activity_status_at",
    "items.issue_display_status",
    "items.body_text",
    "items.raw_data",
    "items.project_history",
  ];

  return `
${cte}
INSERT INTO activity_items (
  ${insertColumns.join(",\n  ")}
)
SELECT
  ${selectColumns.join(",\n  ")}
FROM combined AS items
ON CONFLICT (id) DO UPDATE SET
  item_type = EXCLUDED.item_type,
  number = EXCLUDED.number,
  title = EXCLUDED.title,
  state = EXCLUDED.state,
  url = EXCLUDED.url,
  status = EXCLUDED.status,
  issue_project_status = EXCLUDED.issue_project_status,
  issue_project_status_at = EXCLUDED.issue_project_status_at,
  issue_project_status_locked = EXCLUDED.issue_project_status_locked,
  repository_id = EXCLUDED.repository_id,
  repository_name = EXCLUDED.repository_name,
  repository_name_with_owner = EXCLUDED.repository_name_with_owner,
  author_id = EXCLUDED.author_id,
  assignee_ids = EXCLUDED.assignee_ids,
  reviewer_ids = EXCLUDED.reviewer_ids,
  mentioned_ids = EXCLUDED.mentioned_ids,
  commenter_ids = EXCLUDED.commenter_ids,
  reactor_ids = EXCLUDED.reactor_ids,
  label_keys = EXCLUDED.label_keys,
  label_names = EXCLUDED.label_names,
  issue_type_id = EXCLUDED.issue_type_id,
  issue_type_name = EXCLUDED.issue_type_name,
  milestone_id = EXCLUDED.milestone_id,
  milestone_title = EXCLUDED.milestone_title,
  milestone_state = EXCLUDED.milestone_state,
  milestone_due_on = EXCLUDED.milestone_due_on,
  milestone_url = EXCLUDED.milestone_url,
  tracked_issues_count = EXCLUDED.tracked_issues_count,
  tracked_in_issues_count = EXCLUDED.tracked_in_issues_count,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  closed_at = EXCLUDED.closed_at,
  merged_at = EXCLUDED.merged_at,
  is_merged = EXCLUDED.is_merged,
  issue_priority_value = EXCLUDED.issue_priority_value,
  issue_weight_value = EXCLUDED.issue_weight_value,
  activity_status = EXCLUDED.activity_status,
  activity_status_at = EXCLUDED.activity_status_at,
  issue_display_status = EXCLUDED.issue_display_status,
  body_text = EXCLUDED.body_text,
  raw_data = EXCLUDED.raw_data,
  project_history = EXCLUDED.project_history,
  snapshot_updated_at = NOW();
`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Export it before running the backfill.",
    );
    exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const statement of ACTIVITY_TABLE_STATEMENTS) {
      await pool.query(statement);
    }

    const shouldProceed = await confirmExecution(pool, options);
    if (!shouldProceed) {
      console.log("Aborted.");
      return;
    }

    const baseQueryModule = await loadTsModule(
      "src/lib/activity/base-query.ts",
    );
    const { buildActivityBaseQuery, normalizeProjectTarget } = baseQueryModule;
    if (typeof buildActivityBaseQuery !== "function") {
      throw new Error("Failed to load buildActivityBaseQuery from module.");
    }

    const targetProject = normalizeProjectTarget
      ? normalizeProjectTarget(process.env.TODO_PROJECT_NAME ?? null)
      : null;

    const insertSql = buildInsertStatement(
      targetProject,
      buildActivityBaseQuery,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (options.truncate) {
        await client.query("TRUNCATE activity_items");
      }
      const result = await client.query(insertSql);
      const { rows } = await client.query(
        "SELECT COUNT(*)::bigint AS count FROM activity_items",
      );
      await client.query("COMMIT");

      const inserted = result.rowCount ?? 0;
      const total = BigInt(rows[0]?.count ?? 0n);
      console.log(
        `Backfill completed. Inserted/updated ${inserted} rows. Table now has ${total} rows.`,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Backfill failed:", error);
    exit(1);
  } finally {
    await pool.end();
  }
}

run();

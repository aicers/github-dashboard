#!/usr/bin/env node

import { Pool } from "pg";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, exit } from "node:process";

const concurrentlyEnabled = process.argv.includes("--concurrently");
const autoYes = process.argv.includes("--yes");
const includeOptional = process.argv.includes("--include-optional");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Export a connection string and re-run the script.",
  );
  exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const indexes = [
  {
    name: "comments_body_trgm_idx",
    definition:
      "ON comments USING gin ((data->>'body') gin_trgm_ops)",
    table: "comments",
    description:
      "Accelerates Activity search over comment bodies with trigram matching.",
    references: ["src/lib/activity/service.ts:1519-1541"],
    verification: [
      {
        description: "Activity comment body search",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id
FROM comments c
WHERE c.data->>'body' ILIKE '%follow up%'
ORDER BY c.github_created_at DESC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "issues_title_body_trgm_idx",
    definition:
      "ON issues USING gin (title gin_trgm_ops, (data->>'body') gin_trgm_ops)",
    table: "issues",
    description:
      "Speeds Activity and Analytics title/body searches on issues and discussions.",
    references: [
      "src/lib/activity/service.ts:1519-1541",
      "src/lib/dashboard/attention.ts:1406-1456",
    ],
    verification: [
      {
        description: "Issue text search",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT i.id
FROM issues i
WHERE i.title ILIKE '%incident%'
   OR i.data->>'body' ILIKE '%follow up%'
ORDER BY i.github_created_at DESC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "prs_title_body_trgm_idx",
    definition:
      "ON pull_requests USING gin (title gin_trgm_ops, (data->>'body') gin_trgm_ops)",
    table: "pull_requests",
    description:
      "Improves Activity search across pull request titles and descriptions.",
    references: [
      "src/lib/activity/service.ts:1519-1541",
      "src/lib/dashboard/attention.ts:972-1094",
    ],
    verification: [
      {
        description: "Pull request text search",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT pr.id
FROM pull_requests pr
WHERE pr.title ILIKE '%refactor%'
   OR pr.data->>'body' ILIKE '%todo%'
ORDER BY pr.github_updated_at DESC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "users_login_lower_idx",
    definition: "ON users ((LOWER(login)))",
    table: "users",
    description:
      "Supports case-insensitive @mention lookups in attention/activity queries.",
    references: [
      "src/lib/dashboard/attention.ts:1406-1422",
      "src/lib/activity/service.ts:1687-1691",
      "src/lib/activity/service.ts:1800-1801",
    ],
    verification: [
      {
        description: "Mention lookup by login",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM users
WHERE LOWER(login) = LOWER('octocat');`,
      },
    ],
  },
  {
    name: "reviews_pr_author_submitted_idx",
    definition:
      "ON reviews (pull_request_id, author_id, github_submitted_at)",
    table: "reviews",
    description:
      "Speeds up “stuck review request” detection when checking for follow-up reviews.",
    references: ["src/lib/dashboard/attention.ts:1147-1152"],
    verification: [
      {
        description: "Negative review existence check",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT 1
FROM reviews
WHERE pull_request_id = 'pr-id'
  AND author_id = 'user-id'
  AND github_submitted_at >= NOW() - INTERVAL '30 days';`,
      },
    ],
  },
  {
    name: "comments_pr_author_created_idx",
    definition: "ON comments (pull_request_id, author_id, github_created_at)",
    table: "comments",
    description:
      "Accelerates PR comment follow-up checks used in review attention calculations.",
    references: ["src/lib/dashboard/attention.ts:1155-1159"],
    verification: [
      {
        description: "PR comment recency check",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT 1
FROM comments
WHERE pull_request_id = 'pr-id'
  AND author_id = 'user-id'
  AND github_created_at >= NOW() - INTERVAL '14 days';`,
      },
    ],
  },
  {
    name: "comments_issue_author_created_idx",
    definition: "ON comments (issue_id, author_id, github_created_at)",
    table: "comments",
    description:
      "Optimises issue/discussion mention follow-up checks for unanswered mentions.",
    references: ["src/lib/dashboard/attention.ts:1449-1457"],
    verification: [
      {
        description: "Issue comment recency check",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT 1
FROM comments
WHERE issue_id = 'issue-id'
  AND author_id = 'user-id'
  AND github_created_at >= NOW() - INTERVAL '14 days';`,
      },
    ],
  },
  {
    name: "review_requests_pending_idx",
    definition:
      "ON review_requests (pull_request_id, reviewer_id) WHERE removed_at IS NULL",
    table: "review_requests",
    description:
      "Keeps active review requests fast to query while ignoring historical rows.",
    references: [
      "src/lib/dashboard/attention.ts:972-999",
      "src/lib/dashboard/attention.ts:1189-1199",
    ],
    verification: [
      {
        description: "Active reviewer aggregation",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT ARRAY_AGG(DISTINCT reviewer_id)
FROM review_requests
WHERE pull_request_id = 'pr-id'
  AND removed_at IS NULL;`,
      },
    ],
  },
  {
    name: "pull_requests_open_created_idx",
    definition:
      "ON pull_requests (github_created_at) WHERE github_closed_at IS NULL",
    table: "pull_requests",
    description:
      "Filters long-open pull requests without scanning closed historical records.",
    references: ["src/lib/dashboard/attention.ts:972-990"],
    verification: [
      {
        description: "Stale PR discovery",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM pull_requests
WHERE github_closed_at IS NULL
  AND github_created_at <= NOW() - INTERVAL '26 days'
ORDER BY github_created_at ASC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "pull_requests_open_updated_idx",
    definition:
      "ON pull_requests (github_updated_at) WHERE github_closed_at IS NULL",
    table: "pull_requests",
    description:
      "Improves idle pull request checks based on last update timestamp.",
    references: ["src/lib/dashboard/attention.ts:1045-1094"],
    verification: [
      {
        description: "Idle PR discovery",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM pull_requests
WHERE github_closed_at IS NULL
  AND github_created_at <= NOW() - INTERVAL '12 days'
  AND github_updated_at <= NOW() - INTERVAL '12 days'
ORDER BY github_updated_at ASC NULLS LAST
LIMIT 20;`,
      },
    ],
  },
  {
    name: "issues_open_created_idx",
    definition:
      "ON issues (github_created_at) WHERE github_closed_at IS NULL",
    table: "issues",
    description:
      "Speeds backlog issue scans that only consider still-open issues.",
    references: ["src/lib/dashboard/attention.ts:1282-1303"],
    verification: [
      {
        description: "Backlog issue selection",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM issues
WHERE github_closed_at IS NULL
  AND github_created_at <= NOW() - INTERVAL '26 days'
ORDER BY github_created_at ASC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "reviews_pr_submitted_idx",
    definition: "ON reviews (pull_request_id, github_submitted_at)",
    table: "reviews",
    description:
      "Supports Analytics review-response metrics grouped by repository and window.",
    references: ["src/lib/dashboard/analytics/reviews.ts:160-205"],
    verification: [
      {
        description: "Review timeline window",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id
FROM reviews r
WHERE r.pull_request_id = 'pr-id'
  AND r.github_submitted_at BETWEEN NOW() - INTERVAL '30 days' AND NOW()
ORDER BY r.github_submitted_at DESC
LIMIT 20;`,
      },
    ],
  },
  {
    name: "issues_repo_created_idx",
    definition: "ON issues (repository_id, github_created_at)",
    table: "issues",
    description:
      "Helps Analytics counts by repository and created-at range.",
    references: [
      "src/lib/dashboard/analytics/issues.ts:33-47",
      "src/lib/dashboard/analytics/engagement.ts:174-198",
    ],
    verification: [
      {
        description: "Issues by repo/date window",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM issues
WHERE repository_id = 'repo-id'
  AND github_created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW();`,
      },
    ],
  },
  {
    name: "issues_repo_closed_idx",
    definition: "ON issues (repository_id, github_closed_at)",
    table: "issues",
    description:
      "Assists Analytics latency calculations that depend on closed timestamps.",
    references: ["src/lib/dashboard/analytics/issues.ts:35-47"],
    verification: [
      {
        description: "Issue closure by repo/date",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM issues
WHERE repository_id = 'repo-id'
  AND github_closed_at BETWEEN NOW() - INTERVAL '30 days' AND NOW();`,
      },
    ],
  },
  {
    name: "prs_repo_created_idx",
    definition: "ON pull_requests (repository_id, github_created_at)",
    table: "pull_requests",
    description:
      "Speeds Analytics aggregations of pull requests by repository and window.",
    references: [
      "src/lib/dashboard/analytics/pull-requests.ts:62-120",
      "src/lib/dashboard/analytics/leaderboards.ts:60-120",
    ],
    verification: [
      {
        description: "PRs created by repo/date",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM pull_requests
WHERE repository_id = 'repo-id'
  AND github_created_at BETWEEN NOW() - INTERVAL '30 days' AND NOW();`,
      },
    ],
  },
  {
    name: "prs_repo_merged_idx",
    definition: "ON pull_requests (repository_id, github_merged_at)",
    table: "pull_requests",
    description:
      "Improves Analytics merge-latency queries grouped per repository.",
    references: [
      "src/lib/dashboard/analytics/pull-requests.ts:62-120",
      "src/lib/dashboard/analytics/reviews.ts:49-120",
    ],
    verification: [
      {
        description: "PR merges by repo/date",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM pull_requests
WHERE repository_id = 'repo-id'
  AND github_merged_at BETWEEN NOW() - INTERVAL '30 days' AND NOW();`,
      },
    ],
  },
  {
    name: "reactions_subject_idx_normalized",
    definition:
      "ON reactions ((LOWER(subject_type)), subject_id, user_id, github_created_at)",
    table: "reactions",
    description:
      "Aligns reaction lookups with case-insensitive subject matching used in attention queries.",
    references: [
      "src/lib/dashboard/attention.ts:1162-1176",
      "src/lib/dashboard/attention.ts:1468-1479",
    ],
    verification: [
      {
        description: "Reaction lookup by normalized subject",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT 1
FROM reactions
WHERE LOWER(subject_type) LIKE 'pullrequest%'
  AND subject_id = 'subject-id'
  AND user_id = 'user-id'
ORDER BY github_created_at DESC
LIMIT 1;`,
      },
    ],
  },
  {
    name: "issues_data_gin_idx",
    definition: "ON issues USING gin (data)",
    table: "issues",
    description:
      "Optional: broad JSONB index to support label/assignee filters during experiments.",
    references: [
      "src/lib/activity/cache.ts:750-816",
      "src/lib/activity/service.ts:1672-1860",
    ],
    optional: true,
    verification: [
      {
        description: "Issue JSONB label filter",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM issues
WHERE data @> '{"labels":{"nodes":[{"name":"Bug"}]}}'::jsonb
LIMIT 20;`,
      },
    ],
  },
  {
    name: "pull_requests_data_gin_idx",
    definition: "ON pull_requests USING gin (data)",
    table: "pull_requests",
    description:
      "Optional: JSONB acceleration for pull-request label/assignee experiments.",
    references: [
      "src/lib/activity/cache.ts:759-816",
      "src/lib/activity/service.ts:1806-1860",
    ],
    optional: true,
    verification: [
      {
        description: "Pull request JSONB label filter",
        sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM pull_requests
WHERE data @> '{"labels":{"nodes":[{"name":"Bug"}]}}'::jsonb
LIMIT 20;`,
      },
    ],
  },
];

const rl = createInterface({ input, output, terminal: true });
rl.on("SIGINT", () => {
  console.log("\nInterrupted.");
  cleanup(1);
});

async function promptChoice(question, defaultOption = "a") {
  if (autoYes) {
    return "a";
  }

  while (true) {
    const answer = await rl.question(`${question} `);
    const normalized = answer.trim().toLowerCase();
    if (!normalized && defaultOption) {
      return defaultOption;
    }
    if (["a", "apply"].includes(normalized)) {
      return "a";
    }
    if (["s", "skip"].includes(normalized)) {
      return "s";
    }
    if (["q", "quit"].includes(normalized)) {
      return "q";
    }
    console.log("Please answer with [a]pply, [s]kip, or [q]uit.");
  }
}

async function promptYesNo(question, defaultValue = false) {
  if (autoYes) {
    return defaultValue;
  }

  while (true) {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = await rl.question(`${question} ${suffix} `);
    const normalized = answer.trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }
    if (["y", "yes"].includes(normalized)) {
      return true;
    }
    if (["n", "no"].includes(normalized)) {
      return false;
    }
    console.log("Please answer yes or no.");
  }
}

function buildCreateStatement(index) {
  const keyword = concurrentlyEnabled ? "CREATE INDEX CONCURRENTLY" : "CREATE INDEX";
  return `${keyword} ${index.name} ${index.definition};`;
}

async function runQuery(label, sql, { captureRows = false } = {}) {
  console.log(`\n${label}`);
  console.log(sql);
  const startedAt = Date.now();
  try {
    const result = await pool.query(sql);
    const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log(`→ completed in ${duration}s`);
    if (captureRows && result?.rows?.length) {
      for (const row of result.rows) {
        if (row["QUERY PLAN"]) {
          console.log(row["QUERY PLAN"]);
        } else {
          console.log(JSON.stringify(row));
        }
      }
    }
  } catch (error) {
    console.error(`✗ ${label} failed:`, error.message);
    throw error;
  }
}

async function processIndex(index) {
  console.log("\n========================================");
  console.log(`Index: ${index.name}${index.optional ? " (optional)" : ""}`);
  console.log(index.description);
  if (index.references?.length) {
    console.log(`References: ${index.references.join(", ")}`);
  }
  const createStatement = buildCreateStatement(index);
  console.log(`Statement: ${createStatement}`);

  if (index.optional && !includeOptional) {
    const include = await promptYesNo(
      "This index is marked optional. Apply it anyway?",
      false,
    );
    if (!include) {
      console.log("Skipping optional index.");
      return;
    }
  }

  const choice = await promptChoice("[a]pply / [s]kip / [q]uit?", "a");
  if (choice === "q") {
    console.log("Stopping at user request.");
    cleanup();
  }
  if (choice === "s") {
    console.log("Skipped.");
    return;
  }

  await runQuery("Creating index...", createStatement);

  if (index.table) {
    await runQuery(`ANALYZE ${index.table}`, `ANALYZE ${index.table};`);
  }

  if (index.verification?.length) {
    for (const step of index.verification) {
      const shouldRun = await promptYesNo(
        `Run verification query: ${step.description}?`,
        false,
      );
      if (shouldRun) {
        await runQuery(
          `Verification: ${step.description}`,
          step.sql,
          { captureRows: true },
        );
      }
    }
  }

  console.log(`✓ Finished ${index.name}`);
}

async function main() {
  console.log("Interactive index application script");
  console.log("------------------------------------");
  console.log(
    `Connection: ${process.env.DATABASE_URL.replace(/:\/\/(.*)@/, "://***@")}`,
  );
  console.log(
    `Mode: ${concurrentlyEnabled ? "CONCURRENTLY" : "standard"} create`,
  );
  if (autoYes) {
    console.log("Auto-confirm is enabled (--yes).");
  }

  for (const index of indexes) {
    try {
      await processIndex(index);
    } catch (error) {
      console.error(
        `Stopping due to error while processing ${index.name}.`,
      );
      cleanup(1);
    }
  }

  console.log("\nAll indexes processed.");
  cleanup();
}

async function cleanup(exitCode = 0) {
  try {
    await rl.close();
  } catch {
    // ignore
  }
  try {
    await pool.end();
  } catch {
    // ignore
  }
  exit(exitCode);
}

await main();

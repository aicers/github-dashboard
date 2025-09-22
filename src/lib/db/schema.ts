import { getPool } from "@/lib/db/client";
import { env } from "@/lib/env";

const SCHEMA_LOCK_ID = BigInt("8764321987654321");

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    github_created_at TIMESTAMPTZ,
    github_updated_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS users_login_idx ON users(login)`,
  `CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_with_owner TEXT NOT NULL,
    owner_id TEXT,
    url TEXT,
    is_private BOOLEAN,
    github_created_at TIMESTAMPTZ,
    github_updated_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (owner_id) REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS repositories_owner_idx ON repositories(owner_id)`,
  `CREATE INDEX IF NOT EXISTS repositories_updated_idx ON repositories(github_updated_at)`,
  `CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    title TEXT,
    state TEXT,
    github_created_at TIMESTAMPTZ NOT NULL,
    github_updated_at TIMESTAMPTZ NOT NULL,
    github_closed_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS issues_repository_idx ON issues(repository_id)`,
  `CREATE INDEX IF NOT EXISTS issues_author_idx ON issues(author_id)`,
  `CREATE INDEX IF NOT EXISTS issues_created_idx ON issues(github_created_at)`,
  `CREATE INDEX IF NOT EXISTS issues_updated_idx ON issues(github_updated_at)`,
  `CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    title TEXT,
    state TEXT,
    merged BOOLEAN,
    github_created_at TIMESTAMPTZ NOT NULL,
    github_updated_at TIMESTAMPTZ NOT NULL,
    github_closed_at TIMESTAMPTZ,
    github_merged_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS pull_requests_repository_idx ON pull_requests(repository_id)`,
  `CREATE INDEX IF NOT EXISTS pull_requests_author_idx ON pull_requests(author_id)`,
  `CREATE INDEX IF NOT EXISTS pull_requests_created_idx ON pull_requests(github_created_at)`,
  `CREATE INDEX IF NOT EXISTS pull_requests_updated_idx ON pull_requests(github_updated_at)`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    state TEXT,
    github_submitted_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS reviews_pull_request_idx ON reviews(pull_request_id)`,
  `CREATE INDEX IF NOT EXISTS reviews_author_idx ON reviews(author_id)`,
  `CREATE INDEX IF NOT EXISTS reviews_submitted_idx ON reviews(github_submitted_at)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    issue_id TEXT REFERENCES issues(id) ON DELETE CASCADE,
    pull_request_id TEXT REFERENCES pull_requests(id) ON DELETE CASCADE,
    review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id),
    github_created_at TIMESTAMPTZ NOT NULL,
    github_updated_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS comments_issue_idx ON comments(issue_id)`,
  `CREATE INDEX IF NOT EXISTS comments_pull_request_idx ON comments(pull_request_id)`,
  `CREATE INDEX IF NOT EXISTS comments_author_idx ON comments(author_id)`,
  `CREATE INDEX IF NOT EXISTS comments_created_idx ON comments(github_created_at)`,
  `CREATE TABLE IF NOT EXISTS sync_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    org_name TEXT NOT NULL,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    last_sync_started_at TIMESTAMPTZ,
    last_sync_completed_at TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    resource TEXT PRIMARY KEY,
    last_cursor TEXT,
    last_item_timestamp TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    resource TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    message TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS sync_log_resource_idx ON sync_log(resource)`,
  `CREATE INDEX IF NOT EXISTS sync_log_started_idx ON sync_log(started_at)`,
];

let ensurePromise: Promise<void> | null = null;

async function applySchema() {
  const pool = getPool();
  await pool.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_ID]);

  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await pool.query(statement);
    }

    const orgName = env.GITHUB_ORG ?? null;
    await pool.query(
      `INSERT INTO sync_config (id, org_name, auto_sync_enabled, sync_interval_minutes)
       VALUES ('default', COALESCE($1, 'unset'), FALSE, $2)
       ON CONFLICT (id) DO UPDATE SET
         sync_interval_minutes = EXCLUDED.sync_interval_minutes,
         org_name = CASE WHEN $1 IS NOT NULL THEN EXCLUDED.org_name ELSE sync_config.org_name END,
         updated_at = NOW()`,
      [orgName, env.SYNC_INTERVAL_MINUTES],
    );
  } finally {
    await pool.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_ID]);
  }
}

export async function ensureSchema() {
  if (!ensurePromise) {
    ensurePromise = applySchema();
  }

  return ensurePromise;
}

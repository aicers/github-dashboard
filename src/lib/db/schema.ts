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
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_slug TEXT,
    org_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at)`,
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
  `CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    content TEXT,
    github_created_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS reactions_subject_idx ON reactions(subject_type, subject_id)`,
  `CREATE INDEX IF NOT EXISTS reactions_user_idx ON reactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS reactions_created_idx ON reactions(github_created_at)`,
  `CREATE TABLE IF NOT EXISTS review_requests (
    id TEXT PRIMARY KEY,
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    reviewer_id TEXT REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL,
    removed_at TIMESTAMPTZ,
    data JSONB NOT NULL,
    removed_data JSONB,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS review_requests_pull_request_idx ON review_requests(pull_request_id)`,
  `CREATE INDEX IF NOT EXISTS review_requests_reviewer_idx ON review_requests(reviewer_id)`,
  `CREATE INDEX IF NOT EXISTS review_requests_requested_idx ON review_requests(requested_at)`,
  `CREATE TABLE IF NOT EXISTS sync_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    org_name TEXT NOT NULL,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    week_start TEXT NOT NULL DEFAULT 'monday',
    excluded_repository_ids TEXT[] NOT NULL DEFAULT '{}',
    excluded_user_ids TEXT[] NOT NULL DEFAULT '{}',
    date_time_format TEXT NOT NULL DEFAULT 'auto',
    last_sync_started_at TIMESTAMPTZ,
    last_sync_completed_at TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS week_start TEXT NOT NULL DEFAULT 'monday'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS excluded_repository_ids TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS excluded_user_ids TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS date_time_format TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`,
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
  `CREATE TABLE IF NOT EXISTS activity_issue_status_history (
    id SERIAL PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('no_status', 'todo', 'in_progress', 'done', 'pending')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'activity',
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS activity_issue_status_history_issue_idx ON activity_issue_status_history(issue_id)`,
  `CREATE INDEX IF NOT EXISTS activity_issue_status_history_issue_occurred_idx ON activity_issue_status_history(issue_id, occurred_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_issue_project_overrides (
    issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
    priority_value TEXT,
    priority_updated_at TIMESTAMPTZ,
    weight_value TEXT,
    weight_updated_at TIMESTAMPTZ,
    initiation_value TEXT,
    initiation_updated_at TIMESTAMPTZ,
    start_date_value TEXT,
    start_date_updated_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE activity_issue_project_overrides ADD COLUMN IF NOT EXISTS weight_value TEXT`,
  `ALTER TABLE activity_issue_project_overrides ADD COLUMN IF NOT EXISTS weight_updated_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS activity_saved_filters (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS activity_saved_filters_user_idx ON activity_saved_filters(user_id, updated_at DESC)`,
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
      `INSERT INTO sync_config (id, org_name, auto_sync_enabled, sync_interval_minutes, timezone)
       VALUES ('default', COALESCE($1, 'unset'), FALSE, $2, 'UTC')
       ON CONFLICT (id) DO UPDATE SET
         sync_interval_minutes = EXCLUDED.sync_interval_minutes,
       org_name = CASE WHEN $1 IS NOT NULL THEN EXCLUDED.org_name ELSE sync_config.org_name END,
        timezone = sync_config.timezone,
        excluded_repository_ids = sync_config.excluded_repository_ids,
        excluded_user_ids = sync_config.excluded_user_ids,
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

import { readFile } from "node:fs/promises";
import path from "node:path";

import { getPool } from "@/lib/db/client";
import { env } from "@/lib/env";
import {
  DEFAULT_HOLIDAY_CALENDAR,
  HOLIDAY_CALENDAR_DEFINITIONS,
  HOLIDAY_SOURCE_COUNTRY_MAP,
  type HolidayCalendarCode,
} from "@/lib/holidays/constants";

const SCHEMA_LOCK_ID = BigInt("8764321987654321");

type ParsedHolidayRow = {
  country: string;
  year: number;
  dateKey: string;
  weekday: string | null;
  name: string;
  note: string | null;
};

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let buffer = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const nextChar = line[index + 1];
      if (insideQuotes && nextChar === '"') {
        buffer += '"';
        index += 1;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += char;
  }

  result.push(buffer.trim());
  return result;
}

function parseHolidayCsv(content: string): ParsedHolidayRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return [];
  }

  const rows: ParsedHolidayRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) {
      continue;
    }
    const rawValues = splitCsvLine(line);
    if (rawValues.length < 5) {
      continue;
    }
    const [country, yearValue, dateKey, weekdayValue, nameValue, ...noteParts] =
      rawValues;
    const noteValue = noteParts.length ? noteParts.join(", ") : "";
    const year = Number.parseInt(yearValue, 10);
    if (!Number.isFinite(year)) {
      continue;
    }
    const normalizedDateKey = dateKey.replace(/\s+/g, "");
    if (!/^\d{2}-\d{2}$/.test(normalizedDateKey)) {
      continue;
    }
    rows.push({
      country: country.trim(),
      year,
      dateKey: normalizedDateKey,
      weekday: weekdayValue.trim() || null,
      name: nameValue.trim(),
      note: noteValue.trim() || null,
    });
  }
  return rows;
}

function toIsoDateKey(year: number, monthDay: string): string {
  const [month, day] = monthDay.split("-");
  const normalizedMonth = month.padStart(2, "0");
  const normalizedDay = day.padStart(2, "0");
  return `${year}-${normalizedMonth}-${normalizedDay}`;
}

async function seedHolidayData() {
  const pool = getPool();
  const csvPath = path.resolve(process.cwd(), "data", "holidays.csv");
  let fileContent: string;
  try {
    fileContent = await readFile(csvPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(
        "[schema] Holiday CSV not found at data/holidays.csv; skipping seed.",
      );
      return;
    }
    throw error;
  }

  const parsedRows = parseHolidayCsv(fileContent);
  if (!parsedRows.length) {
    return;
  }

  for (const definition of HOLIDAY_CALENDAR_DEFINITIONS) {
    await pool.query(
      `INSERT INTO holiday_calendars (code, label, country_label, region_label, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET
         label = EXCLUDED.label,
         country_label = EXCLUDED.country_label,
         region_label = EXCLUDED.region_label,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()`,
      [
        definition.code,
        definition.label,
        definition.countryLabel,
        definition.regionLabel,
        definition.sortOrder,
      ],
    );
  }

  const rowsByCalendar = new Map<HolidayCalendarCode, ParsedHolidayRow[]>();
  for (const row of parsedRows) {
    const targets = HOLIDAY_SOURCE_COUNTRY_MAP[row.country];
    if (!targets) {
      continue;
    }
    for (const calendarCode of targets) {
      const current = rowsByCalendar.get(calendarCode) ?? [];
      current.push(row);
      rowsByCalendar.set(calendarCode, current);
    }
  }

  for (const definition of HOLIDAY_CALENDAR_DEFINITIONS) {
    const calendarRows = rowsByCalendar.get(definition.code) ?? [];
    if (!calendarRows.length) {
      continue;
    }
    const existingCountResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM calendar_holidays
       WHERE calendar_code = $1`,
      [definition.code],
    );
    const existingCount = Number.parseInt(
      existingCountResult.rows[0]?.count ?? "0",
      10,
    );
    if (existingCount > 0) {
      continue;
    }

    const sortedRows = [...calendarRows].sort((a, b) => {
      const aDate = toIsoDateKey(a.year, a.dateKey);
      const bDate = toIsoDateKey(b.year, b.dateKey);
      return aDate.localeCompare(bDate);
    });

    for (const row of sortedRows) {
      await pool.query(
        `INSERT INTO calendar_holidays (
           calendar_code,
           source_country,
           year,
           date_key,
           holiday_date,
           weekday,
           name,
           note
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (calendar_code, holiday_date, name) DO NOTHING`,
        [
          definition.code,
          row.country,
          row.year,
          row.dateKey,
          toIsoDateKey(row.year, row.dateKey),
          row.weekday,
          row.name,
          row.note,
        ],
      );
    }
  }

  await pool.query(
    `UPDATE user_preferences
     SET holiday_calendar_code = $1
     WHERE holiday_calendar_code IS NULL`,
    [DEFAULT_HOLIDAY_CALENDAR],
  );
}

const SCHEMA_STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
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
  `CREATE INDEX IF NOT EXISTS users_login_lower_idx ON users ((LOWER(login)))`,
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
  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    week_start TEXT NOT NULL DEFAULT 'monday',
    date_time_format TEXT NOT NULL DEFAULT 'auto',
    activity_rows_per_page INTEGER NOT NULL DEFAULT 25,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS week_start TEXT NOT NULL DEFAULT 'monday'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS date_time_format TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS holiday_calendar_code TEXT`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS holiday_calendar_codes TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS activity_rows_per_page INTEGER`,
  `ALTER TABLE user_preferences ALTER COLUMN activity_rows_per_page SET DEFAULT 25`,
  `UPDATE user_preferences
     SET activity_rows_per_page = 25
     WHERE activity_rows_per_page IS NULL`,
  `UPDATE user_preferences
     SET holiday_calendar_codes = ARRAY[holiday_calendar_code]
     WHERE COALESCE(array_length(holiday_calendar_codes, 1), 0) = 0
       AND holiday_calendar_code IS NOT NULL`,
  `UPDATE user_preferences
     SET holiday_calendar_codes = ARRAY['${DEFAULT_HOLIDAY_CALENDAR}']
     WHERE COALESCE(array_length(holiday_calendar_codes, 1), 0) = 0
       AND (holiday_calendar_code IS NULL OR holiday_calendar_code = '')`,
  `CREATE TABLE IF NOT EXISTS user_personal_holidays (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS user_personal_holidays_user_idx
     ON user_personal_holidays(user_id, start_date, end_date)`,
  `CREATE TABLE IF NOT EXISTS holiday_calendars (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    country_label TEXT NOT NULL,
    region_label TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_holidays (
    id SERIAL PRIMARY KEY,
    calendar_code TEXT NOT NULL REFERENCES holiday_calendars(code) ON DELETE CASCADE,
    source_country TEXT NOT NULL,
    year INTEGER NOT NULL,
    date_key TEXT NOT NULL,
    holiday_date DATE NOT NULL,
    weekday TEXT,
    name TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS calendar_holidays_unique_idx
     ON calendar_holidays(calendar_code, holiday_date, name)`,
  `CREATE INDEX IF NOT EXISTS calendar_holidays_calendar_idx
     ON calendar_holidays(calendar_code, holiday_date)`,
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
  `CREATE INDEX IF NOT EXISTS issues_repo_created_idx ON issues(repository_id, github_created_at)`,
  `CREATE INDEX IF NOT EXISTS issues_repo_closed_idx ON issues(repository_id, github_closed_at)`,
  `CREATE INDEX IF NOT EXISTS issues_open_created_idx ON issues(github_created_at) WHERE github_closed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS issues_title_body_trgm_idx ON issues USING gin (title gin_trgm_ops, (data->>'body') gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS issues_data_gin_idx ON issues USING gin (data)`,
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
  `CREATE INDEX IF NOT EXISTS prs_repo_created_idx ON pull_requests(repository_id, github_created_at)`,
  `CREATE INDEX IF NOT EXISTS prs_repo_merged_idx ON pull_requests(repository_id, github_merged_at)`,
  `CREATE INDEX IF NOT EXISTS pull_requests_open_created_idx ON pull_requests(github_created_at) WHERE github_closed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS pull_requests_open_updated_idx ON pull_requests(github_updated_at) WHERE github_closed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS prs_title_body_trgm_idx ON pull_requests USING gin (title gin_trgm_ops, (data->>'body') gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS pull_requests_data_gin_idx ON pull_requests USING gin (data)`,
  `CREATE TABLE IF NOT EXISTS pull_request_issues (
    pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    issue_number INTEGER,
    issue_title TEXT,
    issue_state TEXT,
    issue_url TEXT,
    issue_repository TEXT,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pull_request_id, issue_id)
  )`,
  `CREATE INDEX IF NOT EXISTS pull_request_issues_issue_idx ON pull_request_issues(issue_id)`,
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
  `CREATE INDEX IF NOT EXISTS reviews_pr_author_submitted_idx ON reviews(pull_request_id, author_id, github_submitted_at)`,
  `CREATE INDEX IF NOT EXISTS reviews_pr_submitted_idx ON reviews(pull_request_id, github_submitted_at)`,
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
  `CREATE INDEX IF NOT EXISTS comments_pr_author_created_idx ON comments(pull_request_id, author_id, github_created_at)`,
  `CREATE INDEX IF NOT EXISTS comments_issue_author_created_idx ON comments(issue_id, author_id, github_created_at)`,
  `CREATE INDEX IF NOT EXISTS comments_body_trgm_idx ON comments USING gin ((data->>'body') gin_trgm_ops)`,
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
  `CREATE TABLE IF NOT EXISTS activity_comment_participants (
    item_id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    participant_ids TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS activity_comment_mentions (
    item_id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    mentioned_ids TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS activity_reaction_users (
    item_id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    reactor_ids TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
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
  `CREATE INDEX IF NOT EXISTS reactions_subject_idx_normalized ON reactions ((LOWER(subject_type)), subject_id, user_id, github_created_at)`,
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
  `CREATE INDEX IF NOT EXISTS review_requests_pending_idx ON review_requests(pull_request_id, reviewer_id) WHERE removed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS sync_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    org_name TEXT NOT NULL,
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    week_start TEXT NOT NULL DEFAULT 'monday',
    excluded_repository_ids TEXT[] NOT NULL DEFAULT '{}',
    excluded_user_ids TEXT[] NOT NULL DEFAULT '{}',
    allowed_team_slugs TEXT[] NOT NULL DEFAULT '{}',
    allowed_user_ids TEXT[] NOT NULL DEFAULT '{}',
    date_time_format TEXT NOT NULL DEFAULT 'auto',
    last_sync_started_at TIMESTAMPTZ,
    last_sync_completed_at TIMESTAMPTZ,
    last_successful_sync_at TIMESTAMPTZ,
    backup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    backup_hour_local INTEGER NOT NULL DEFAULT 2,
    backup_timezone TEXT NOT NULL DEFAULT 'UTC',
    backup_last_started_at TIMESTAMPTZ,
    backup_last_completed_at TIMESTAMPTZ,
    backup_last_status TEXT NOT NULL DEFAULT 'idle',
    backup_last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS week_start TEXT NOT NULL DEFAULT 'monday'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS excluded_repository_ids TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS excluded_user_ids TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS allowed_team_slugs TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS allowed_user_ids TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS date_time_format TEXT NOT NULL DEFAULT 'auto'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_hour_local INTEGER NOT NULL DEFAULT 2`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_timezone TEXT NOT NULL DEFAULT 'UTC'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_last_started_at TIMESTAMPTZ`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_last_completed_at TIMESTAMPTZ`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_last_status TEXT NOT NULL DEFAULT 'idle'`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS backup_last_error TEXT`,
  `ALTER TABLE sync_config ADD COLUMN IF NOT EXISTS org_holiday_calendar_codes TEXT[] NOT NULL DEFAULT '{}'`,
  `UPDATE sync_config
     SET org_holiday_calendar_codes = ARRAY['${DEFAULT_HOLIDAY_CALENDAR}']
     WHERE COALESCE(array_length(org_holiday_calendar_codes, 1), 0) = 0`,
  `ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE TABLE IF NOT EXISTS db_backups (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL,
    directory TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    size_bytes BIGINT,
    error TEXT,
    restored_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS db_backups_started_at_idx ON db_backups(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sync_state (
    resource TEXT PRIMARY KEY,
    last_cursor TEXT,
    last_item_timestamp TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id SERIAL PRIMARY KEY,
    run_type TEXT NOT NULL,
    strategy TEXT NOT NULL,
    since TIMESTAMPTZ,
    until TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS sync_runs_started_idx ON sync_runs(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    resource TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL,
    message TEXT,
    run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sync_log_resource_idx ON sync_log(resource)`,
  `CREATE INDEX IF NOT EXISTS sync_log_started_idx ON sync_log(started_at)`,
  `ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS activity_issue_status_history (
    id SERIAL PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('no_status', 'todo', 'in_progress', 'done', 'pending', 'canceled')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'activity',
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS activity_issue_status_history_issue_idx ON activity_issue_status_history(issue_id)`,
  `CREATE INDEX IF NOT EXISTS activity_issue_status_history_issue_occurred_idx ON activity_issue_status_history(issue_id, occurred_at DESC)`,
  `ALTER TABLE activity_issue_status_history DROP CONSTRAINT IF EXISTS activity_issue_status_history_status_check`,
  `DO $$
     BEGIN
       BEGIN
         ALTER TABLE activity_issue_status_history
         ADD CONSTRAINT activity_issue_status_history_status_check
         CHECK (status IN ('no_status', 'todo', 'in_progress', 'done', 'pending', 'canceled'));
       EXCEPTION
         WHEN duplicate_object THEN
           NULL;
       END;
     END
   $$`,
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
  `CREATE TABLE IF NOT EXISTS activity_filter_options_cache (
    id TEXT PRIMARY KEY DEFAULT 'default',
    payload JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id INTEGER,
    repository_count INTEGER NOT NULL DEFAULT 0,
    label_count INTEGER NOT NULL DEFAULT 0,
    user_count INTEGER NOT NULL DEFAULT 0,
    issue_type_count INTEGER NOT NULL DEFAULT 0,
    milestone_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS activity_issue_links_cache (
    issue_id TEXT PRIMARY KEY,
    links JSONB NOT NULL,
    link_count INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS activity_issue_links_cache_generated_idx ON activity_issue_links_cache(generated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_pull_request_links_cache (
    pull_request_id TEXT PRIMARY KEY,
    links JSONB NOT NULL,
    link_count INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_run_id INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS activity_pull_request_links_cache_generated_idx ON activity_pull_request_links_cache(generated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS activity_cache_state (
    cache_key TEXT PRIMARY KEY,
    generated_at TIMESTAMPTZ,
    sync_run_id INTEGER,
    item_count INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

let ensurePromise: Promise<void> | null = null;

async function applySchema() {
  const pool = getPool();
  await pool.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_ID]);

  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await pool.query(statement);
    }

    await seedHolidayData();

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

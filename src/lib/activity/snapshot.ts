import {
  buildActivityBaseQuery,
  normalizeProjectTarget,
} from "@/lib/activity/base-query";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { env } from "@/lib/env";

function buildSnapshotUpsertSql(targetProject: string | null): string {
  const baseQuery = buildActivityBaseQuery(targetProject);
  return `
${baseQuery}
INSERT INTO activity_items (
  id,
  item_type,
  number,
  title,
  state,
  url,
  status,
  issue_project_status,
  issue_project_status_at,
  issue_project_status_locked,
  repository_id,
  repository_name,
  repository_name_with_owner,
  author_id,
  assignee_ids,
  reviewer_ids,
  mentioned_ids,
  commenter_ids,
  reactor_ids,
  label_keys,
  label_names,
  issue_type_id,
  issue_type_name,
  milestone_id,
  milestone_title,
  milestone_state,
  milestone_due_on,
  milestone_url,
  tracked_issues_count,
  tracked_in_issues_count,
  created_at,
  updated_at,
  closed_at,
  merged_at,
  is_merged,
  issue_priority_value,
  issue_weight_value,
  activity_status,
  activity_status_at,
  issue_display_status,
  body_text,
  raw_data,
  project_history
)
SELECT
  items.id,
  items.item_type,
  items.number,
  items.title,
  items.state,
  items.url,
  items.status,
  items.issue_project_status,
  items.issue_project_status_at,
  items.issue_project_status_locked,
  items.repository_id,
  items.repository_name,
  items.repository_name_with_owner,
  items.author_id,
  items.assignee_ids,
  items.reviewer_ids,
  items.mentioned_ids,
  items.commenter_ids,
  items.reactor_ids,
  items.label_keys,
  items.label_names,
  items.issue_type_id,
  items.issue_type_name,
  items.milestone_id,
  items.milestone_title,
  items.milestone_state,
  items.milestone_due_on,
  items.milestone_url,
  items.tracked_issues_count,
  items.tracked_in_issues_count,
  items.created_at,
  items.updated_at,
  items.closed_at,
  items.merged_at,
  items.is_merged,
  items.issue_priority_value,
  items.issue_weight_value,
  items.activity_status,
  items.activity_status_at,
  items.issue_display_status,
  items.body_text,
  items.raw_data,
  items.project_history
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

export async function refreshActivityItemsSnapshot(options?: {
  truncate?: boolean;
}): Promise<void> {
  await ensureSchema();
  const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);
  const upsertSql = buildSnapshotUpsertSql(targetProject);
  if (options?.truncate) {
    await query("TRUNCATE activity_items");
  }
  await query(upsertSql);
}

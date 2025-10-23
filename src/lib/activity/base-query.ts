export function normalizePrioritySql(valueExpr: string) {
  return `(CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN BTRIM(${valueExpr}) = '' THEN NULL
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p0%' THEN 'P0'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p1%' THEN 'P1'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'p2%' THEN 'P2'
    ELSE BTRIM(${valueExpr})
  END)`;
}

export function normalizeWeightSql(valueExpr: string) {
  return `(CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN BTRIM(${valueExpr}) = '' THEN NULL
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'heavy%' THEN 'Heavy'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'medium%' THEN 'Medium'
    WHEN LOWER(BTRIM(${valueExpr})) LIKE 'light%' THEN 'Light'
    ELSE INITCAP(BTRIM(${valueExpr}))
  END)`;
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

export function normalizeProjectTarget(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

export function buildActivityBaseQuery(targetProject: string | null): string {
  const mapProjectStatus = (valueExpr: string) => `(CASE
    WHEN ${valueExpr} IN ('', 'no', 'no_status') THEN 'no_status'
    WHEN ${valueExpr} IN ('todo', 'to_do', 'to do') THEN 'todo'
    WHEN ${valueExpr} LIKE 'in_progress%' OR ${valueExpr} = 'doing' OR ${valueExpr} = 'in-progress' THEN 'in_progress'
    WHEN ${valueExpr} IN ('done', 'completed', 'complete', 'finished', 'closed') THEN 'done'
    WHEN ${valueExpr} LIKE 'pending%' OR ${valueExpr} = 'waiting' THEN 'pending'
    WHEN ${valueExpr} IN ('canceled', 'cancelled') THEN 'canceled'
    WHEN ${valueExpr} LIKE '%project_removed%' THEN 'no_status'
    ELSE NULL
  END)`;

  const todoProjectStatusSelection =
    targetProject === null
      ? "NULL"
      : `(SELECT mapped.status_value
          FROM (
            SELECT ${mapProjectStatus(
              "normalized.normalized_status",
            )} AS status_value,
                   normalized.occurred_at AS occurred_at
            FROM (
              SELECT
                REGEXP_REPLACE(LOWER(COALESCE(entry->>'status', '')), '[^a-z0-9]+', '_', 'g') AS normalized_status,
                entry->>'occurredAt' AS occurred_at,
                LOWER(TRIM(COALESCE(
                  entry->>'projectTitle',
                  entry->'project'->>'title',
                  entry->'project'->>'name',
                  ''
                ))) AS project_name
              FROM jsonb_array_elements(COALESCE(i.data->'projectStatusHistory', '[]'::jsonb)) AS entry
            ) AS normalized
            WHERE normalized.project_name = '${escapeSqlLiteral(targetProject)}'
          ) AS mapped
          WHERE mapped.status_value IS NOT NULL
          ORDER BY COALESCE(mapped.occurred_at, '') DESC NULLS LAST
          LIMIT 1)`;
  const todoProjectStatusAtSelection =
    targetProject === null
      ? "NULL"
      : `(SELECT mapped.occurred_at
          FROM (
            SELECT ${mapProjectStatus(
              "normalized.normalized_status",
            )} AS status_value,
                   normalized.occurred_at AS occurred_at
            FROM (
              SELECT
                REGEXP_REPLACE(LOWER(COALESCE(entry->>'status', '')), '[^a-z0-9]+', '_', 'g') AS normalized_status,
                entry->>'occurredAt' AS occurred_at,
                LOWER(TRIM(COALESCE(
                  entry->>'projectTitle',
                  entry->'project'->>'title',
                  entry->'project'->>'name',
                  ''
                ))) AS project_name
              FROM jsonb_array_elements(COALESCE(i.data->'projectStatusHistory', '[]'::jsonb)) AS entry
            ) AS normalized
            WHERE normalized.project_name = '${escapeSqlLiteral(targetProject)}'
          ) AS mapped
          WHERE mapped.status_value IS NOT NULL
          ORDER BY COALESCE(mapped.occurred_at, '') DESC NULLS LAST
          LIMIT 1)`;

  const issueProjectStatusExpr =
    targetProject === null
      ? "'no_status'"
      : `COALESCE(${todoProjectStatusSelection}, 'no_status')`;
  const issueProjectStatusAtExpr =
    targetProject === null
      ? "NULL::timestamptz"
      : `${todoProjectStatusAtSelection}::timestamptz`;

  const projectMatchExpr =
    targetProject === null
      ? "FALSE"
      : `LOWER(TRIM(COALESCE(
           node->'project'->>'title',
           node->'project'->>'name',
           node->>'projectTitle',
           ''
         ))) = '${escapeSqlLiteral(targetProject)}'`;
  const priorityValueExpr = `NULLIF(TRIM(COALESCE(
    node->'priority'->>'name',
    node->'priority'->>'title',
    node->'priority'->>'text',
    node->'priority'->>'date',
    node->'priority'->>'number'
  )), '')`;
  const priorityUpdatedAtExpr = `NULLIF(TRIM(COALESCE(
    node->'priority'->>'updatedAt',
    node->>'updatedAt',
    node->>'createdAt'
  )), '')`;
  const weightValueExpr = `NULLIF(TRIM(COALESCE(
    node->'weight'->>'name',
    node->'weight'->>'title',
    node->'weight'->>'text',
    node->'weight'->>'number'
  )), '')`;
  const weightUpdatedAtExpr = `NULLIF(TRIM(COALESCE(
    node->'weight'->>'updatedAt',
    node->>'updatedAt',
    node->>'createdAt'
  )), '')`;
  const lockedStatusExpr = `(${issueProjectStatusExpr} IN ('in_progress', 'done', 'pending'))`;

  return /* sql */ `
WITH activity_status AS (
  SELECT DISTINCT ON (issue_id)
    issue_id,
    status,
    occurred_at
  FROM activity_issue_status_history
  ORDER BY issue_id, occurred_at DESC
),
issue_items AS (
  SELECT
    CASE
      WHEN LOWER(COALESCE(i.data->>'__typename', '')) = 'discussion'
        OR POSITION('/discussions/' IN COALESCE(i.data->>'url', '')) > 0
        THEN 'discussion'
      ELSE 'issue'
    END AS item_type,
    i.id,
    i.number,
    i.title,
    i.state,
    i.data->>'url' AS url,
    i.repository_id,
    repo.name AS repository_name,
    repo.name_with_owner AS repository_name_with_owner,
    i.author_id,
    COALESCE(assignees.assignee_ids, ARRAY[]::text[]) AS assignee_ids,
    ARRAY[]::text[] AS reviewer_ids,
    COALESCE(mentions.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
    COALESCE(commenters.commenter_ids, ARRAY[]::text[]) AS commenter_ids,
    COALESCE(reactors.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
    COALESCE(labels.label_keys, ARRAY[]::text[]) AS label_keys,
    COALESCE(labels.label_names, ARRAY[]::text[]) AS label_names,
    COALESCE(
      NULLIF(i.data->'issueType'->>'id', ''),
      CASE
        WHEN COALESCE(labels.has_bug_label, FALSE) THEN 'label:issue_type:bug'
        WHEN COALESCE(labels.has_feature_label, FALSE) THEN 'label:issue_type:feature'
        WHEN COALESCE(labels.has_task_label, FALSE) THEN 'label:issue_type:task'
        ELSE NULL
      END
    ) AS issue_type_id,
    COALESCE(
      NULLIF(i.data->'issueType'->>'name', ''),
      CASE
        WHEN COALESCE(labels.has_bug_label, FALSE) THEN 'Bug'
        WHEN COALESCE(labels.has_feature_label, FALSE) THEN 'Feature'
        WHEN COALESCE(labels.has_task_label, FALSE) THEN 'Task'
        ELSE NULL
      END
    ) AS issue_type_name,
    NULLIF(i.data->'milestone'->>'id', '') AS milestone_id,
    NULLIF(i.data->'milestone'->>'title', '') AS milestone_title,
    NULLIF(i.data->'milestone'->>'state', '') AS milestone_state,
    NULLIF(i.data->'milestone'->>'dueOn', '') AS milestone_due_on,
    NULLIF(i.data->'milestone'->>'url', '') AS milestone_url,
    COALESCE(
      NULLIF(i.data->'trackedIssues'->>'totalCount', '')::integer,
      0
    ) AS tracked_issues_count,
    COALESCE(
      NULLIF(i.data->'trackedInIssues'->>'totalCount', '')::integer,
      0
    ) AS tracked_in_issues_count,
    i.github_created_at AS created_at,
    i.github_updated_at AS updated_at,
    i.github_closed_at AS closed_at,
    NULL::timestamptz AS merged_at,
    FALSE AS is_merged,
    i.data AS raw_data,
    COALESCE(i.data->'projectStatusHistory', '[]'::jsonb) AS project_history,
    ${issueProjectStatusExpr} AS issue_project_status,
    ${issueProjectStatusAtExpr} AS issue_project_status_at,
    ${lockedStatusExpr} AS issue_project_status_locked,
    ${normalizePrioritySql(`CASE
      WHEN ${lockedStatusExpr}
        THEN priority_fields.priority_value
      ELSE COALESCE(
        NULLIF(BTRIM(overrides.priority_value), ''),
        priority_fields.priority_value
      )
    END`)} AS issue_priority_value,
    ${normalizeWeightSql(`CASE
      WHEN ${lockedStatusExpr}
        THEN weight_fields.weight_value
      ELSE COALESCE(
        NULLIF(BTRIM(overrides.weight_value), ''),
        weight_fields.weight_value
      )
    END`)} AS issue_weight_value,
    COALESCE(i.data->>'body', '') AS body_text,
    recent_status.status AS activity_status,
    recent_status.occurred_at AS activity_status_at
  FROM issues i
  JOIN repositories repo ON repo.id = i.repository_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT node->>'id') FILTER (WHERE node->>'id' IS NOT NULL) AS assignee_ids
    FROM jsonb_array_elements(COALESCE(i.data->'assignees'->'nodes', '[]'::jsonb)) AS node
  ) assignees ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT CONCAT(repo.name_with_owner, ':', label_node->>'name')) FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_keys,
      ARRAY_AGG(DISTINCT label_node->>'name') FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_names,
      BOOL_OR(LOWER(label_node->>'name') = 'bug') AS has_bug_label,
      BOOL_OR(LOWER(label_node->>'name') IN ('feature', 'feature request', 'enhancement')) AS has_feature_label,
      BOOL_OR(LOWER(label_node->>'name') IN ('task', 'todo', 'chore')) AS has_task_label
    FROM jsonb_array_elements(COALESCE(i.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
  ) labels ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS commenter_ids
    FROM comments c
    WHERE c.issue_id = i.id
  ) commenters ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
    FROM comments c
    CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
    LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
    WHERE c.issue_id = i.id
  ) mentions ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
    FROM reactions r
    WHERE r.subject_type IN ('Issue', 'Discussion') AND r.subject_id = i.id
  ) reactors ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ${priorityValueExpr} AS priority_value,
      ${priorityUpdatedAtExpr} AS priority_updated_at
    FROM jsonb_array_elements(COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)) AS node
    WHERE ${projectMatchExpr}
      AND ${priorityValueExpr} IS NOT NULL
    ORDER BY COALESCE(${priorityUpdatedAtExpr}, '') DESC NULLS LAST
    LIMIT 1
  ) priority_fields ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ${weightValueExpr} AS weight_value,
      ${weightUpdatedAtExpr} AS weight_updated_at
    FROM jsonb_array_elements(COALESCE(i.data->'projectItems'->'nodes', '[]'::jsonb)) AS node
    WHERE ${projectMatchExpr}
      AND ${weightValueExpr} IS NOT NULL
    ORDER BY COALESCE(${weightUpdatedAtExpr}, '') DESC NULLS LAST
    LIMIT 1
  ) weight_fields ON TRUE
  LEFT JOIN activity_issue_project_overrides overrides ON overrides.issue_id = i.id
  LEFT JOIN activity_status recent_status ON recent_status.issue_id = i.id
),
pr_items AS (
  SELECT
    'pull_request' AS item_type,
    pr.id,
    pr.number,
    pr.title,
    pr.state,
    pr.data->>'url' AS url,
    pr.repository_id,
    repo.name AS repository_name,
    repo.name_with_owner AS repository_name_with_owner,
    pr.author_id,
    COALESCE(assignees.assignee_ids, ARRAY[]::text[]) AS assignee_ids,
    COALESCE(reviewers.reviewer_ids, ARRAY[]::text[]) AS reviewer_ids,
    COALESCE(mentions.mentioned_ids, ARRAY[]::text[]) AS mentioned_ids,
    COALESCE(commenters.commenter_ids, ARRAY[]::text[]) AS commenter_ids,
    COALESCE(reactors.reactor_ids, ARRAY[]::text[]) AS reactor_ids,
    COALESCE(labels.label_keys, ARRAY[]::text[]) AS label_keys,
    COALESCE(labels.label_names, ARRAY[]::text[]) AS label_names,
    NULL::text AS issue_type_id,
    NULL::text AS issue_type_name,
    NULL::text AS milestone_id,
    NULL::text AS milestone_title,
    NULL::text AS milestone_state,
    NULL::text AS milestone_due_on,
    NULL::text AS milestone_url,
    0::integer AS tracked_issues_count,
    0::integer AS tracked_in_issues_count,
    pr.github_created_at AS created_at,
    pr.github_updated_at AS updated_at,
    pr.github_closed_at AS closed_at,
    pr.github_merged_at AS merged_at,
    COALESCE(pr.merged, FALSE) AS is_merged,
    pr.data AS raw_data,
    '[]'::jsonb AS project_history,
    NULL::text AS issue_project_status,
    NULL::timestamptz AS issue_project_status_at,
    FALSE AS issue_project_status_locked,
    NULL::text AS issue_priority_value,
    NULL::text AS issue_weight_value,
    COALESCE(pr.data->>'body', '') AS body_text,
    NULL::text AS activity_status,
    NULL::timestamptz AS activity_status_at
  FROM pull_requests pr
  JOIN repositories repo ON repo.id = pr.repository_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT node->>'id') FILTER (WHERE node->>'id' IS NOT NULL) AS assignee_ids
    FROM jsonb_array_elements(COALESCE(pr.data->'assignees'->'nodes', '[]'::jsonb)) AS node
  ) assignees ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT reviewer_id) FILTER (WHERE reviewer_id IS NOT NULL) AS requested_reviewers
    FROM review_requests
    WHERE pull_request_id = pr.id AND removed_at IS NULL
  ) requested ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT author_id) FILTER (WHERE author_id IS NOT NULL) AS review_authors
    FROM reviews
    WHERE pull_request_id = pr.id
  ) review_authors ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS reviewer_ids
    FROM unnest(
      COALESCE(requested.requested_reviewers, ARRAY[]::text[]) ||
      COALESCE(review_authors.review_authors, ARRAY[]::text[])
    ) AS user_id
  ) reviewers ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT CONCAT(repo.name_with_owner, ':', label_node->>'name')) FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_keys,
      ARRAY_AGG(DISTINCT label_node->>'name') FILTER (WHERE label_node->>'name' IS NOT NULL) AS label_names
    FROM jsonb_array_elements(COALESCE(pr.data->'labels'->'nodes', '[]'::jsonb)) AS label_node
  ) labels ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT c.author_id) FILTER (WHERE c.author_id IS NOT NULL) AS commenter_ids
    FROM comments c
    WHERE c.pull_request_id = pr.id
  ) commenters ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT u.id) FILTER (WHERE u.id IS NOT NULL) AS mentioned_ids
    FROM comments c
    CROSS JOIN LATERAL regexp_matches(COALESCE(c.data->>'body', ''), '@([A-Za-z0-9_-]+)', 'g') AS match(captures)
    LEFT JOIN users u ON LOWER(u.login) = LOWER(match.captures[1])
    WHERE c.pull_request_id = pr.id
  ) mentions ON TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT r.user_id) FILTER (WHERE r.user_id IS NOT NULL) AS reactor_ids
    FROM reactions r
    WHERE r.subject_type = 'PullRequest' AND r.subject_id = pr.id
  ) reactors ON TRUE
),
combined AS (
  SELECT
    item_type,
    id,
    number,
    title,
    state,
    url,
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
    raw_data,
    project_history,
    issue_project_status,
    issue_project_status_at,
    issue_project_status_locked,
    issue_priority_value,
    issue_weight_value,
    activity_status,
    activity_status_at,
    (CASE
      WHEN issue_project_status_locked AND issue_project_status IS NOT NULL THEN issue_project_status
      WHEN activity_status IS NOT NULL
        AND activity_status_at IS NOT NULL
        AND (issue_project_status_at IS NULL OR activity_status_at >= issue_project_status_at)
        THEN COALESCE(activity_status, issue_project_status, 'no_status')
      WHEN issue_project_status_at IS NOT NULL THEN COALESCE(issue_project_status, 'no_status')
      WHEN activity_status_at IS NOT NULL THEN COALESCE(activity_status, issue_project_status, 'no_status')
      ELSE COALESCE(activity_status, issue_project_status, 'no_status')
    END) AS issue_display_status,
    body_text,
    CASE
      WHEN item_type = 'pull_request' AND is_merged THEN 'merged'
      WHEN closed_at IS NOT NULL OR LOWER(state) = 'closed' THEN 'closed'
      ELSE 'open'
    END AS status
  FROM issue_items
  UNION ALL
  SELECT
    item_type,
    id,
    number,
    title,
    state,
    url,
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
    raw_data,
    project_history,
    issue_project_status,
    issue_project_status_at,
    issue_project_status_locked,
    issue_priority_value,
    issue_weight_value,
    activity_status,
    activity_status_at,
    NULL::text AS issue_display_status,
    body_text,
    CASE
      WHEN is_merged THEN 'merged'
      WHEN closed_at IS NOT NULL OR LOWER(state) = 'closed' THEN 'closed'
      ELSE 'open'
    END AS status
  FROM pr_items
)
`;
}

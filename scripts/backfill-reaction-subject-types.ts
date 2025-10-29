import { loadEnvConfig } from "@next/env";

import { closePool, ensureSchema, query } from "@/lib/db";

async function main() {
  loadEnvConfig(process.cwd());
  console.info("[backfill] ensuring database schema");
  await ensureSchema();

  console.info("[backfill] normalizing reaction subject types");
  const updateResult = await query<{ row_count: number }>(
    `
      WITH reaction_candidates AS (
        SELECT
          r.id,
          CASE
            WHEN c.id IS NOT NULL THEN (
              CASE
                WHEN c.review_id IS NOT NULL THEN 'PullRequestReviewComment'
                WHEN c.issue_id IS NOT NULL
                  AND (
                    LOWER(COALESCE(iss.data->>'__typename', '')) = 'discussion'
                    OR POSITION('/discussions/' IN COALESCE(iss.data->>'url', '')) > 0
                  )
                  THEN 'DiscussionComment'
                WHEN c.issue_id IS NOT NULL THEN 'IssueComment'
                WHEN c.pull_request_id IS NOT NULL THEN 'IssueComment'
                ELSE COALESCE(NULLIF(r.subject_type, ''), 'Comment')
              END
            )
            WHEN LOWER(r.subject_type) = 'issuecomment' THEN 'IssueComment'
            WHEN LOWER(r.subject_type) = 'discussioncomment' THEN 'DiscussionComment'
            WHEN LOWER(r.subject_type) = 'pullrequestreviewcomment'
              THEN 'PullRequestReviewComment'
            WHEN LOWER(r.subject_type) = 'teamdiscussioncomment'
              THEN 'TeamDiscussionComment'
            WHEN LOWER(r.subject_type) = 'comment' THEN 'Comment'
            ELSE r.subject_type
          END AS normalized_type
        FROM reactions r
        LEFT JOIN comments c ON c.id = r.subject_id
        LEFT JOIN issues iss ON iss.id = c.issue_id
        WHERE LOWER(r.subject_type) IN (
          'comment',
          'issuecomment',
          'discussioncomment',
          'pullrequestreviewcomment',
          'teamdiscussioncomment'
        )
      ),
      updated AS (
        UPDATE reactions r
        SET
          subject_type = candidates.normalized_type,
          updated_at = NOW()
        FROM reaction_candidates candidates
        WHERE r.id = candidates.id
          AND r.subject_type <> candidates.normalized_type
        RETURNING 1
      )
      SELECT COUNT(*)::int AS row_count FROM updated
    `,
  );

  const updatedRows = updateResult.rows[0]?.row_count ?? 0;
  console.info("[backfill] updated reaction rows", { updatedRows });

  await closePool();
}

main().catch((error) => {
  console.error("[backfill] failed to normalize reaction subject types", error);
  process.exit(1);
});

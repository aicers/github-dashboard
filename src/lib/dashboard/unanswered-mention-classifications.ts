import { query } from "@/lib/db/client";

export const UNANSWERED_MENTION_PROMPT_VERSION = "v1";

export type MentionClassificationRecord = {
  commentId: string;
  mentionedUserId: string;
  commentBodyHash: string;
  promptVersion: string;
  requiresResponse: boolean;
  model: string | null;
  rawResponse: unknown;
  lastEvaluatedAt: string | null;
};

export type MentionClassificationUpsert = {
  commentId: string;
  mentionedUserId: string;
  commentBodyHash: string;
  requiresResponse: boolean;
  model: string | null;
  rawResponse: unknown;
  promptVersion?: string;
  evaluatedAt?: Date;
};

type ClassificationRow = {
  comment_id: string;
  mentioned_user_id: string;
  comment_body_hash: string;
  prompt_version: string;
  requires_response: boolean;
  model: string | null;
  raw_response: unknown;
  last_evaluated_at: string | null;
};

type ClassificationKeyInput = {
  commentId: string;
  mentionedUserId: string;
};

export function buildMentionClassificationKey(
  commentId: string,
  mentionedUserId: string,
): string {
  return `${commentId}::${mentionedUserId}`;
}

export async function fetchMentionClassifications(
  inputs: ClassificationKeyInput[],
): Promise<Map<string, MentionClassificationRecord>> {
  if (!inputs.length) {
    return new Map();
  }

  const commentIds = inputs.map((item) => item.commentId);
  const mentionedUserIds = inputs.map((item) => item.mentionedUserId);

  const result = await query<ClassificationRow>(
    `SELECT
       comment_id,
       mentioned_user_id,
       comment_body_hash,
       prompt_version,
       requires_response,
       model,
       raw_response,
       last_evaluated_at
     FROM unanswered_mention_classifications
    WHERE (comment_id, mentioned_user_id) IN (
      SELECT * FROM UNNEST($1::text[], $2::text[])
    )`,
    [commentIds, mentionedUserIds],
  );

  const map = new Map<string, MentionClassificationRecord>();
  result.rows.forEach((row) => {
    const key = buildMentionClassificationKey(
      row.comment_id,
      row.mentioned_user_id,
    );
    map.set(key, {
      commentId: row.comment_id,
      mentionedUserId: row.mentioned_user_id,
      commentBodyHash: row.comment_body_hash,
      promptVersion: row.prompt_version,
      requiresResponse: row.requires_response,
      model: row.model,
      rawResponse: row.raw_response,
      lastEvaluatedAt: row.last_evaluated_at,
    });
  });

  return map;
}

export async function upsertMentionClassification(
  input: MentionClassificationUpsert,
): Promise<void> {
  const promptVersion =
    input.promptVersion ?? UNANSWERED_MENTION_PROMPT_VERSION;
  const evaluatedAt = input.evaluatedAt ?? new Date();

  const rawResponseJson =
    input.rawResponse === undefined
      ? null
      : JSON.stringify(input.rawResponse ?? null);

  await query(
    `INSERT INTO unanswered_mention_classifications (
       comment_id,
       mentioned_user_id,
       comment_body_hash,
       prompt_version,
       requires_response,
       model,
       raw_response,
       last_evaluated_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW(), NOW())
     ON CONFLICT (comment_id, mentioned_user_id)
     DO UPDATE SET
       comment_body_hash = EXCLUDED.comment_body_hash,
       prompt_version = EXCLUDED.prompt_version,
       requires_response = EXCLUDED.requires_response,
       model = EXCLUDED.model,
       raw_response = EXCLUDED.raw_response,
       last_evaluated_at = EXCLUDED.last_evaluated_at,
       updated_at = NOW()`,
    [
      input.commentId,
      input.mentionedUserId,
      input.commentBodyHash,
      promptVersion,
      input.requiresResponse,
      input.model,
      rawResponseJson,
      evaluatedAt.toISOString(),
    ],
  );
}

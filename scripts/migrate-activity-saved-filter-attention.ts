import "@/lib/setup-env";

import { closePool, ensureSchema, query } from "@/lib/db";

type CliOptions = {
  apply: boolean;
  limit: number;
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let apply = false;
  let limit = 20;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
      }
    } else if (arg === "--limit") {
      const value = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(value) && value > 0) {
        limit = value;
        index += 1;
      }
    }
  }

  return { apply, limit };
}

async function preview(limit: number) {
  const result = await query<{
    id: string;
    user_id: string;
    name: string;
    attention: unknown;
    updated_at: string;
  }>(
    `SELECT id, user_id, name, payload->'attention' AS attention, updated_at
     FROM activity_saved_filters
     WHERE payload ? 'attention'
       AND (
         (payload->'attention') ? 'pr_inactive'
         OR (payload->'attention') ? 'pr_open_too_long'
       )
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );

  if (!result.rows.length) {
    console.info("[migration] No saved filters need migration.");
    return;
  }

  console.info(
    `[migration] Previewing ${result.rows.length} saved filter(s) that contain legacy PR attention values:`,
  );
  result.rows.forEach((row) => {
    console.info(
      `- ${row.id} user=${row.user_id} name=${JSON.stringify(row.name)} attention=${JSON.stringify(row.attention)}`,
    );
  });
}

async function applyMigration() {
  const result = await query<{ count: number }>(
    `WITH source AS (
       SELECT
         f.id,
         entry.attention,
         entry.ordinality
       FROM activity_saved_filters f
       CROSS JOIN LATERAL jsonb_array_elements_text(f.payload->'attention') WITH ORDINALITY AS entry(attention, ordinality)
       WHERE f.payload ? 'attention'
         AND (
           (f.payload->'attention') ? 'pr_inactive'
           OR (f.payload->'attention') ? 'pr_open_too_long'
         )
     ),
     mapped AS (
       SELECT
         id,
         ordinality,
         CASE attention
           WHEN 'pr_inactive'
             THEN ARRAY['pr_review_stalled']
           WHEN 'pr_open_too_long'
             THEN ARRAY['pr_review_stalled']
           ELSE ARRAY[attention]
         END AS mapped_values
       FROM source
     ),
     expanded AS (
       SELECT
         id,
         ordinality,
         expanded.attention,
         expanded.subordinality
       FROM mapped
       CROSS JOIN LATERAL unnest(mapped_values) WITH ORDINALITY AS expanded(attention, subordinality)
     ),
     deduped AS (
       SELECT
         id,
         attention,
         MIN(ordinality * 100 + subordinality) AS sort_key
       FROM expanded
       GROUP BY id, attention
     ),
     final AS (
       SELECT
         id,
         jsonb_agg(attention ORDER BY sort_key) AS attention_json
       FROM deduped
       GROUP BY id
     ),
     updated AS (
       UPDATE activity_saved_filters f
       SET payload = jsonb_set(f.payload, '{attention}', final.attention_json, true),
           updated_at = NOW()
       FROM final
       WHERE f.id = final.id
       RETURNING 1
     )
     SELECT COUNT(*)::int AS count FROM updated`,
  );

  const count = result.rows[0]?.count ?? 0;
  console.info(`[migration] Updated ${count} saved filter(s).`);
}

async function main() {
  await ensureSchema();

  const options = parseArgs();

  if (!options.apply) {
    console.info(
      "[migration] Dry run. Pass --apply to update saved filter payloads.",
    );
    await preview(options.limit);
    return;
  }

  await applyMigration();
}

main()
  .catch((error) => {
    console.error("[migration] Failed to migrate saved filters:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch((closeError) => {
      console.error("[migration] Failed to close database pool", closeError);
    });
  });

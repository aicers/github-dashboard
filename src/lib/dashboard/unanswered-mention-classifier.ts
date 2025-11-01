import { normalizeProjectTarget } from "@/lib/activity/base-query";
import {
  fetchUnansweredMentionCandidates,
  type MentionDatasetItem,
  normalizeOrganizationHolidayCodes,
} from "@/lib/dashboard/attention";
import { loadCombinedHolidaySet } from "@/lib/dashboard/business-days";
import {
  buildMentionClassificationKey,
  fetchMentionClassifications,
  type MentionClassificationRecord,
  UNANSWERED_MENTION_PROMPT_VERSION,
  upsertMentionClassification,
} from "@/lib/dashboard/unanswered-mention-classifications";
import { ensureSchema } from "@/lib/db";
import { getSyncConfig, updateSyncConfig } from "@/lib/db/operations";
import { env } from "@/lib/env";
import { emitSyncEvent } from "@/lib/sync/event-bus";

type LogLevel = "info" | "warn" | "error";

type ClassificationLogger = (entry: {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}) => void;

export type MentionClassificationSummary = {
  status: "completed" | "skipped";
  totalCandidates: number;
  attempted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  requiresResponseCount: number;
  notRequiringResponseCount: number;
  errors: number;
  message?: string;
};

export type MentionClassificationOptions = {
  model?: string;
  force?: boolean;
  logger?: ClassificationLogger;
  now?: Date;
};

type EvaluationResult = {
  requiresResponse: boolean;
  raw: unknown;
  model: string;
};

type BatchCandidate = {
  key: string;
  commentBody: string;
  mentionedLogin: string | null;
};

const DEFAULT_MODEL = env.OPENAI_UNANSWERED_MODEL ?? "gpt-4";
const SYSTEM_PROMPT =
  env.OPENAI_UNANSWERED_PROMPT ??
  'You are a GitHub assistant. For each comment, determine whether a user mention is asking for a response or is simply a reference or courtesy. The comment may be written in English or Korean. Respond with only "Yes" or "No".';
const MAX_BATCH_SIZE = 20;
const MAX_COMMENT_CHARS = 1500;
const MENTION_CONTEXT_RADIUS = Math.floor(MAX_COMMENT_CHARS / 2);
const MENTION_PATTERN = /@[A-Za-z0-9_-]+/;

function createSummary(message?: string): MentionClassificationSummary {
  return {
    status: "completed",
    totalCandidates: 0,
    attempted: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    requiresResponseCount: 0,
    notRequiringResponseCount: 0,
    errors: 0,
    message,
  };
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function truncateCommentBody(body: string): string {
  if (body.length <= MAX_COMMENT_CHARS) {
    return body;
  }

  const mentionMatch = body.match(/@[A-Za-z0-9_-]+/);
  if (!mentionMatch || mentionMatch.index === undefined) {
    return `${body.slice(0, Math.max(0, MAX_COMMENT_CHARS - 3))}...`;
  }

  const mentionIndex = mentionMatch.index;
  const halfWindow = MENTION_CONTEXT_RADIUS;
  let start = Math.max(0, mentionIndex - halfWindow);
  let end = Math.min(body.length, mentionIndex + halfWindow);

  if (end - start > MAX_COMMENT_CHARS) {
    start = end - MAX_COMMENT_CHARS;
  }

  if (end - start < MAX_COMMENT_CHARS) {
    const shortfall = MAX_COMMENT_CHARS - (end - start);
    start = Math.max(0, start - Math.floor(shortfall / 2));
    end = Math.min(body.length, end + Math.ceil(shortfall / 2));
  }

  let snippet = body.slice(start, end);
  if (start > 0) {
    snippet = `...${snippet}`;
  }
  if (end < body.length) {
    snippet = `${snippet}...`;
  }

  if (snippet.length > MAX_COMMENT_CHARS) {
    const cut = Math.max(0, MAX_COMMENT_CHARS - 3);
    snippet = `${snippet.slice(0, cut)}...`;
  }

  return snippet;
}

function buildBatchPrompt(candidates: BatchCandidate[]): string {
  const header = [
    `There are ${candidates.length} GitHub comments.`,
    "For each numbered item decide if the mention expects a response (Yes) or is informational (No).",
    'Respond with a JSON array of "Yes" or "No" strings in matching order.',
    "Only output the JSON array.",
    "Comments:",
  ];

  const body = candidates
    .map((candidate, index) => {
      const label = candidate.mentionedLogin
        ? `Mentioned user: ${candidate.mentionedLogin}`
        : "Mentioned user: (unknown)";
      const comment = candidate.commentBody;
      return `${index + 1}. ${label}\nComment: """${comment}"""`;
    })
    .join("\n\n");

  return `${header.join("\n")}\n\n${body}`;
}

function extractJsonArray(value: string): unknown {
  const trimmed = value.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("JSON array not found in OpenAI response.");
  }

  const jsonText = trimmed.slice(start, end + 1);
  return JSON.parse(jsonText);
}

function parseBatchResponse(data: unknown, expectedLength: number): string[] {
  const choices = Array.isArray((data as { choices?: unknown }).choices)
    ? ((data as { choices: Array<{ message?: { content?: string | null } }> })
        .choices ?? [])
    : [];

  const content = choices[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI response did not include message content.");
  }

  let parsed: unknown;
  try {
    parsed = extractJsonArray(content);
  } catch {
    parsed = JSON.parse(content);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Expected JSON array in OpenAI response.");
  }

  if (parsed.length !== expectedLength) {
    throw new Error(
      `Expected ${expectedLength} responses but received ${parsed.length}.`,
    );
  }

  return parsed.map((value, _index) => {
    if (typeof value === "string") {
      return value;
    }
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    return String(value);
  });
}

async function evaluateCandidateBatch(
  candidates: BatchCandidate[],
  model: string,
  logger?: ClassificationLogger,
): Promise<Map<string, EvaluationResult>> {
  if (!candidates.length) {
    return new Map();
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const baseUrl = env.OPENAI_API_BASE_URL?.replace(/\/+$/, "");
  const endpoint = `${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;

  const payload = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildBatchPrompt(candidates),
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger?.({
      level: "error",
      message: "OpenAI request failed",
      meta: {
        status: response.status,
        statusText: response.statusText,
        bodyPreview: text.slice(0, 200),
      },
    });
    throw new Error(
      `OpenAI request failed with status ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const answers = parseBatchResponse(data, candidates.length);

  const results = new Map<string, EvaluationResult>();
  answers.forEach((answer, index) => {
    const normalized = answer.trim().toLowerCase();
    const requiresResponse = normalized.startsWith("y");
    const key = candidates[index]?.key;
    if (key) {
      results.set(key, {
        requiresResponse,
        raw: data,
        model,
      });
    }
  });

  return results;
}

function shouldSkipEvaluation(
  record: MentionClassificationRecord | undefined,
  candidate: MentionDatasetItem,
  force: boolean | undefined,
): boolean {
  if (!record) {
    return false;
  }

  if (force) {
    return false;
  }

  return (
    record.promptVersion === UNANSWERED_MENTION_PROMPT_VERSION &&
    record.commentBodyHash === candidate.commentBodyHash
  );
}

export async function runUnansweredMentionClassification(
  options?: MentionClassificationOptions,
): Promise<MentionClassificationSummary> {
  await ensureSchema();

  const { logger } = options ?? {};
  const model = (options?.model ?? DEFAULT_MODEL).trim();
  const startTime = options?.now ?? new Date();
  const startedIso = startTime.toISOString();

  await updateSyncConfig({
    unansweredMentionsLastStartedAt: startedIso,
    unansweredMentionsLastStatus: "running",
    unansweredMentionsLastError: null,
  });

  emitSyncEvent({
    type: "unanswered-mentions-status",
    status: "running",
    startedAt: startedIso,
  });

  if (!env.OPENAI_API_KEY) {
    const summary = createSummary(
      "OPENAI_API_KEY가 설정되어 있지 않아 분류를 건너뜁니다.",
    );
    summary.status = "skipped";

    await updateSyncConfig({
      unansweredMentionsLastCompletedAt: startedIso,
      unansweredMentionsLastStatus: "skipped",
      unansweredMentionsLastError: summary.message ?? null,
    });

    emitSyncEvent({
      type: "unanswered-mentions-status",
      status: "skipped",
      startedAt: startedIso,
      completedAt: startedIso,
      message: summary.message ?? null,
    });

    return summary;
  }

  const summary = createSummary();
  const now = startTime;

  try {
    const config = await getSyncConfig();
    const excludedUserIds = new Set(normalizeArray(config?.excluded_user_ids));
    const excludedRepositoryIds = new Set(
      normalizeArray(config?.excluded_repository_ids),
    );
    const organizationHolidayCodes =
      normalizeOrganizationHolidayCodes(config) ?? [];
    const organizationHolidaySet = await loadCombinedHolidaySet(
      organizationHolidayCodes,
    );
    const targetProject = normalizeProjectTarget(env.TODO_PROJECT_NAME);

    const candidates = await fetchUnansweredMentionCandidates(
      Array.from(excludedRepositoryIds),
      Array.from(excludedUserIds),
      now,
      organizationHolidayCodes,
      organizationHolidaySet,
      targetProject,
    );

    summary.totalCandidates = candidates.length;
    if (!candidates.length) {
      summary.message = "분류할 응답 없는 멘션이 없습니다.";
      const completedIso = new Date().toISOString();
      await updateSyncConfig({
        unansweredMentionsLastCompletedAt: completedIso,
        unansweredMentionsLastStatus: "success",
        unansweredMentionsLastError: null,
        unansweredMentionsLastSuccessAt: completedIso,
      });
      emitSyncEvent({
        type: "unanswered-mentions-status",
        status: "success",
        startedAt: startedIso,
        completedAt: completedIso,
        successAt: completedIso,
        totals: {
          totalCandidates: summary.totalCandidates,
          attempted: summary.attempted,
          updated: summary.updated,
          errors: summary.errors,
          skipped: summary.skipped,
        },
        message: summary.message,
      });
      return summary;
    }

    const classificationInputs = candidates
      .filter((item) => Boolean(item.targetUserId))
      .map((item) => ({
        commentId: item.commentId,
        mentionedUserId: item.targetUserId as string,
      }));

    const existingMap = await fetchMentionClassifications(classificationInputs);

    const pending: Array<{
      candidate: MentionDatasetItem;
      targetUserId: string;
      key: string;
    }> = [];

    for (const candidate of candidates) {
      const targetUserId = candidate.targetUserId;
      if (!targetUserId) {
        summary.skipped += 1;
        continue;
      }

      if (!candidate.commentBody || !candidate.commentBody.trim()) {
        summary.skipped += 1;
        continue;
      }

      if (!MENTION_PATTERN.test(candidate.commentBody)) {
        summary.skipped += 1;
        logger?.({
          level: "warn",
          message: "Skipping unanswered mention without @username pattern",
          meta: {
            commentId: candidate.commentId,
            mentionedUserId: targetUserId,
          },
        });
        continue;
      }

      const key = buildMentionClassificationKey(
        candidate.commentId,
        targetUserId,
      );
      const existing = existingMap.get(key);

      if (shouldSkipEvaluation(existing, candidate, options?.force)) {
        summary.unchanged += 1;
        if (existing?.requiresResponse) {
          summary.requiresResponseCount += 1;
        } else {
          summary.notRequiringResponseCount += 1;
        }
        continue;
      }

      pending.push({ candidate, targetUserId, key });
    }

    if (!pending.length) {
      if (!summary.message) {
        summary.message = "모든 응답 없는 멘션 분류가 최신 상태입니다.";
      }
      const completedIso = new Date().toISOString();
      await updateSyncConfig({
        unansweredMentionsLastCompletedAt: completedIso,
        unansweredMentionsLastStatus: "success",
        unansweredMentionsLastError: null,
        unansweredMentionsLastSuccessAt: completedIso,
      });
      emitSyncEvent({
        type: "unanswered-mentions-status",
        status: "success",
        startedAt: startedIso,
        completedAt: completedIso,
        successAt: completedIso,
        totals: {
          totalCandidates: summary.totalCandidates,
          attempted: summary.attempted,
          updated: summary.updated,
          errors: summary.errors,
          skipped: summary.skipped,
        },
        message: summary.message,
      });
      return summary;
    }

    summary.attempted = pending.length;

    for (let index = 0; index < pending.length; index += MAX_BATCH_SIZE) {
      const batch = pending.slice(index, index + MAX_BATCH_SIZE);
      const batchInputs = batch.map(({ candidate, key }) => ({
        key,
        commentBody: truncateCommentBody(candidate.commentBody ?? ""),
        mentionedLogin: candidate.mentionedLogin ?? null,
      }));
      const batchCommentIds = batch.map((item) => item.candidate.commentId);

      logger?.({
        level: "info",
        message: "Sending unanswered mention classification batch",
        meta: {
          batchSize: batch.length,
          commentIds: batchCommentIds,
        },
      });

      emitSyncEvent({
        type: "unanswered-mentions-batch",
        status: "queued",
        batchSize: batch.length,
        commentIds: batchCommentIds,
        timestamp: new Date().toISOString(),
      });

      let batchResults: Map<string, EvaluationResult>;
      try {
        batchResults = await evaluateCandidateBatch(batchInputs, model, logger);
      } catch (error) {
        summary.errors += batch.length;
        logger?.({
          level: "error",
          message: "Failed to classify unanswered mention batch",
          meta: {
            commentIds: batchCommentIds,
            error:
              error instanceof Error
                ? error.message
                : "Unknown batch classification error",
          },
        });
        emitSyncEvent({
          type: "unanswered-mentions-batch",
          status: "failed",
          batchSize: batch.length,
          commentIds: batchCommentIds,
          timestamp: new Date().toISOString(),
          error:
            error instanceof Error
              ? error.message
              : "Unknown batch classification error",
        });
        continue;
      }

      emitSyncEvent({
        type: "unanswered-mentions-batch",
        status: "success",
        batchSize: batch.length,
        commentIds: batchCommentIds,
        timestamp: new Date().toISOString(),
      });

      logger?.({
        level: "info",
        message: "Received unanswered mention classification batch",
        meta: {
          batchSize: batch.length,
          commentIds: batchCommentIds,
        },
      });

      for (const item of batch) {
        const result = batchResults.get(item.key);
        if (!result) {
          summary.errors += 1;
          logger?.({
            level: "error",
            message: "Missing classification result for unanswered mention",
            meta: {
              commentId: item.candidate.commentId,
              mentionedUserId: item.targetUserId,
            },
          });
          continue;
        }

        const previous = existingMap.get(item.key);

        await upsertMentionClassification({
          commentId: item.candidate.commentId,
          mentionedUserId: item.targetUserId,
          commentBodyHash: item.candidate.commentBodyHash,
          requiresResponse: result.requiresResponse,
          model: result.model,
          rawResponse: result.raw,
          promptVersion: UNANSWERED_MENTION_PROMPT_VERSION,
          evaluatedAt: now,
        });

        existingMap.set(item.key, {
          commentId: item.candidate.commentId,
          mentionedUserId: item.targetUserId,
          commentBodyHash: item.candidate.commentBodyHash,
          promptVersion: UNANSWERED_MENTION_PROMPT_VERSION,
          requiresResponse: result.requiresResponse,
          model: result.model,
          rawResponse: result.raw,
          lastEvaluatedAt: now.toISOString(),
          manualRequiresResponse: previous?.manualRequiresResponse ?? null,
          manualRequiresResponseAt: previous?.manualRequiresResponseAt ?? null,
        });

        summary.updated += 1;
        if (result.requiresResponse) {
          summary.requiresResponseCount += 1;
        } else {
          summary.notRequiringResponseCount += 1;
        }
      }
    }

    if (!summary.message) {
      summary.message = "응답 없는 멘션 분류를 완료했습니다.";
    }

    const completedIso = new Date().toISOString();
    const statusLabel = summary.errors > 0 ? "partial" : "success";
    const errorMessage = summary.errors
      ? (summary.message ?? `${summary.errors}개 분류에서 오류가 발생했습니다.`)
      : null;

    await updateSyncConfig({
      unansweredMentionsLastCompletedAt: completedIso,
      unansweredMentionsLastStatus: statusLabel,
      unansweredMentionsLastError: errorMessage,
      unansweredMentionsLastSuccessAt:
        summary.errors === 0 ? completedIso : undefined,
    });

    emitSyncEvent({
      type: "unanswered-mentions-status",
      status: statusLabel,
      startedAt: startedIso,
      completedAt: completedIso,
      successAt: summary.errors === 0 ? completedIso : null,
      totals: {
        totalCandidates: summary.totalCandidates,
        attempted: summary.attempted,
        updated: summary.updated,
        errors: summary.errors,
        skipped: summary.skipped,
      },
      message: summary.message,
    });

    return summary;
  } catch (error) {
    const failedIso = new Date().toISOString();
    const errorMessage =
      error instanceof Error
        ? error.message
        : "응답 없는 멘션 분류 중 알 수 없는 오류가 발생했습니다.";

    await updateSyncConfig({
      unansweredMentionsLastCompletedAt: failedIso,
      unansweredMentionsLastStatus: "failed",
      unansweredMentionsLastError: errorMessage,
    });

    emitSyncEvent({
      type: "unanswered-mentions-status",
      status: "failed",
      startedAt: startedIso,
      completedAt: failedIso,
      message: errorMessage,
    });

    logger?.({
      level: "error",
      message: "Unanswered mention classification run failed",
      meta: { error: errorMessage },
    });

    throw error;
  }
}

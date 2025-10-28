import { z } from "zod";

import type {
  ActivityListParams,
  ActivityThresholds,
} from "@/lib/activity/types";

function normalizeStringArray(value: string[] | undefined) {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (!normalized.length) {
    return undefined;
  }

  return Array.from(new Set(normalized));
}

const stringArrayField = z
  .array(z.string().trim())
  .optional()
  .transform(normalizeStringArray);

const positiveIntegerField = z
  .union([z.number(), z.string()])
  .transform((value) => {
    if (typeof value === "number") {
      return value;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  })
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Expected positive integer value.",
  });

const optionalPositiveIntegerField = z
  .union([positiveIntegerField, z.undefined(), z.null()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return undefined;
    }
    return value;
  });

const unansweredMentionThresholdField =
  optionalPositiveIntegerField.superRefine((value, ctx) => {
    if (typeof value === "number" && value < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unanswered mention threshold must be at least 5 days.",
      });
    }
  });

const thresholdsSchema = z
  .object({
    unansweredMentionDays: unansweredMentionThresholdField,
    reviewRequestDays: optionalPositiveIntegerField,
    stalePrDays: optionalPositiveIntegerField,
    idlePrDays: optionalPositiveIntegerField,
    backlogIssueDays: optionalPositiveIntegerField,
    stalledIssueDays: optionalPositiveIntegerField,
  })
  .partial()
  .optional()
  .transform((value) => {
    if (!value) {
      return undefined;
    }

    const entries = Object.entries(value).filter(
      ([, candidate]) =>
        typeof candidate === "number" && Number.isFinite(candidate),
    ) as Array<[keyof ActivityThresholds, number]>;

    if (!entries.length) {
      return undefined;
    }

    return entries.reduce<ActivityThresholds>((accumulator, [key, val]) => {
      accumulator[key] = val;
      return accumulator;
    }, {});
  });

const optionalStringField = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((value) => {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  });

export type ActivityFilterPayload = ActivityListParams;

export const activityFilterPayloadSchema: z.ZodType<ActivityFilterPayload> = z
  .object({
    page: z
      .union([positiveIntegerField, z.undefined(), z.null()])
      .transform((value) => (typeof value === "number" ? value : undefined)),
    perPage: z
      .union([positiveIntegerField, z.undefined(), z.null()])
      .transform((value) => (typeof value === "number" ? value : undefined)),
    types: stringArrayField,
    repositoryIds: stringArrayField,
    labelKeys: stringArrayField,
    issueTypeIds: stringArrayField,
    issuePriorities: stringArrayField,
    issueWeights: stringArrayField,
    milestoneIds: stringArrayField,
    pullRequestStatuses: stringArrayField,
    issueBaseStatuses: stringArrayField,
    authorIds: stringArrayField,
    assigneeIds: stringArrayField,
    reviewerIds: stringArrayField,
    mentionedUserIds: stringArrayField,
    commenterIds: stringArrayField,
    reactorIds: stringArrayField,
    statuses: stringArrayField,
    attention: stringArrayField,
    linkedIssueStates: stringArrayField,
    search: optionalStringField,
    jumpToDate: optionalStringField,
    thresholds: thresholdsSchema,
  })
  .strict()
  .transform((value) => value as ActivityListParams);

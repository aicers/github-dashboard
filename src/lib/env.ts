import "@/lib/logging";

import path from "node:path";

import { z } from "zod";

function coerceOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalEnv(value: string | null | undefined) {
  return coerceOptionalString(value) ?? undefined;
}

const envSchema = z.object({
  GITHUB_TOKEN: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .min(1, "Set GITHUB_TOKEN to call the GitHub GraphQL API.")
      .optional(),
  ),
  GITHUB_ORG: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .min(1, "Set GITHUB_ORG to target an organization for data collection.")
      .optional(),
  ),
  GITHUB_OAUTH_CLIENT_ID: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .min(1, "Set GITHUB_OAUTH_CLIENT_ID to enable GitHub OAuth.")
      .optional(),
  ),
  GITHUB_OAUTH_CLIENT_SECRET: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .min(1, "Set GITHUB_OAUTH_CLIENT_SECRET to enable GitHub OAuth.")
      .optional(),
  ),
  GITHUB_ALLOWED_ORG: z.preprocess(normalizeOptionalEnv, z.string().optional()),
  GITHUB_ALLOWED_BOT_LOGINS: z.preprocess(
    normalizeOptionalEnv,
    z.string().optional(),
  ),
  APP_BASE_URL: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .url(
        "APP_BASE_URL must be an absolute URL (for example https://example.com).",
      )
      .optional(),
  ),
  SESSION_SECRET: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .min(32, "SESSION_SECRET must be at least 32 characters.")
      .optional(),
  ),
  DATABASE_URL: z.preprocess(
    normalizeOptionalEnv,
    z.string().min(1, "Set DATABASE_URL to connect to PostgreSQL.").optional(),
  ),
  SYNC_INTERVAL_MINUTES: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .transform((value) => Number.parseInt(value, 10))
      .optional()
      .pipe(
        z
          .number()
          .int({ message: "SYNC_INTERVAL_MINUTES must be an integer." })
          .positive({ message: "SYNC_INTERVAL_MINUTES must be positive." })
          .optional(),
      ),
  ),
  TODO_PROJECT_NAME: z.preprocess(normalizeOptionalEnv, z.string().optional()),
  DASHBOARD_ADMIN_IDS: z.preprocess(
    normalizeOptionalEnv,
    z.string().optional(),
  ),
  DB_BACKUP_DIRECTORY: z.preprocess(
    normalizeOptionalEnv,
    z.string().optional(),
  ),
  DB_BACKUP_RETENTION: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .transform((value) => Number.parseInt(value, 10))
      .optional()
      .pipe(
        z
          .number()
          .int({ message: "DB_BACKUP_RETENTION must be an integer." })
          .min(1, "DB_BACKUP_RETENTION must be at least 1.")
          .max(10, "DB_BACKUP_RETENTION cannot exceed 10.")
          .optional(),
      ),
  ),
  OPENAI_API_KEY: z.preprocess(normalizeOptionalEnv, z.string().optional()),
  OPENAI_API_BASE_URL: z.preprocess(
    normalizeOptionalEnv,
    z.string().url().optional(),
  ),
  OPENAI_UNANSWERED_MODEL: z.preprocess(
    normalizeOptionalEnv,
    z.string().optional(),
  ),
  OPENAI_UNANSWERED_PROMPT: z.preprocess(
    normalizeOptionalEnv,
    z.string().optional(),
  ),
  ACTIVITY_SAVED_FILTER_LIMIT: z.preprocess(
    normalizeOptionalEnv,
    z
      .string()
      .transform((value) => Number.parseInt(value, 10))
      .optional()
      .pipe(
        z
          .number()
          .int({ message: "ACTIVITY_SAVED_FILTER_LIMIT must be an integer." })
          .min(1, "ACTIVITY_SAVED_FILTER_LIMIT must be at least 1.")
          .optional(),
      ),
  ),
});

const parsed = envSchema.parse({
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_ORG: process.env.GITHUB_ORG,
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID,
  GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  GITHUB_ALLOWED_ORG: process.env.GITHUB_ALLOWED_ORG,
  GITHUB_ALLOWED_BOT_LOGINS: process.env.GITHUB_ALLOWED_BOT_LOGINS,
  APP_BASE_URL: process.env.APP_BASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES,
  TODO_PROJECT_NAME: process.env.TODO_PROJECT_NAME,
  DASHBOARD_ADMIN_IDS: process.env.DASHBOARD_ADMIN_IDS,
  DB_BACKUP_DIRECTORY: process.env.DB_BACKUP_DIRECTORY,
  DB_BACKUP_RETENTION: process.env.DB_BACKUP_RETENTION,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_BASE_URL: process.env.OPENAI_API_BASE_URL,
  OPENAI_UNANSWERED_MODEL: process.env.OPENAI_UNANSWERED_MODEL,
  OPENAI_UNANSWERED_PROMPT: process.env.OPENAI_UNANSWERED_PROMPT,
  ACTIVITY_SAVED_FILTER_LIMIT: process.env.ACTIVITY_SAVED_FILTER_LIMIT,
});

const defaultBackupDirectory = path.resolve(process.cwd(), "backups");
const resolvedBackupDirectory = parsed.DB_BACKUP_DIRECTORY
  ? path.isAbsolute(parsed.DB_BACKUP_DIRECTORY)
    ? parsed.DB_BACKUP_DIRECTORY
    : path.resolve(process.cwd(), parsed.DB_BACKUP_DIRECTORY)
  : defaultBackupDirectory;

export const env = {
  ...parsed,
  SYNC_INTERVAL_MINUTES: parsed.SYNC_INTERVAL_MINUTES ?? 60,
  TODO_PROJECT_NAME: coerceOptionalString(parsed.TODO_PROJECT_NAME),
  DASHBOARD_ADMIN_IDS: parsed.DASHBOARD_ADMIN_IDS
    ? parsed.DASHBOARD_ADMIN_IDS.split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [],
  DB_BACKUP_DIRECTORY: resolvedBackupDirectory,
  DB_BACKUP_RETENTION: parsed.DB_BACKUP_RETENTION ?? 3,
  OPENAI_API_KEY: coerceOptionalString(parsed.OPENAI_API_KEY),
  OPENAI_API_BASE_URL: coerceOptionalString(parsed.OPENAI_API_BASE_URL),
  OPENAI_UNANSWERED_MODEL: coerceOptionalString(parsed.OPENAI_UNANSWERED_MODEL),
  OPENAI_UNANSWERED_PROMPT: coerceOptionalString(
    parsed.OPENAI_UNANSWERED_PROMPT,
  ),
  GITHUB_ALLOWED_BOT_LOGINS: parsed.GITHUB_ALLOWED_BOT_LOGINS
    ? parsed.GITHUB_ALLOWED_BOT_LOGINS.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    : [],
  ACTIVITY_SAVED_FILTER_LIMIT: parsed.ACTIVITY_SAVED_FILTER_LIMIT ?? 30,
};

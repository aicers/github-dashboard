import { z } from "zod";

function coerceOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const envSchema = z.object({
  GITHUB_TOKEN: z
    .string()
    .min(1, "Set GITHUB_TOKEN to call the GitHub GraphQL API.")
    .optional(),
  GITHUB_ORG: z
    .string()
    .min(1, "Set GITHUB_ORG to target an organization for data collection.")
    .optional(),
  GITHUB_OAUTH_CLIENT_ID: z
    .string()
    .min(1, "Set GITHUB_OAUTH_CLIENT_ID to enable GitHub OAuth.")
    .optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z
    .string()
    .min(1, "Set GITHUB_OAUTH_CLIENT_SECRET to enable GitHub OAuth.")
    .optional(),
  GITHUB_ALLOWED_ORG: z.string().optional(),
  APP_BASE_URL: z
    .string()
    .url(
      "APP_BASE_URL must be an absolute URL (for example https://example.com).",
    )
    .optional(),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters.")
    .optional(),
  DATABASE_URL: z
    .string()
    .min(1, "Set DATABASE_URL to connect to PostgreSQL.")
    .optional(),
  SYNC_INTERVAL_MINUTES: z
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
  TODO_PROJECT_NAME: z.string().optional(),
  HOLIDAYS: z.string().optional(),
  DASHBOARD_ADMIN_IDS: z.string().optional(),
  ACTIVITY_PREFETCH_PAGES: z
    .string()
    .transform((value) => Number.parseInt(value, 10))
    .optional()
    .pipe(
      z
        .number()
        .int({ message: "ACTIVITY_PREFETCH_PAGES must be an integer." })
        .min(1, { message: "ACTIVITY_PREFETCH_PAGES must be at least 1." })
        .max(10, { message: "ACTIVITY_PREFETCH_PAGES must be at most 10." })
        .optional(),
    ),
  ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS: z
    .string()
    .transform((value) => Number.parseInt(value, 10))
    .optional()
    .pipe(
      z
        .number()
        .int({
          message: "ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS must be an integer.",
        })
        .positive({
          message: "ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS must be positive.",
        })
        .optional(),
    ),
  ACTIVITY_PREFETCH_TOKEN_SECRET: z.string().optional(),
});

const parsed = envSchema.parse({
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_ORG: process.env.GITHUB_ORG,
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID,
  GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  GITHUB_ALLOWED_ORG: process.env.GITHUB_ALLOWED_ORG,
  APP_BASE_URL: process.env.APP_BASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES,
  TODO_PROJECT_NAME: process.env.TODO_PROJECT_NAME,
  HOLIDAYS: process.env.HOLIDAYS,
  DASHBOARD_ADMIN_IDS: process.env.DASHBOARD_ADMIN_IDS,
  ACTIVITY_PREFETCH_PAGES: process.env.ACTIVITY_PREFETCH_PAGES,
  ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS:
    process.env.ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS,
  ACTIVITY_PREFETCH_TOKEN_SECRET: process.env.ACTIVITY_PREFETCH_TOKEN_SECRET,
});

export const env = {
  ...parsed,
  SYNC_INTERVAL_MINUTES: parsed.SYNC_INTERVAL_MINUTES ?? 60,
  TODO_PROJECT_NAME: coerceOptionalString(parsed.TODO_PROJECT_NAME),
  HOLIDAYS: parsed.HOLIDAYS
    ? parsed.HOLIDAYS.split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [],
  DASHBOARD_ADMIN_IDS: parsed.DASHBOARD_ADMIN_IDS
    ? parsed.DASHBOARD_ADMIN_IDS.split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [],
  ACTIVITY_PREFETCH_PAGES:
    typeof parsed.ACTIVITY_PREFETCH_PAGES === "number"
      ? Math.max(1, Math.min(10, parsed.ACTIVITY_PREFETCH_PAGES))
      : null,
  ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS:
    parsed.ACTIVITY_PREFETCH_TOKEN_TTL_SECONDS ?? 300,
  ACTIVITY_PREFETCH_TOKEN_SECRET: coerceOptionalString(
    parsed.ACTIVITY_PREFETCH_TOKEN_SECRET,
  ),
};

import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z
    .string()
    .min(1, "Set GITHUB_TOKEN to call the GitHub GraphQL API.")
    .optional(),
  GITHUB_ORG: z
    .string()
    .min(1, "Set GITHUB_ORG to target an organization for data collection.")
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
});

const parsed = envSchema.parse({
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_ORG: process.env.GITHUB_ORG,
  DATABASE_URL: process.env.DATABASE_URL,
  SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES,
});

export const env = {
  ...parsed,
  SYNC_INTERVAL_MINUTES: parsed.SYNC_INTERVAL_MINUTES ?? 60,
};

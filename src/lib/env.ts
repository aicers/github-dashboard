import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z
    .string()
    .min(1, "Set GITHUB_TOKEN to call the GitHub GraphQL API.")
    .optional(),
});

const parsed = envSchema.parse({
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
});

export const env = parsed;

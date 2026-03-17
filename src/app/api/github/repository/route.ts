import { NextResponse } from "next/server";
import { z } from "zod";

import {
  consumeRateLimit,
  createRetryAfterHeaders,
} from "@/lib/api/rate-limit";
import { authenticatedRoute } from "@/lib/api/route-handler";
import { fetchRepositorySummary } from "@/lib/github";

const requestSchema = z.object({
  owner: z.string().min(1, "Owner is required."),
  name: z.string().min(1, "Repository name is required."),
});

export const GITHUB_REPOSITORY_RATE_LIMIT_MAX_REQUESTS = 20;
export const GITHUB_REPOSITORY_RATE_LIMIT_WINDOW_MS = 60_000;

export const POST = authenticatedRoute(async (request, session) => {
  const rateLimit = consumeRateLimit({
    scope: "github-repository",
    key: session.userId,
    limit: GITHUB_REPOSITORY_RATE_LIMIT_MAX_REQUESTS,
    windowMs: GITHUB_REPOSITORY_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Too many repository lookup requests. Please try again shortly.",
      },
      {
        status: 429,
        headers: createRetryAfterHeaders(rateLimit.retryAfterSeconds),
      },
    );
  }

  try {
    const payload = await request.json();
    const { owner, name } = requestSchema.parse(payload);
    const repository = await fetchRepositorySummary(owner, name);

    return NextResponse.json({ success: true, repository });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid request payload.",
          issues: error.issues,
        },
        { status: 400 },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, message: "Unexpected error while contacting GitHub." },
      { status: 500 },
    );
  }
});

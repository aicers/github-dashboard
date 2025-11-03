import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type TestingExports = {
  evaluateCandidateBatch: (
    candidates: Array<{
      key: string;
      commentBody: string;
      mentionedLogin: string | null;
    }>,
    model: string,
    logger?: (entry: {
      level: "info" | "warn" | "error";
      message: string;
      meta?: Record<string, unknown>;
    }) => void,
  ) => Promise<
    Map<string, { requiresResponse: boolean; raw: unknown; model: string }>
  >;
};

let testing: TestingExports;

beforeAll(async () => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  const module = await import("@/lib/dashboard/unanswered-mention-classifier");
  testing = module.__testing as TestingExports;
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

const successResponsePayload = {
  choices: [
    {
      message: {
        content: '["Yes"]',
      },
    },
  ],
};

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("evaluateCandidateBatch", () => {
  const candidates = [
    {
      key: "comment-1",
      commentBody: "Hello @octocat",
      mentionedLogin: "octocat",
    },
  ];

  it("retries on transient server errors and eventually succeeds", async () => {
    const logger = vi.fn();
    const errorResponses = [
      new Response("server error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
      new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }),
    ];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          errorResponses.shift() ?? createJsonResponse(successResponsePayload),
      );

    const evaluatePromise = testing.evaluateCandidateBatch(
      candidates,
      "gpt-4",
      logger,
    );

    await vi.runAllTimersAsync();
    const results = await evaluatePromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results.get("comment-1")?.requiresResponse).toBe(true);

    const warnCalls = logger.mock.calls.filter(
      ([entry]) => entry.level === "warn",
    );
    expect(warnCalls).toHaveLength(2);
    expect(warnCalls[0][0].meta).toMatchObject({ attempt: 1 });
    expect(warnCalls[1][0].meta).toMatchObject({ attempt: 2 });
  });

  it("waits for the retry-after delay when rate limited", async () => {
    const logger = vi.fn();
    let callCount = 0;

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return new Response("rate limited", {
            status: 429,
            statusText: "Too Many Requests",
            headers: { "retry-after": "2" },
          });
        }

        return createJsonResponse(successResponsePayload);
      });

    const evaluatePromise = testing.evaluateCandidateBatch(
      candidates,
      "gpt-4",
      logger,
    );

    await vi.advanceTimersByTimeAsync(2000);
    const results = await evaluatePromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.get("comment-1")?.requiresResponse).toBe(true);

    const warnCalls = logger.mock.calls.filter(
      ([entry]) => entry.level === "warn",
    );
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][0].meta).toMatchObject({ delayMs: 2000 });
  });
});

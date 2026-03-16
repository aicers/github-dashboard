// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

describe("GitHubTestPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects production requests with notFound", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const GitHubTestPage = (await import("./page")).default;

    await expect(GitHubTestPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});

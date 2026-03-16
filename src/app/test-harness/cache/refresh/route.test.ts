// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureActivityCaches } from "@/lib/activity/cache";

vi.mock("@/lib/activity/cache", () => ({
  ensureActivityCaches: vi.fn(),
}));

const ensureActivityCachesMock = vi.mocked(ensureActivityCaches);

describe("test harness cache refresh route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 for GET requests in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false });
    expect(ensureActivityCachesMock).not.toHaveBeenCalled();
  });

  it("returns 404 for POST requests in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("./route");

    const response = await POST();

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false });
    expect(ensureActivityCachesMock).not.toHaveBeenCalled();
  });
});

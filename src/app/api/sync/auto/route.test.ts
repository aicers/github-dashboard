import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/auto/route";
import { disableAutomaticSync, enableAutomaticSync } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  enableAutomaticSync: vi.fn(),
  disableAutomaticSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sync/auto", () => {
  it("enables automatic sync with optional interval", async () => {
    const result = {
      since: null,
      until: null,
      startedAt: "2024-05-01T00:00:00.000Z",
      completedAt: "2024-05-01T00:10:00.000Z",
      summary: {
        repositoriesProcessed: 1,
        counts: {
          issues: 0,
          pullRequests: 0,
          reviews: 0,
          comments: 0,
        },
        timestamps: {
          repositories: null,
          issues: null,
          pullRequests: null,
          reviews: null,
          comments: null,
        },
      },
    } satisfies Awaited<ReturnType<typeof enableAutomaticSync>>;
    vi.mocked(enableAutomaticSync).mockResolvedValueOnce(result);

    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 45 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      action: "enabled",
      result,
    });
    expect(enableAutomaticSync).toHaveBeenCalledWith({
      intervalMinutes: 45,
      logger: expect.any(Function),
    });
    expect(disableAutomaticSync).not.toHaveBeenCalled();
  });

  it("disables automatic sync when enabled is false", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, action: "disabled" });
    expect(disableAutomaticSync).toHaveBeenCalledTimes(1);
    expect(enableAutomaticSync).not.toHaveBeenCalled();
  });

  it("returns 400 when payload is invalid", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/auto", {
        method: "POST",
        body: JSON.stringify({ enabled: true, intervalMinutes: 0 }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(enableAutomaticSync).not.toHaveBeenCalled();
    expect(disableAutomaticSync).not.toHaveBeenCalled();
  });
});

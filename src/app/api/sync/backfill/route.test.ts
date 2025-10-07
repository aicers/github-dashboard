import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/backfill/route";
import { runBackfill } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  runBackfill: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sync/backfill", () => {
  it("runs a backfill and returns the result", async () => {
    const report = { startDate: "2024-04-01", chunkCount: 2 };
    vi.mocked(runBackfill).mockResolvedValueOnce(report as never);

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, result: report });
    expect(runBackfill).toHaveBeenCalledWith(
      "2024-04-01",
      expect.any(Function),
    );
  });

  it("returns validation errors for invalid payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(runBackfill).not.toHaveBeenCalled();
  });

  it("returns 400 if runBackfill throws a known error", async () => {
    vi.mocked(runBackfill).mockRejectedValueOnce(new Error("Backfill failure"));

    const response = await POST(
      new Request("http://localhost/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ startDate: "2024-04-01" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      success: false,
      message: "Backfill failure",
    });
  });
});

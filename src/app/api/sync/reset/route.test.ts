import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/sync/reset/route";
import { resetData } from "@/lib/sync/service";

vi.mock("@/lib/sync/service", () => ({
  resetData: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sync/reset", () => {
  it("resets data with default preserveLogs value", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(resetData).toHaveBeenCalledWith({ preserveLogs: true });
  });

  it("resets data with provided preserveLogs flag", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({ preserveLogs: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(resetData).toHaveBeenCalledWith({ preserveLogs: false });
  });

  it("returns a validation error response when payload is invalid", async () => {
    const response = await POST(
      new Request("http://localhost/api/sync/reset", {
        method: "POST",
        body: JSON.stringify({ preserveLogs: "nope" }),
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(resetData).not.toHaveBeenCalled();
  });
});

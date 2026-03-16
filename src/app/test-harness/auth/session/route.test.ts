// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { establishSession } from "@/lib/auth/session";
import { ensureSchema } from "@/lib/db";
import { upsertUser } from "@/lib/db/operations";

vi.mock("@/lib/auth/session", () => ({
  establishSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  ensureSchema: vi.fn(),
}));

vi.mock("@/lib/db/operations", () => ({
  upsertUser: vi.fn(),
}));

const establishSessionMock = vi.mocked(establishSession);
const ensureSchemaMock = vi.mocked(ensureSchema);
const upsertUserMock = vi.mocked(upsertUser);

describe("GET /test-harness/auth/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("./route");

    const response = await GET(
      new Request("http://localhost/test-harness/auth/session"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ success: false });
    expect(ensureSchemaMock).not.toHaveBeenCalled();
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(establishSessionMock).not.toHaveBeenCalled();
  });
});

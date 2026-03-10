import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkReauthRequired } from "@/lib/auth/reauth-guard";
import type { ActiveSession } from "@/lib/auth/session";
import { readActiveSession } from "@/lib/auth/session";

import { adminRoute, authenticatedRoute } from "./route-handler";

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: vi.fn(),
}));

vi.mock("@/lib/auth/reauth-guard", () => ({
  checkReauthRequired: vi.fn(async () => false),
}));

function buildSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: "session-id",
    userId: "user-1",
    orgSlug: "org",
    orgVerified: true,
    isAdmin: false,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 3600_000),
    refreshExpiresAt: new Date(Date.now() + 3600_000),
    maxExpiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    lastReauthAt: new Date(),
    deviceId: "device-1",
    ipCountry: "KR",
    ...overrides,
  };
}

const mockSession = buildSession();
const adminSession = buildSession({ isAdmin: true });

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- authenticatedRoute ----

describe("authenticatedRoute", () => {
  it("returns 401 when there is no active session", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(null);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = authenticatedRoute(handler);

    const response = await route(new Request("http://localhost/test"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with request and session when authenticated", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(mockSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = authenticatedRoute(handler);

    const request = new Request("http://localhost/test");
    const response = await route(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request, mockSession, undefined);
  });

  it("passes context to the handler for parameterized routes", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(mockSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = authenticatedRoute<{ id: string }>(handler);

    const request = new Request("http://localhost/test/123");
    const context = { params: Promise.resolve({ id: "123" }) };
    const response = await route(request, context);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request, mockSession, context);
  });

  it("propagates the handler's response", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(mockSession);
    const route = authenticatedRoute(async () =>
      Response.json({ data: "value" }, { status: 201 }),
    );

    const response = await route(new Request("http://localhost/test"));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: "value" });
  });
});

// ---- adminRoute ----

describe("adminRoute", () => {
  it("returns 401 when there is no active session", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(null);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute(handler);

    const response = await route(
      new NextRequest("http://localhost/test", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      message: "Authentication required.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the session is not admin", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(mockSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute(handler);

    const response = await route(
      new NextRequest("http://localhost/test", { method: "POST" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      message: "Administrator access is required.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when the session is admin", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute(handler);

    const request = new NextRequest("http://localhost/test", {
      method: "POST",
    });
    const response = await route(request);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request, adminSession, undefined);
  });

  it("passes context to the handler for parameterized routes", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute<{ id: string }>(handler);

    const request = new NextRequest("http://localhost/test/123", {
      method: "POST",
    });
    const context = { params: Promise.resolve({ id: "123" }) };
    const response = await route(request, context);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request, adminSession, context);
  });

  it("does not check reauth when no reauthAction is given", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute(handler);

    await route(new NextRequest("http://localhost/test", { method: "POST" }));

    expect(checkReauthRequired).not.toHaveBeenCalled();
  });
});

// ---- adminRoute with reauthAction ----

describe("adminRoute with reauthAction", () => {
  it("returns 428 when reauthentication is required", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    vi.mocked(checkReauthRequired).mockResolvedValue(true);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute("some_action", handler);

    const response = await route(
      new NextRequest("http://localhost/test", { method: "POST" }),
    );

    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({
      success: false,
      message: "Reauthentication required.",
      reauthRequired: true,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler when reauth is not required", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    vi.mocked(checkReauthRequired).mockResolvedValue(false);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute("some_action", handler);

    const request = new NextRequest("http://localhost/test", {
      method: "POST",
    });
    const response = await route(request);

    expect(response.status).toBe(200);
    expect(checkReauthRequired).toHaveBeenCalledWith(
      request,
      adminSession,
      "some_action",
    );
    expect(handler).toHaveBeenCalledWith(request, adminSession, undefined);
  });

  it("passes context to the handler for parameterized routes with reauth", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(adminSession);
    vi.mocked(checkReauthRequired).mockResolvedValue(false);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute<{ id: string }>("restore_action", handler);

    const request = new NextRequest("http://localhost/test/42", {
      method: "POST",
    });
    const context = { params: Promise.resolve({ id: "42" }) };
    const response = await route(request, context);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(request, adminSession, context);
  });

  it("still returns 401 when no session even with reauthAction", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(null);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute("some_action", handler);

    const response = await route(
      new NextRequest("http://localhost/test", { method: "POST" }),
    );

    expect(response.status).toBe(401);
  });

  it("still returns 403 when non-admin even with reauthAction", async () => {
    vi.mocked(readActiveSession).mockResolvedValue(mockSession);
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const route = adminRoute("some_action", handler);

    const response = await route(
      new NextRequest("http://localhost/test", { method: "POST" }),
    );

    expect(response.status).toBe(403);
    expect(checkReauthRequired).not.toHaveBeenCalled();
  });
});

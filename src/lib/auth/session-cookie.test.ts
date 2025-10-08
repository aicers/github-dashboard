import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    SESSION_SECRET: "a".repeat(32),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("session cookie helpers", () => {
  test("generateSessionId produces a URL-safe identifier", async () => {
    const { generateSessionId } = await import("./session-cookie");

    const id = generateSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.length).toBeGreaterThanOrEqual(10);
  });

  test("encodeSessionCookie signs and decodeSessionCookie validates the signature", async () => {
    const { encodeSessionCookie, decodeSessionCookie } = await import(
      "./session-cookie"
    );

    const encoded = encodeSessionCookie("session-id");
    expect(encoded.includes(".")).toBe(true);
    expect(decodeSessionCookie(encoded)).toBe("session-id");
  });

  test("decodeSessionCookie returns null when signature is tampered", async () => {
    const { encodeSessionCookie, decodeSessionCookie } = await import(
      "./session-cookie"
    );

    const encoded = encodeSessionCookie("session-id");
    const tampered = encoded.replace(/.$/, (char) =>
      char === "a" ? "b" : "a",
    );

    expect(decodeSessionCookie(tampered)).toBeNull();
  });

  test("decodeSessionCookie returns null for malformed values", async () => {
    const { decodeSessionCookie } = await import("./session-cookie");
    expect(decodeSessionCookie("no-signature")).toBeNull();
  });

  test("buildSessionCookie sets secure defaults", async () => {
    const {
      buildSessionCookie,
      SESSION_COOKIE_NAME,
      SESSION_COOKIE_MAX_AGE_SECONDS,
    } = await import("./session-cookie");

    const cookie = buildSessionCookie("session-id");

    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBe(SESSION_COOKIE_MAX_AGE_SECONDS);
  });

  test("buildClearedSessionCookie expires immediately", async () => {
    const { buildClearedSessionCookie, SESSION_COOKIE_NAME } = await import(
      "./session-cookie"
    );

    const cookie = buildClearedSessionCookie();
    expect(cookie.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.value).toBe("");
  });
});

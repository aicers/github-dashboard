import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDeviceCookie,
  generateDeviceId,
  readDeviceIdFromRequest,
} from "@/lib/auth/device-cookie";

describe("device cookie helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("generates a url-safe device id", () => {
    const id = generateDeviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id.length).toBeGreaterThan(20);
  });

  it("builds secure cookies in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cookie = buildDeviceCookie("device-1");
    expect(cookie.options.secure).toBe(true);
  });

  it("reads the device id from request cookies", () => {
    const request = new NextRequest("http://localhost", {
      headers: { cookie: "gd_device=device-xyz" },
    });
    expect(readDeviceIdFromRequest(request)).toBe("device-xyz");
  });

  it("returns null when the device cookie is missing", () => {
    const request = new NextRequest("http://localhost");
    expect(readDeviceIdFromRequest(request)).toBeNull();
  });
});

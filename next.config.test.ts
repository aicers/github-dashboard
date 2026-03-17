import { describe, expect, it } from "vitest";

import nextConfig, {
  buildSecurityHeadersConfig,
  SECURITY_HEADERS,
  SECURITY_HEADERS_SOURCE,
} from "./next.config";

describe("next.config security headers", () => {
  it("applies the security header policy to every route", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toEqual(buildSecurityHeadersConfig());
    expect(headers).toEqual([
      {
        source: SECURITY_HEADERS_SOURCE,
        headers: SECURITY_HEADERS,
      },
    ]);
  });

  it("defines the expected baseline hardening headers", () => {
    const headerMap = new Map(
      SECURITY_HEADERS.map((header) => [header.key, header.value]),
    );

    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headerMap.get("X-Frame-Options")).toBe("DENY");
    expect(headerMap.get("Permissions-Policy")).toBe(
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );
    expect(headerMap.has("Content-Security-Policy")).toBe(false);
  });

  it("removes the x-powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

import type { NextConfig } from "next";

export const SECURITY_HEADERS_SOURCE = "/:path*";

const PERMISSIONS_POLICY_DIRECTIVES = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
];

export const SECURITY_HEADERS = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Permissions-Policy",
    value: PERMISSIONS_POLICY_DIRECTIVES.join(", "),
  },
];

export function buildSecurityHeadersConfig() {
  return [
    {
      source: SECURITY_HEADERS_SOURCE,
      headers: SECURITY_HEADERS,
    },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typedRoutes: true,
  poweredByHeader: false,
  async headers() {
    return buildSecurityHeadersConfig();
  },
};

export default nextConfig;

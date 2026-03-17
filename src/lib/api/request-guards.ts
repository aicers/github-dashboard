import { env } from "@/lib/env";

export const CROSS_ORIGIN_MUTATION_MESSAGE =
  "Cross-origin state-changing requests are not allowed.";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const TRUSTED_FETCH_SITES = new Set(["same-origin", "none"]);

export function isStateChangingMethod(method: string) {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

function extractOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveTrustedOrigins(request: Request) {
  const origins = new Set<string>();

  try {
    origins.add(new URL(request.url).origin);
  } catch {
    // Ignore malformed URLs and fall back to APP_BASE_URL when available.
  }

  const configuredOrigin = extractOrigin(env.APP_BASE_URL ?? null);
  if (configuredOrigin) {
    origins.add(configuredOrigin);
  }

  return origins;
}

export function getMutationRequestViolation(request: Request) {
  if (!isStateChangingMethod(request.method)) {
    return null;
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && !TRUSTED_FETCH_SITES.has(fetchSite)) {
    return CROSS_ORIGIN_MUTATION_MESSAGE;
  }

  const trustedOrigins = resolveTrustedOrigins(request);
  const origin = extractOrigin(request.headers.get("origin"));
  if (origin && !trustedOrigins.has(origin)) {
    return CROSS_ORIGIN_MUTATION_MESSAGE;
  }

  const refererOrigin = extractOrigin(request.headers.get("referer"));
  if (!origin && refererOrigin && !trustedOrigins.has(refererOrigin)) {
    return CROSS_ORIGIN_MUTATION_MESSAGE;
  }

  return null;
}

import { cookies } from "next/headers";

import { getAuthConfig } from "@/lib/auth/config";
import { readDeviceIdFromHeaders } from "@/lib/auth/device-cookie";
import { readIpCountryFromHeaders } from "@/lib/auth/ip-country";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  decodeSessionCookie,
  generateSessionId,
  SESSION_COOKIE_NAME,
} from "@/lib/auth/session-cookie";
import {
  createSessionRecord,
  deleteSessionRecord,
  pruneExpiredSessions,
  refreshSessionRecord,
  type SessionRecord,
  updateSessionMetadata,
} from "@/lib/auth/session-store";

export type ActiveSession = SessionRecord;

type EstablishSessionOptions = {
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
  isAdmin: boolean;
  deviceId: string | null;
  ipCountry: string | null;
};

const SESSION_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

let lastPruneTimestamp = 0;
let prunePromise: Promise<void> | null = null;

async function maybePruneExpiredSessions() {
  const now = Date.now();

  if (!prunePromise && now - lastPruneTimestamp >= SESSION_PRUNE_INTERVAL_MS) {
    prunePromise = pruneExpiredSessions()
      .catch((error) => {
        console.error("Failed to prune expired sessions:", error);
      })
      .finally(() => {
        lastPruneTimestamp = Date.now();
        prunePromise = null;
      });
  }

  if (prunePromise) {
    await prunePromise;
  }
}

export async function establishSession({
  userId,
  orgSlug,
  orgVerified,
  isAdmin,
  deviceId,
  ipCountry,
}: EstablishSessionOptions): Promise<{
  record: SessionRecord;
  cookie: ReturnType<typeof buildSessionCookie>;
}> {
  const config = await getAuthConfig();
  const accessTtlSeconds = Math.max(1, config.accessTtlMinutes) * 60;
  const refreshTtlSeconds = Math.max(1, config.refreshTtlDays) * 24 * 60 * 60;
  const maxLifetimeSeconds = Math.max(1, config.maxLifetimeDays) * 24 * 60 * 60;

  const sessionId = generateSessionId();
  const record = await createSessionRecord({
    sessionId,
    userId,
    orgSlug,
    orgVerified,
    isAdmin,
    accessTtlSeconds,
    refreshTtlSeconds,
    maxLifetimeSeconds,
    deviceId,
    ipCountry,
  });

  return {
    record,
    cookie: buildSessionCookie(sessionId, {
      maxAgeSeconds: maxLifetimeSeconds,
    }),
  };
}

export async function readActiveSession(): Promise<ActiveSession | null> {
  await maybePruneExpiredSessions();

  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionId = decodeSessionCookie(raw);
  if (!sessionId) {
    return null;
  }

  const config = await getAuthConfig();
  const accessTtlSeconds = Math.max(1, config.accessTtlMinutes) * 60;
  const idleTtlSeconds = Math.max(1, config.idleTtlMinutes) * 60;
  const refreshTtlSeconds = Math.max(1, config.refreshTtlDays) * 24 * 60 * 60;
  const record = await refreshSessionRecord(sessionId, {
    accessTtlSeconds,
    refreshTtlSeconds,
    idleTtlSeconds,
  });

  if (!record || !record.orgVerified) {
    // Clean up expired/invalid sessions to avoid reusing stale identifiers.
    await deleteSessionRecord(sessionId);
    return null;
  }

  const deviceId = await readDeviceIdFromHeaders();
  const ipCountry = await readIpCountryFromHeaders();
  if ((!record.deviceId && deviceId) || (!record.ipCountry && ipCountry)) {
    const nextDeviceId = record.deviceId ?? deviceId;
    const nextIpCountry = record.ipCountry ?? ipCountry;
    await updateSessionMetadata(sessionId, {
      deviceId: nextDeviceId,
      ipCountry: nextIpCountry,
    });
    record.deviceId = nextDeviceId ?? null;
    record.ipCountry = nextIpCountry ?? null;
  }

  return record;
}

export async function destroySessionCookie(): Promise<
  ReturnType<typeof buildClearedSessionCookie>
> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionId = decodeSessionCookie(raw);
  if (!sessionId) {
    return buildClearedSessionCookie();
  }

  await deleteSessionRecord(sessionId);
  return buildClearedSessionCookie();
}

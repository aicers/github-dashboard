import { cookies } from "next/headers";

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
} from "@/lib/auth/session-store";

export type ActiveSession = SessionRecord;

type EstablishSessionOptions = {
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
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
}: EstablishSessionOptions): Promise<{
  record: SessionRecord;
  cookie: ReturnType<typeof buildSessionCookie>;
}> {
  const sessionId = generateSessionId();
  const record = await createSessionRecord({
    sessionId,
    userId,
    orgSlug,
    orgVerified,
  });

  return {
    record,
    cookie: buildSessionCookie(sessionId),
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

  const record = await refreshSessionRecord(sessionId);

  if (!record || !record.orgVerified) {
    // Clean up expired/invalid sessions to avoid reusing stale identifiers.
    await deleteSessionRecord(sessionId);
    return null;
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

import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";

const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours

export type SessionRecord = {
  id: string;
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
  isAdmin: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
};

type CreateSessionOptions = {
  sessionId: string;
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
  isAdmin: boolean;
};

function mapRow(row: {
  id: string;
  user_id: string;
  org_slug: string | null;
  org_verified: boolean;
  is_admin: boolean;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    orgSlug: row.org_slug,
    orgVerified: row.org_verified,
    isAdmin: row.is_admin,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
  };
}

export async function createSessionRecord({
  sessionId,
  userId,
  orgSlug,
  orgVerified,
  isAdmin,
}: CreateSessionOptions): Promise<SessionRecord> {
  await ensureSchema();

  const { rows } = await query<{
    id: string;
    user_id: string;
    org_slug: string | null;
    org_verified: boolean;
    is_admin: boolean;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
  }>(
    `INSERT INTO auth_sessions (id, user_id, org_slug, org_verified, is_admin, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
     RETURNING id, user_id, org_slug, org_verified, is_admin, created_at, last_seen_at, expires_at`,
    [
      sessionId,
      userId,
      orgSlug,
      orgVerified,
      isAdmin,
      SESSION_DURATION_SECONDS,
    ],
  );

  return mapRow(rows[0]);
}

export async function refreshSessionRecord(
  sessionId: string,
): Promise<SessionRecord | null> {
  await ensureSchema();

  const { rows } = await query<{
    id: string;
    user_id: string;
    org_slug: string | null;
    org_verified: boolean;
    is_admin: boolean;
    created_at: string;
    last_seen_at: string;
    expires_at: string;
  }>(
    `UPDATE auth_sessions
       SET last_seen_at = NOW(),
           expires_at = NOW() + ($2 || ' seconds')::interval
     WHERE id = $1 AND expires_at > NOW()
     RETURNING id, user_id, org_slug, org_verified, is_admin, created_at, last_seen_at, expires_at`,
    [sessionId, SESSION_DURATION_SECONDS],
  );

  if (rows.length === 0) {
    return null;
  }

  return mapRow(rows[0]);
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
  await ensureSchema();
  await query("DELETE FROM auth_sessions WHERE id = $1", [sessionId]);
}

export async function pruneExpiredSessions(): Promise<void> {
  await ensureSchema();
  await query("DELETE FROM auth_sessions WHERE expires_at < NOW()");
}

import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";

export type SessionRecord = {
  id: string;
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
  isAdmin: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  refreshExpiresAt: Date;
  maxExpiresAt: Date;
  lastReauthAt: Date | null;
  deviceId: string | null;
  ipCountry: string | null;
};

type CreateSessionOptions = {
  sessionId: string;
  userId: string;
  orgSlug: string | null;
  orgVerified: boolean;
  isAdmin: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  maxLifetimeSeconds: number;
  deviceId: string | null;
  ipCountry: string | null;
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
  refresh_expires_at: string | null;
  max_expires_at: string | null;
  last_reauth_at: string | null;
  device_id: string | null;
  ip_country: string | null;
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
    refreshExpiresAt: new Date(row.refresh_expires_at ?? row.expires_at),
    maxExpiresAt: new Date(row.max_expires_at ?? row.expires_at),
    lastReauthAt: row.last_reauth_at ? new Date(row.last_reauth_at) : null,
    deviceId: row.device_id ?? null,
    ipCountry: row.ip_country ?? null,
  };
}

export async function createSessionRecord({
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
    refresh_expires_at: string | null;
    max_expires_at: string | null;
    last_reauth_at: string | null;
    device_id: string | null;
    ip_country: string | null;
  }>(
    `INSERT INTO auth_sessions (
       id,
       user_id,
       org_slug,
       org_verified,
       is_admin,
       expires_at,
       refresh_expires_at,
       max_expires_at,
       last_reauth_at,
       device_id,
       ip_country
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       NOW() + ($6 || ' seconds')::interval,
       NOW() + ($7 || ' seconds')::interval,
       NOW() + ($8 || ' seconds')::interval,
       NOW(),
       $9,
       $10
     )
     RETURNING id,
               user_id,
               org_slug,
               org_verified,
               is_admin,
               created_at,
               last_seen_at,
               expires_at,
               refresh_expires_at,
               max_expires_at,
               last_reauth_at,
               device_id,
               ip_country`,
    [
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
    ],
  );

  return mapRow(rows[0]);
}

export async function refreshSessionRecord(
  sessionId: string,
  options: {
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    idleTtlSeconds: number;
  },
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
    refresh_expires_at: string | null;
    max_expires_at: string | null;
    last_reauth_at: string | null;
    device_id: string | null;
    ip_country: string | null;
  }>(
    `UPDATE auth_sessions
       SET last_seen_at = NOW(),
           expires_at = NOW() + ($2 || ' seconds')::interval,
           refresh_expires_at = LEAST(
             max_expires_at,
             NOW() + ($3 || ' seconds')::interval
           )
     WHERE id = $1
       AND refresh_expires_at > NOW()
       AND max_expires_at > NOW()
       AND last_seen_at > NOW() - ($4 || ' seconds')::interval
     RETURNING id,
               user_id,
               org_slug,
               org_verified,
               is_admin,
               created_at,
               last_seen_at,
               expires_at,
               refresh_expires_at,
               max_expires_at,
               last_reauth_at,
               device_id,
               ip_country`,
    [
      sessionId,
      options.accessTtlSeconds,
      options.refreshTtlSeconds,
      options.idleTtlSeconds,
    ],
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

export async function updateSessionMetadata(
  sessionId: string,
  options: {
    deviceId?: string | null;
    ipCountry?: string | null;
  },
): Promise<void> {
  await ensureSchema();

  const fields = [] as string[];
  const values = [] as unknown[];

  if (options.deviceId !== undefined) {
    fields.push(`device_id = $${fields.length + 1}`);
    values.push(options.deviceId);
  }

  if (options.ipCountry !== undefined) {
    fields.push(`ip_country = $${fields.length + 1}`);
    values.push(options.ipCountry);
  }

  if (fields.length === 0) {
    return;
  }

  values.push(sessionId);
  await query(
    `UPDATE auth_sessions
        SET ${fields.join(", ")}
      WHERE id = $${fields.length + 1}`,
    values,
  );
}

export async function pruneExpiredSessions(): Promise<void> {
  await ensureSchema();
  await query(
    "DELETE FROM auth_sessions WHERE max_expires_at < NOW() OR refresh_expires_at < NOW()",
  );
}

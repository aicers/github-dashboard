// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRecord,
  refreshSessionRecord,
} from "@/lib/auth/session-store";
import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import { upsertUser } from "@/lib/db/operations";

async function resetSessions() {
  await ensureSchema();
  await query("TRUNCATE TABLE auth_sessions RESTART IDENTITY CASCADE");
}

describe("session store refresh behavior", () => {
  beforeEach(async () => {
    await resetSessions();
    await upsertUser({
      id: "user-1",
      login: "user-1",
      name: "User 1",
      avatarUrl: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("returns null when the idle window is exceeded", async () => {
    const record = await createSessionRecord({
      sessionId: "session-id",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      maxLifetimeSeconds: 300,
      deviceId: null,
      ipCountry: null,
    });

    await query(
      "UPDATE auth_sessions SET last_seen_at = NOW() - interval '400 seconds' WHERE id = $1",
      [record.id],
    );

    const refreshed = await refreshSessionRecord(record.id, {
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      idleTtlSeconds: 300,
    });

    expect(refreshed).toBeNull();
  });

  it("returns null when refresh expiry has passed", async () => {
    const record = await createSessionRecord({
      sessionId: "session-refresh-expired",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      maxLifetimeSeconds: 300,
      deviceId: null,
      ipCountry: null,
    });

    await query(
      "UPDATE auth_sessions SET refresh_expires_at = NOW() - interval '1 second' WHERE id = $1",
      [record.id],
    );

    const refreshed = await refreshSessionRecord(record.id, {
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      idleTtlSeconds: 300,
    });

    expect(refreshed).toBeNull();
  });

  it("returns null when max lifetime has elapsed", async () => {
    const record = await createSessionRecord({
      sessionId: "session-max-expired",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      maxLifetimeSeconds: 300,
      deviceId: null,
      ipCountry: null,
    });

    await query(
      "UPDATE auth_sessions SET max_expires_at = NOW() - interval '1 second' WHERE id = $1",
      [record.id],
    );

    const refreshed = await refreshSessionRecord(record.id, {
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      idleTtlSeconds: 300,
    });

    expect(refreshed).toBeNull();
  });

  it("caps refresh expiry at the max lifetime", async () => {
    const record = await createSessionRecord({
      sessionId: "session-cap",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: false,
      accessTtlSeconds: 60,
      refreshTtlSeconds: 120,
      maxLifetimeSeconds: 300,
      deviceId: null,
      ipCountry: null,
    });

    await query(
      "UPDATE auth_sessions SET max_expires_at = NOW() + interval '10 seconds' WHERE id = $1",
      [record.id],
    );

    const refreshed = await refreshSessionRecord(record.id, {
      accessTtlSeconds: 60,
      refreshTtlSeconds: 3600,
      idleTtlSeconds: 300,
    });

    expect(refreshed).not.toBeNull();
    if (!refreshed) {
      throw new Error("Expected session refresh to succeed.");
    }

    expect(refreshed.refreshExpiresAt.getTime()).toBeLessThanOrEqual(
      refreshed.maxExpiresAt.getTime(),
    );
  });
});

import { describe, expect, it } from "vitest";
import type { AuthConfig } from "@/lib/auth/config";
import { isReauthRequired, type ReauthAction } from "@/lib/auth/reauth";
import type { SessionRecord } from "@/lib/auth/session-store";

const BASE_CONFIG: AuthConfig = {
  accessTtlMinutes: 60,
  idleTtlMinutes: 30,
  refreshTtlDays: 14,
  maxLifetimeDays: 30,
  reauthWindowHours: 24,
  reauthActions: ["backup_run"],
  reauthRequireNewDevice: true,
  reauthRequireCountryChange: true,
};

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    userId: "user-1",
    orgSlug: "org",
    orgVerified: true,
    isAdmin: true,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    lastSeenAt: new Date("2024-01-01T00:00:00.000Z"),
    expiresAt: new Date("2024-01-01T01:00:00.000Z"),
    refreshExpiresAt: new Date("2024-01-02T00:00:00.000Z"),
    maxExpiresAt: new Date("2024-01-03T00:00:00.000Z"),
    lastReauthAt: new Date("2024-01-01T00:00:00.000Z"),
    deviceId: "device-1",
    ipCountry: "KR",
    ...overrides,
  };
}

function runCheck(
  overrides: Partial<{
    session: SessionRecord;
    config: AuthConfig;
    deviceId: string | null;
    ipCountry: string | null;
    now: Date;
    action: ReauthAction;
  }> = {},
) {
  const deviceId =
    "deviceId" in overrides ? (overrides.deviceId ?? null) : "device-1";
  const ipCountry =
    "ipCountry" in overrides ? (overrides.ipCountry ?? null) : "KR";

  return isReauthRequired({
    session: overrides.session ?? buildSession(),
    action: overrides.action ?? "backup_run",
    config: overrides.config ?? BASE_CONFIG,
    deviceId,
    ipCountry,
    now: overrides.now ?? new Date("2024-01-01T01:00:00.000Z"),
  });
}

describe("isReauthRequired", () => {
  it("skips actions not configured for reauth", () => {
    const result = runCheck({
      action: "sync_cleanup",
    });
    expect(result).toBe(false);
  });

  it("requires reauth when the session has never reauthed", () => {
    const result = runCheck({
      session: buildSession({ lastReauthAt: null }),
    });
    expect(result).toBe(true);
  });

  it("requires reauth when the reauth window has expired", () => {
    const result = runCheck({
      now: new Date("2024-01-03T00:00:01.000Z"),
    });
    expect(result).toBe(true);
  });

  it("does not require reauth when inside the reauth window", () => {
    const result = runCheck({
      now: new Date("2024-01-01T02:00:00.000Z"),
    });
    expect(result).toBe(false);
  });

  it("requires reauth when the device changes", () => {
    const result = runCheck({
      deviceId: "device-2",
    });
    expect(result).toBe(true);
  });

  it("requires reauth when the device cookie is missing", () => {
    const result = runCheck({
      deviceId: null,
    });
    expect(result).toBe(true);
  });

  it("does not require reauth when the session has no device fingerprint", () => {
    const result = runCheck({
      session: buildSession({ deviceId: null }),
      deviceId: "device-2",
    });
    expect(result).toBe(false);
  });

  it("requires reauth when the country changes", () => {
    const result = runCheck({
      ipCountry: "US",
    });
    expect(result).toBe(true);
  });

  it("does not require reauth when the request has no country info", () => {
    const result = runCheck({
      ipCountry: null,
    });
    expect(result).toBe(false);
  });
});

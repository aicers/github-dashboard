import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const cookiesMock = vi.fn();
const decodeSessionCookieMock = vi.fn();
const refreshSessionRecordMock = vi.fn();
const deleteSessionRecordMock = vi.fn();
const pruneExpiredSessionsMock = vi.fn();
const updateSessionMetadataMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/auth/session-cookie", () => ({
  SESSION_COOKIE_NAME: "gd_session",
  decodeSessionCookie: decodeSessionCookieMock,
  buildSessionCookie: vi.fn(),
  buildClearedSessionCookie: vi.fn().mockReturnValue({
    name: "gd_session",
    value: "",
    options: { maxAge: 0 },
  }),
}));

vi.mock("@/lib/auth/session-store", () => ({
  createSessionRecord: vi.fn(),
  refreshSessionRecord: refreshSessionRecordMock,
  deleteSessionRecord: deleteSessionRecordMock,
  updateSessionMetadata: updateSessionMetadataMock,
  pruneExpiredSessions: pruneExpiredSessionsMock,
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: vi.fn(async () => ({
    accessTtlMinutes: 60,
    idleTtlMinutes: 30,
    refreshTtlDays: 14,
    maxLifetimeDays: 30,
    reauthWindowHours: 24,
    reauthActions: [],
    reauthRequireNewDevice: true,
    reauthRequireCountryChange: true,
  })),
}));

vi.mock("@/lib/auth/device-cookie", () => ({
  readDeviceIdFromHeaders: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/ip-country", () => ({
  readIpCountryFromHeaders: vi.fn(async () => null),
}));

function stubCookieValue(value: string | null) {
  cookiesMock.mockResolvedValue({
    get: vi.fn(() => (value ? { value } : undefined)),
  });
}

function buildSessionRecord(
  overrides?: Partial<{ orgVerified: boolean; isAdmin: boolean }>,
) {
  return {
    id: "session-id",
    userId: "user-1",
    orgSlug: "org",
    orgVerified: overrides?.orgVerified ?? true,
    isAdmin: overrides?.isAdmin ?? false,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
    refreshExpiresAt: new Date(Date.now() + 1000),
    maxExpiresAt: new Date(Date.now() + 1000),
    lastReauthAt: new Date(),
    deviceId: "device-1",
    ipCountry: "KR",
  };
}

describe("readActiveSession", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    cookiesMock.mockReset();
    decodeSessionCookieMock.mockReset();
    refreshSessionRecordMock.mockReset();
    deleteSessionRecordMock.mockReset();
    updateSessionMetadataMock.mockReset();
    pruneExpiredSessionsMock.mockReset();
    pruneExpiredSessionsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("prunes expired sessions at most once per interval", async () => {
    stubCookieValue("encoded-cookie");
    decodeSessionCookieMock.mockReturnValue("session-id");
    refreshSessionRecordMock.mockResolvedValue(buildSessionRecord());

    const { readActiveSession } = await import("./session");

    await readActiveSession();
    expect(pruneExpiredSessionsMock).toHaveBeenCalledTimes(1);

    await readActiveSession();
    expect(pruneExpiredSessionsMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await readActiveSession();
    expect(pruneExpiredSessionsMock).toHaveBeenCalledTimes(2);
  });

  test("deletes session when refresh returns null", async () => {
    stubCookieValue("encoded-cookie");
    decodeSessionCookieMock.mockReturnValue("session-id");
    refreshSessionRecordMock.mockResolvedValue(null);

    const { readActiveSession } = await import("./session");

    const result = await readActiveSession();
    expect(result).toBeNull();
    expect(deleteSessionRecordMock).toHaveBeenCalledWith("session-id");
  });

  test("deletes session when org membership is no longer verified", async () => {
    stubCookieValue("encoded-cookie");
    decodeSessionCookieMock.mockReturnValue("session-id");
    refreshSessionRecordMock.mockResolvedValue(
      buildSessionRecord({ orgVerified: false }),
    );

    const { readActiveSession } = await import("./session");

    const result = await readActiveSession();
    expect(result).toBeNull();
    expect(deleteSessionRecordMock).toHaveBeenCalledWith("session-id");
  });

  test("returns null when cookie is missing", async () => {
    stubCookieValue(null);

    const { readActiveSession } = await import("./session");
    const result = await readActiveSession();

    expect(result).toBeNull();
    expect(pruneExpiredSessionsMock).toHaveBeenCalledTimes(1);
    expect(refreshSessionRecordMock).not.toHaveBeenCalled();
  });
});

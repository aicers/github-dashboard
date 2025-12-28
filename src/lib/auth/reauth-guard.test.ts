import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/config", () => ({
  getAuthConfig: vi.fn(async () => ({
    accessTtlMinutes: 60,
    idleTtlMinutes: 30,
    refreshTtlDays: 14,
    maxLifetimeDays: 30,
    reauthWindowHours: 24,
    reauthActions: ["backup_run"],
    reauthRequireNewDevice: true,
    reauthRequireCountryChange: true,
  })),
}));

const readDeviceIdFromRequestMock = vi.fn();
const readIpCountryFromRequestMock = vi.fn();
const isReauthRequiredMock = vi.fn();

vi.mock("@/lib/auth/device-cookie", () => ({
  readDeviceIdFromRequest: readDeviceIdFromRequestMock,
}));

vi.mock("@/lib/auth/ip-country", () => ({
  readIpCountryFromRequest: readIpCountryFromRequestMock,
}));

vi.mock("@/lib/auth/reauth", () => ({
  isReauthRequired: isReauthRequiredMock,
}));

describe("checkReauthRequired", () => {
  it("passes request metadata into the reauth check", async () => {
    readDeviceIdFromRequestMock.mockReturnValue("device-1");
    readIpCountryFromRequestMock.mockReturnValue("KR");
    isReauthRequiredMock.mockReturnValue(true);

    const { checkReauthRequired } = await import("./reauth-guard");
    const session = {
      id: "session-1",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: true,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(),
      refreshExpiresAt: new Date(),
      maxExpiresAt: new Date(),
      lastReauthAt: new Date(),
      deviceId: "device-1",
      ipCountry: "KR",
    };

    const request = new NextRequest("http://localhost/api/sync/backup/cleanup");
    const result = await checkReauthRequired(request, session, "backup_run");

    expect(result).toBe(true);
    expect(readDeviceIdFromRequestMock).toHaveBeenCalledWith(request);
    expect(readIpCountryFromRequestMock).toHaveBeenCalledWith(request);
    expect(isReauthRequiredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        action: "backup_run",
        deviceId: "device-1",
        ipCountry: "KR",
      }),
    );
  });

  it("returns false when the reauth check allows the action", async () => {
    readDeviceIdFromRequestMock.mockReturnValue(null);
    readIpCountryFromRequestMock.mockReturnValue(null);
    isReauthRequiredMock.mockReturnValue(false);

    const { checkReauthRequired } = await import("./reauth-guard");
    const session = {
      id: "session-1",
      userId: "user-1",
      orgSlug: "org",
      orgVerified: true,
      isAdmin: true,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(),
      refreshExpiresAt: new Date(),
      maxExpiresAt: new Date(),
      lastReauthAt: new Date(),
      deviceId: null,
      ipCountry: null,
    };

    const request = new NextRequest("http://localhost/api/sync/backup/cleanup");
    const result = await checkReauthRequired(request, session, "backup_run");

    expect(result).toBe(false);
  });
});

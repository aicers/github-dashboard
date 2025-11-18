import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  noStoreMock,
  readActiveSessionMock,
  fetchSyncStatusMock,
  readUserTimeSettingsMock,
  fetchSyncConfigMock,
  listAllRepositoriesMock,
  listAllUsersMock,
  getUserAvatarStateMock,
  fetchOrganizationMembersMock,
  fetchOrganizationTeamsMock,
  listHolidayCalendarsMock,
  getCalendarHolidaysMock,
} = vi.hoisted(() => ({
  noStoreMock: vi.fn(),
  readActiveSessionMock: vi.fn(),
  fetchSyncStatusMock: vi.fn(),
  readUserTimeSettingsMock: vi.fn(),
  fetchSyncConfigMock: vi.fn(),
  listAllRepositoriesMock: vi.fn(),
  listAllUsersMock: vi.fn(),
  getUserAvatarStateMock: vi.fn(),
  fetchOrganizationMembersMock: vi.fn(),
  fetchOrganizationTeamsMock: vi.fn(),
  listHolidayCalendarsMock: vi.fn(),
  getCalendarHolidaysMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: noStoreMock,
}));

vi.mock("@/components/dashboard/sync-controls", () => ({
  SyncControls: (_props: unknown) => null,
}));

vi.mock("@/components/dashboard/settings-view", () => ({
  SettingsView: (_props: unknown) => null,
}));

vi.mock("@/lib/auth/session", () => ({
  readActiveSession: readActiveSessionMock,
}));

vi.mock("@/lib/sync/service", () => ({
  fetchSyncStatus: fetchSyncStatusMock,
  fetchSyncConfig: fetchSyncConfigMock,
}));

vi.mock("@/lib/user/time-settings", () => ({
  readUserTimeSettings: readUserTimeSettingsMock,
}));

vi.mock("@/lib/db/operations", () => ({
  listAllRepositories: listAllRepositoriesMock,
  listAllUsers: listAllUsersMock,
  getUserAvatarState: getUserAvatarStateMock,
}));

vi.mock("@/lib/github/org", () => ({
  fetchOrganizationMembers: fetchOrganizationMembersMock,
  fetchOrganizationTeams: fetchOrganizationTeamsMock,
}));

vi.mock("@/lib/holidays/service", () => ({
  listHolidayCalendars: listHolidayCalendarsMock,
  getCalendarHolidays: getCalendarHolidaysMock,
}));

import SettingsPage from "@/app/dashboard/(tabs)/settings/page";
import SyncPage from "@/app/dashboard/(tabs)/sync/page";

describe("dashboard tab caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readActiveSessionMock.mockResolvedValue({
      userId: "user-1",
      isAdmin: true,
    });
    readUserTimeSettingsMock.mockResolvedValue({
      timezone: "UTC",
      dateTimeFormat: "auto",
      weekStart: "monday",
      holidayCalendarCodes: ["default"],
      organizationHolidayCalendarCodes: ["default"],
      personalHolidays: [],
      activityRowsPerPage: 25,
    });
    listAllRepositoriesMock.mockResolvedValue([]);
    listAllUsersMock.mockResolvedValue([
      {
        id: "user-1",
        login: "user",
        name: "User",
        avatarUrl: null,
      },
    ]);
    getUserAvatarStateMock.mockResolvedValue({
      avatarUrl: null,
      originalAvatarUrl: null,
      customAvatarUrl: null,
    });
    fetchOrganizationMembersMock.mockResolvedValue([]);
    fetchOrganizationTeamsMock.mockResolvedValue([]);
    listHolidayCalendarsMock.mockResolvedValue([
      {
        code: "default",
        label: "Default",
        countryLabel: "Global",
        regionLabel: null,
        sortOrder: 0,
        holidayCount: 0,
      },
    ]);
    getCalendarHolidaysMock.mockResolvedValue([]);
  });

  it("disables router cache on Sync page", async () => {
    const status = { runs: [] } as unknown;
    fetchSyncStatusMock.mockResolvedValue(status);

    const element = (await SyncPage()) as { props: Record<string, unknown> };

    expect(noStoreMock).toHaveBeenCalledTimes(1);
    expect(fetchSyncStatusMock).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual(
      expect.objectContaining({
        status,
        currentPathname: "/dashboard/sync",
      }),
    );
  });

  it("disables router cache on Settings page", async () => {
    const config = {
      org_name: "Octo Org",
      excluded_repository_ids: [],
      excluded_user_ids: [],
      allowed_team_slugs: [],
      allowed_user_ids: [],
      sync_interval_minutes: 30,
    };
    fetchSyncConfigMock.mockResolvedValue(config);

    const element = (await SettingsPage()) as {
      props: Record<string, unknown>;
    };

    expect(noStoreMock).toHaveBeenCalledTimes(1);
    expect(fetchSyncConfigMock).toHaveBeenCalledTimes(1);
    expect(element.props).toEqual(
      expect.objectContaining({
        orgName: config.org_name,
        syncIntervalMinutes: config.sync_interval_minutes,
      }),
    );
  });
});

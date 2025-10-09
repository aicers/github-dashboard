import { describe, expect, it, vi } from "vitest";

async function loadAdminModule(adminIds: string[] = []) {
  vi.resetModules();
  const envModule = await import("@/lib/env");
  envModule.env.DASHBOARD_ADMIN_IDS = adminIds;

  const adminModule = await import("./admin");
  adminModule.resetAdminLookupCache();
  return adminModule;
}

describe("isAdminUser", () => {
  it("matches admins by user id", async () => {
    const admin = await loadAdminModule(["user-1", "user-2"]);

    expect(admin.isAdminUser({ userId: "user-2", login: "octocat" })).toBe(
      true,
    );
    expect(admin.isAdminUser({ userId: "user-3", login: "octocat" })).toBe(
      false,
    );
  });

  it("matches admins by login in a case-insensitive manner", async () => {
    const admin = await loadAdminModule(["OctoCat"]);

    expect(admin.isAdminUser({ userId: "user-1", login: "octocat" })).toBe(
      true,
    );
    expect(admin.isAdminUser({ userId: "user-1", login: "OCTOCAT" })).toBe(
      true,
    );
    expect(admin.isAdminUser({ userId: "user-1", login: "hubot" })).toBe(false);
  });

  it("returns false when no identifiers are configured", async () => {
    const admin = await loadAdminModule();

    expect(admin.isAdminUser({ userId: "user-1", login: "admin" })).toBe(false);
  });

  it("rebuilds the lookup after cache reset", async () => {
    const admin = await loadAdminModule(["octocat"]);
    expect(admin.isAdminUser({ userId: "user-1", login: "octocat" })).toBe(
      true,
    );

    const envModule = await import("@/lib/env");
    envModule.env.DASHBOARD_ADMIN_IDS = ["hubot"];
    admin.resetAdminLookupCache();

    expect(admin.isAdminUser({ userId: "user-1", login: "hubot" })).toBe(true);
    expect(admin.isAdminUser({ userId: "user-1", login: "octocat" })).toBe(
      false,
    );
  });
});

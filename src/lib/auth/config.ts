import { ensureSchema } from "@/lib/db";
import { getSyncConfig } from "@/lib/db/operations";

export type AuthConfig = {
  accessTtlMinutes: number;
  idleTtlMinutes: number;
  refreshTtlDays: number;
  maxLifetimeDays: number;
  reauthWindowHours: number;
  reauthActions: string[];
  reauthRequireNewDevice: boolean;
  reauthRequireCountryChange: boolean;
};

export const DEFAULT_AUTH_CONFIG: AuthConfig = {
  accessTtlMinutes: 60,
  idleTtlMinutes: 30,
  refreshTtlDays: 14,
  maxLifetimeDays: 30,
  reauthWindowHours: 24,
  reauthActions: [
    "org_settings",
    "backup_run",
    "backup_restore",
    "sync_reset",
    "backup_cleanup",
    "sync_cleanup",
  ],
  reauthRequireNewDevice: true,
  reauthRequireCountryChange: true,
};

function normalizeNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value !== "boolean") {
    return fallback;
  }
  return value;
}

function normalizeActions(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const cleaned = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return cleaned;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  await ensureSchema();
  const config = await getSyncConfig();

  return {
    accessTtlMinutes: normalizeNumber(
      config?.auth_access_ttl_minutes,
      DEFAULT_AUTH_CONFIG.accessTtlMinutes,
    ),
    idleTtlMinutes: normalizeNumber(
      config?.auth_idle_ttl_minutes,
      DEFAULT_AUTH_CONFIG.idleTtlMinutes,
    ),
    refreshTtlDays: normalizeNumber(
      config?.auth_refresh_ttl_days,
      DEFAULT_AUTH_CONFIG.refreshTtlDays,
    ),
    maxLifetimeDays: normalizeNumber(
      config?.auth_max_lifetime_days,
      DEFAULT_AUTH_CONFIG.maxLifetimeDays,
    ),
    reauthWindowHours: normalizeNumber(
      config?.auth_reauth_window_hours,
      DEFAULT_AUTH_CONFIG.reauthWindowHours,
    ),
    reauthActions: normalizeActions(
      config?.auth_reauth_actions,
      DEFAULT_AUTH_CONFIG.reauthActions,
    ),
    reauthRequireNewDevice: normalizeBoolean(
      config?.auth_reauth_new_device,
      DEFAULT_AUTH_CONFIG.reauthRequireNewDevice,
    ),
    reauthRequireCountryChange: normalizeBoolean(
      config?.auth_reauth_country_change,
      DEFAULT_AUTH_CONFIG.reauthRequireCountryChange,
    ),
  };
}

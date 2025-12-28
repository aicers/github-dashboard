import type { AuthConfig } from "@/lib/auth/config";
import type { SessionRecord } from "@/lib/auth/session-store";

export type ReauthAction =
  | "org_settings"
  | "backup_run"
  | "backup_restore"
  | "sync_reset"
  | "backup_cleanup"
  | "sync_cleanup";

export const REAUTH_ACTION_DEFINITIONS: Array<{
  id: ReauthAction;
  label: string;
}> = [
  { id: "org_settings", label: "Organization 설정 저장" },
  { id: "backup_run", label: "백업 실행" },
  { id: "backup_restore", label: "백업 복원" },
  { id: "sync_reset", label: "데이터 리셋" },
  { id: "backup_cleanup", label: "백업 정리" },
  { id: "sync_cleanup", label: "동기화 정리" },
];

type ReauthCheckOptions = {
  session: SessionRecord;
  action: ReauthAction;
  config: AuthConfig;
  deviceId: string | null;
  ipCountry: string | null;
  now?: Date;
};

export function isReauthRequired({
  session,
  action,
  config,
  deviceId,
  ipCountry,
  now = new Date(),
}: ReauthCheckOptions): boolean {
  if (!config.reauthActions.includes(action)) {
    return false;
  }

  const lastReauth = session.lastReauthAt?.getTime();
  const reauthWindowMs = config.reauthWindowHours * 60 * 60 * 1000;
  if (!lastReauth || now.getTime() - lastReauth > reauthWindowMs) {
    return true;
  }

  if (config.reauthRequireNewDevice) {
    if (session.deviceId && deviceId && session.deviceId !== deviceId) {
      return true;
    }
    if (session.deviceId && !deviceId) {
      return true;
    }
  }

  if (config.reauthRequireCountryChange) {
    if (ipCountry && session.ipCountry && ipCountry !== session.ipCountry) {
      return true;
    }
  }

  return false;
}

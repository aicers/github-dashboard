import type { AuthConfig } from "@/lib/auth/config";
import type { SessionRecord } from "@/lib/auth/session-store";

const REAUTH_ACTION_TUPLES = [
  ["org_settings", "Organization 설정 저장"],
  ["backup_run", "백업 실행"],
  ["backup_restore", "백업 복원"],
  ["sync_reset", "데이터 리셋"],
  ["backup_cleanup", "백업 정리"],
  ["sync_cleanup", "동기화 정리"],
] as const;

export type ReauthAction = (typeof REAUTH_ACTION_TUPLES)[number][0];

const REAUTH_ACTIONS: ReadonlySet<string> = new Set<string>(
  REAUTH_ACTION_TUPLES.map(([id]) => id),
);

export function isReauthAction(value: string): value is ReauthAction {
  return REAUTH_ACTIONS.has(value);
}

export const REAUTH_ACTION_DEFINITIONS: Array<{
  id: ReauthAction;
  label: string;
}> = REAUTH_ACTION_TUPLES.map(([id, label]) => ({ id, label }));

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

import type { NextRequest } from "next/server";

import { getAuthConfig } from "@/lib/auth/config";
import { readDeviceIdFromRequest } from "@/lib/auth/device-cookie";
import { readIpCountryFromRequest } from "@/lib/auth/ip-country";
import { isReauthRequired, type ReauthAction } from "@/lib/auth/reauth";
import type { SessionRecord } from "@/lib/auth/session-store";

export async function checkReauthRequired(
  request: NextRequest,
  session: SessionRecord,
  action: ReauthAction,
): Promise<boolean> {
  const config = await getAuthConfig();
  const deviceId = readDeviceIdFromRequest(request);
  const ipCountry = readIpCountryFromRequest(request);

  return isReauthRequired({
    session,
    action,
    config,
    deviceId,
    ipCountry,
  });
}

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import type { CookieDescriptor } from "@/lib/auth/session-cookie";

export const DEVICE_COOKIE_NAME = "gd_device";
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years

export function generateDeviceId(): string {
  return randomBytes(24).toString("base64url");
}

export function buildDeviceCookie(deviceId: string): CookieDescriptor {
  return {
    name: DEVICE_COOKIE_NAME,
    value: deviceId,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export function buildClearedDeviceCookie(): CookieDescriptor {
  return {
    name: DEVICE_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    },
  };
}

export function readDeviceIdFromRequest(request: NextRequest): string | null {
  return request.cookies.get(DEVICE_COOKIE_NAME)?.value ?? null;
}

export async function readDeviceIdFromHeaders(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(DEVICE_COOKIE_NAME)?.value ?? null;
}

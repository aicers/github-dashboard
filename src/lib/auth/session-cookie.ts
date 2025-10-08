import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

type CookieOptions = {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
};

export type CookieDescriptor = {
  name: string;
  value: string;
  options: CookieOptions;
};

export const SESSION_COOKIE_NAME = "gd_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function requireSessionSecret(): string {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured. Set it to sign session cookies.",
    );
  }

  return secret;
}

export function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function signSessionId(sessionId: string): Buffer {
  const hmac = createHmac("sha256", requireSessionSecret());
  hmac.update(sessionId);
  return hmac.digest();
}

export function encodeSessionCookie(sessionId: string): string {
  const signature = signSessionId(sessionId);
  return `${sessionId}.${signature.toString("base64url")}`;
}

export function decodeSessionCookie(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parts = value.split(".", 2);
  if (parts.length !== 2) {
    return null;
  }

  const [sessionId, signaturePart] = parts;
  if (!sessionId || !signaturePart) {
    return null;
  }

  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(signaturePart, "base64url");
  } catch {
    return null;
  }

  const expectedSignature = signSessionId(sessionId);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  return sessionId;
}

export function buildSessionCookie(sessionId: string): CookieDescriptor {
  return {
    name: SESSION_COOKIE_NAME,
    value: encodeSessionCookie(sessionId),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    },
  };
}

export function buildClearedSessionCookie(): CookieDescriptor {
  return {
    name: SESSION_COOKIE_NAME,
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

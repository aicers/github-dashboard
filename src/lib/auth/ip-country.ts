import { headers } from "next/headers";
import type { NextRequest } from "next/server";

const COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "x-country",
  "x-geo-country",
];

function normalizeCountry(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed.length === 2 ? trimmed : null;
}

export function readIpCountryFromRequest(request: NextRequest): string | null {
  for (const header of COUNTRY_HEADERS) {
    const value = request.headers.get(header);
    const normalized = normalizeCountry(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export async function readIpCountryFromHeaders(): Promise<string | null> {
  const headerStore = await headers();
  for (const header of COUNTRY_HEADERS) {
    const value = headerStore.get(header);
    const normalized = normalizeCountry(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

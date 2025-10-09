import { env } from "@/lib/env";

type AdminLookup = {
  ids: Set<string>;
  logins: Set<string>;
};

let cachedLookup: AdminLookup | null = null;

function buildLookup(): AdminLookup {
  const ids = new Set<string>();
  const logins = new Set<string>();

  for (const value of env.DASHBOARD_ADMIN_IDS) {
    if (!value) {
      continue;
    }

    ids.add(value);
    logins.add(value.toLowerCase());
  }

  return { ids, logins };
}

function getLookup(): AdminLookup {
  if (!cachedLookup) {
    cachedLookup = buildLookup();
  }

  return cachedLookup;
}

export function resetAdminLookupCache() {
  cachedLookup = null;
}

export function isAdminUser({
  userId,
  login,
}: {
  userId: string;
  login?: string | null;
}): boolean {
  const lookup = getLookup();
  if (lookup.ids.has(userId)) {
    return true;
  }

  if (!login) {
    return false;
  }

  return lookup.logins.has(login.toLowerCase());
}

export function getConfiguredAdminIdentifiers(): string[] {
  return [...getLookup().ids];
}

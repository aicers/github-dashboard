import { ensureSchema } from "@/lib/db";
import { type DbActor, upsertUser } from "@/lib/db/operations";
import { env } from "@/lib/env";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_API = "https://api.github.com/user";
const GITHUB_EMAILS_API = "https://api.github.com/user/emails";
const OAUTH_SCOPES = ["read:user", "user:email", "read:org"];
const USER_AGENT = "github-dashboard/oauth";

export const GITHUB_STATE_COOKIE = "github_oauth_state";
export const STATE_TTL_SECONDS = 10 * 60; // 10 minutes
export const GITHUB_RETURN_COOKIE = "github_oauth_return";

type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

type GithubUserResponse = {
  id: number;
  node_id?: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type GithubEmailResponse = {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility?: string | null;
};

export type GithubOAuthProfile = {
  actor: DbActor;
  emails: string[];
  rawUser: GithubUserResponse;
};

function requireOAuthConfig(): GithubOAuthConfig {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET.",
    );
  }

  return { clientId, clientSecret };
}

export function createOAuthState(): string {
  return crypto.randomUUID();
}

type CookieOptions = {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
};

type StateCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export function buildStateCookie(
  state: string,
  overrides?: CookieOptions,
): StateCookie {
  const options: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: overrides?.maxAge ?? STATE_TTL_SECONDS,
    path: "/",
    ...overrides,
  };

  return {
    name: GITHUB_STATE_COOKIE,
    value: state,
    options,
  };
}

export function buildReturnCookie(
  value: string,
  overrides?: CookieOptions,
): StateCookie {
  const options: CookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: overrides?.maxAge ?? STATE_TTL_SECONDS,
    path: "/",
    ...overrides,
  };

  return {
    name: GITHUB_RETURN_COOKIE,
    value,
    options,
  };
}

export function buildAuthorizeUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}) {
  const { clientId } = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES.join(" "),
    state,
    allow_signup: "false",
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken({
  code,
  redirectUri,
  state,
}: {
  code: string;
  redirectUri: string;
  state: string;
}) {
  const { clientId, clientSecret } = requireOAuthConfig();
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      state,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to exchange OAuth code. GitHub responded with ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!payload.access_token) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "GitHub did not return an access token.",
    );
  }

  return payload.access_token;
}

export async function fetchGithubProfile(
  accessToken: string,
): Promise<GithubOAuthProfile> {
  const userResponse = await fetch(GITHUB_USER_API, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });

  if (!userResponse.ok) {
    throw new Error(
      `Failed to load GitHub user profile. GitHub responded with ${userResponse.status}.`,
    );
  }

  const user = (await userResponse.json()) as GithubUserResponse;

  const emailsResponse = await fetch(GITHUB_EMAILS_API, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });

  let emails: string[] = [];
  if (emailsResponse.ok) {
    const records = (await emailsResponse.json()) as GithubEmailResponse[];
    emails = records
      .filter((entry) => entry.verified)
      .map((entry) => entry.email);
  }

  const actor: DbActor = {
    id: user.node_id ?? String(user.id),
    login: user.login,
    name: user.name ?? user.login,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at ?? null,
    updatedAt: user.updated_at ?? null,
    __typename: "User",
  };

  return {
    actor,
    emails,
    rawUser: user,
  };
}

export async function persistGithubProfile(profile: GithubOAuthProfile) {
  await ensureSchema();
  await upsertUser(profile.actor);
}

type MembershipResult = {
  allowed: boolean;
  orgSlug: string | null;
};

export async function verifyOrganizationMembership(
  accessToken: string,
  login: string,
): Promise<MembershipResult> {
  const targetOrg = env.GITHUB_ALLOWED_ORG?.trim();
  if (!targetOrg) {
    return { allowed: true, orgSlug: null };
  }

  if (!login) {
    return { allowed: false, orgSlug: targetOrg };
  }

  const response = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(targetOrg)}/memberships/${encodeURIComponent(login)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return { allowed: false, orgSlug: targetOrg };
  }

  if (response.status === 403) {
    return { allowed: false, orgSlug: targetOrg };
  }

  if (!response.ok) {
    throw new Error(
      `Unable to verify organization membership. GitHub responded with ${response.status}.`,
    );
  }

  const membership = (await response.json()) as {
    state?: string;
    organization?: { login?: string };
  };

  const isActive = membership.state === "active";
  return {
    allowed: isActive,
    orgSlug: membership.organization?.login ?? targetOrg,
  };
}

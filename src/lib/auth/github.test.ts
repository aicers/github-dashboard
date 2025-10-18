import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ensureSchemaMock = vi.fn();
const getSyncConfigMock = vi.fn();
const isAdminUserMock = vi.fn();

vi.mock("@/lib/db", () => ({
  ensureSchema: ensureSchemaMock,
}));

vi.mock("@/lib/db/operations", () => ({
  upsertUser: vi.fn(),
  getSyncConfig: getSyncConfigMock,
}));

vi.mock("@/lib/auth/admin", () => ({
  isAdminUser: isAdminUserMock,
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  ensureSchemaMock.mockResolvedValue(undefined);
  getSyncConfigMock.mockResolvedValue({
    allowed_team_slugs: [],
    allowed_user_ids: [],
  });
  isAdminUserMock.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("GitHub OAuth helpers", () => {
  test("buildAuthorizeUrl includes expected query parameters", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "client-secret";

    const { buildAuthorizeUrl } = await import("./github");

    const url = buildAuthorizeUrl({
      state: "state-value",
      redirectUri: "http://localhost/callback",
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(parsed.searchParams.get("client_id")).toBe("client-id");
    expect(parsed.searchParams.get("state")).toBe("state-value");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost/callback",
    );
    expect(parsed.searchParams.get("scope")).toBe(
      "read:user user:email read:org",
    );
  });

  test("buildStateCookie sets secure defaults", async () => {
    const { buildStateCookie, GITHUB_STATE_COOKIE, STATE_TTL_SECONDS } =
      await import("./github");

    const cookie = buildStateCookie("state-value");

    expect(cookie.name).toBe(GITHUB_STATE_COOKIE);
    expect(cookie.value).toBe("state-value");
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.maxAge).toBe(STATE_TTL_SECONDS);
    expect(cookie.options.path).toBe("/");
  });

  test("fetchGithubProfile returns actor details and verified emails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 42,
              node_id: "MDQ6VXNlcjQy",
              login: "octocat",
              name: "The Octocat",
              avatar_url: "https://example.com/octo.png",
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-02T00:00:00Z",
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              { email: "octo@github.com", verified: true },
              { email: "ignored@github.com", verified: false },
            ]),
            { status: 200 },
          ),
        ),
    );

    const { fetchGithubProfile } = await import("./github");
    const profile = await fetchGithubProfile("token");

    expect(profile.actor).toMatchObject({
      id: "MDQ6VXNlcjQy",
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.com/octo.png",
    });
    expect(profile.emails).toEqual(["octo@github.com"]);
  });

  test("verifyOrganizationMembership allows when no org is configured", async () => {
    delete process.env.GITHUB_ALLOWED_ORG;

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
    });

    expect(result).toEqual({ allowed: true, orgSlug: null });
  });

  test("verifyOrganizationMembership approves active members", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";
    getSyncConfigMock.mockResolvedValueOnce({
      allowed_team_slugs: [],
      allowed_user_ids: ["octocat"],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            state: "active",
            organization: { login: "acme" },
          }),
          { status: 200 },
        ),
      ),
    );

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
      userId: "user-123",
    });

    expect(result).toEqual({ allowed: true, orgSlug: "acme" });
  });

  test("verifyOrganizationMembership denies when not a member", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
    });

    expect(result).toEqual({ allowed: false, orgSlug: "acme" });
  });

  test("verifyOrganizationMembership denies non-admins when no allow-list is configured", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            state: "active",
            organization: { login: "acme" },
          }),
          { status: 200 },
        ),
      ),
    );

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
      userId: "user-123",
    });

    expect(result).toEqual({ allowed: false, orgSlug: "acme" });
  });

  test("verifyOrganizationMembership allows admins even when no allow-list is configured", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";
    isAdminUserMock.mockReturnValueOnce(true);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            state: "active",
            organization: { login: "acme" },
          }),
          { status: 200 },
        ),
      ),
    );

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
      userId: "admin-user",
    });

    expect(result).toEqual({ allowed: true, orgSlug: "acme" });
  });

  test("verifyOrganizationMembership approves members of allowed teams", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";
    getSyncConfigMock.mockResolvedValueOnce({
      allowed_team_slugs: ["core-team"],
      allowed_user_ids: [],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: "active",
            organization: { login: "acme" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "active" }), { status: 200 }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
      userId: "user-123",
    });

    expect(result).toEqual({ allowed: true, orgSlug: "acme" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("verifyOrganizationMembership rejects forbidden responses", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    const { verifyOrganizationMembership } = await import("./github");
    const result = await verifyOrganizationMembership({
      accessToken: "token",
      login: "octocat",
    });

    expect(result).toEqual({ allowed: false, orgSlug: "acme" });
  });

  test("verifyOrganizationMembership throws on unexpected errors", async () => {
    process.env.GITHUB_ALLOWED_ORG = "acme";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    const { verifyOrganizationMembership } = await import("./github");
    await expect(
      verifyOrganizationMembership({ accessToken: "token", login: "octocat" }),
    ).rejects.toThrow(/Unable to verify organization membership/);
  });
});

import "../../../tests/helpers/postgres-container";

import { afterEach, describe, expect, it } from "vitest";

import { query } from "@/lib/db/client";
import { type DbActor, upsertUser } from "@/lib/db/operations";

const TEST_USER_ID = "user_123";

afterEach(async () => {
  await query("TRUNCATE TABLE users CASCADE");
});

describe("db operations", () => {
  it("upsertUser stores actor data", async () => {
    const actor: DbActor = {
      id: TEST_USER_ID,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.com/avatar.png",
      createdAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      updatedAt: new Date("2024-02-01T00:00:00Z").toISOString(),
    };

    await upsertUser(actor);

    const result = await query(
      "SELECT id, login, name, avatar_url, github_created_at, github_updated_at FROM users WHERE id = $1",
      [TEST_USER_ID],
    );

    expect(result.rowCount).toBe(1);
    const row = result.rows[0];
    expect(row.id).toBe(actor.id);
    expect(row.login).toBe("octocat");
    expect(row.name).toBe("The Octocat");
    expect(row.avatar_url).toBe("https://example.com/avatar.png");
    expect(row.github_created_at?.toISOString()).toBe(actor.createdAt);
    expect(row.github_updated_at?.toISOString()).toBe(actor.updatedAt);
  });
});

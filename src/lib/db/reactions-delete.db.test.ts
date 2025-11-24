// @vitest-environment node

import "../../../tests/helpers/postgres-container";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureSchema, query } from "@/lib/db";
import {
  type DbReaction,
  deleteReactionsForSubject,
  upsertReaction,
  upsertUser,
} from "@/lib/db/operations";
import { resetDashboardTables } from "../../../tests/helpers/dashboard-metrics";

describe("deleteReactionsForSubject", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  beforeEach(async () => {
    await resetDashboardTables();
  });

  afterEach(async () => {
    await resetDashboardTables();
  });

  it("removes reactions not present in keep list", async () => {
    await upsertUser({
      id: "user-a",
      login: "alice",
      name: "Alice",
      avatarUrl: null,
    });
    await upsertUser({
      id: "user-b",
      login: "bob",
      name: "Bob",
      avatarUrl: null,
    });
    const keepReaction: DbReaction = {
      id: "reaction-keep",
      subjectType: "issue",
      subjectId: "issue-1",
      userId: "user-a",
      content: "+1",
      createdAt: "2024-01-01T00:00:00.000Z",
      raw: {},
    };
    const dropReaction: DbReaction = {
      id: "reaction-drop",
      subjectType: "issue",
      subjectId: "issue-1",
      userId: "user-b",
      content: "THUMBS_DOWN",
      createdAt: "2024-01-02T00:00:00.000Z",
      raw: {},
    };

    await upsertReaction(keepReaction);
    await upsertReaction(dropReaction);

    await deleteReactionsForSubject({
      subjectType: "issue",
      subjectId: "issue-1",
      keepIds: [keepReaction.id],
    });

    const rows = await query<{ id: string }>(
      `SELECT id FROM reactions ORDER BY id`,
    );
    expect(rows.rows.map((row) => row.id)).toEqual([keepReaction.id]);
  });
});

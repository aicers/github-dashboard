import { ensureSchema } from "@/lib/db";
import { query } from "@/lib/db/client";
import type { DbActor } from "@/lib/db/operations";
import { upsertUser } from "@/lib/db/operations";

export async function resetActivitySavedFiltersTables() {
  await ensureSchema();
  await query("TRUNCATE TABLE activity_saved_filters RESTART IDENTITY CASCADE");
  await query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
}

export async function seedActivityUser({
  id,
  login,
  name,
  avatarUrl,
  createdAt,
  updatedAt,
}: {
  id: string;
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}) {
  const timestamp = createdAt ?? "2024-01-01T00:00:00.000Z";
  const actor: DbActor = {
    id,
    login: login ?? id,
    name: name ?? `${id} name`,
    avatarUrl: avatarUrl ?? null,
    createdAt: timestamp,
    updatedAt: updatedAt ?? timestamp,
  };

  await upsertUser(actor);
  return actor;
}

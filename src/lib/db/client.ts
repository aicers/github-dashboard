import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

import { env } from "@/lib/env";

type QueryParams = Array<unknown> | undefined;

let pool: Pool | null = null;

function createPool() {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Update your environment settings.",
    );
  }

  const config: PoolConfig = {
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  };

  const client = new Pool(config);

  client.on("error", (error) => {
    // Ignore termination errors triggered when shutting the container down.
    if ((error as { code?: string }).code === "57P01") {
      return;
    }

    console.error("Unexpected database client error", error);
  });

  return client;
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryParams,
): Promise<QueryResult<T>> {
  const client = getPool();
  const result = await client.query<T>(text, params);
  return result as QueryResult<T>;
}

export async function withTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

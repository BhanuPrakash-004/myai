import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readStorageConfig } from "./config";
import * as schema from "./schema";

export const ROOT_FOLDER_ID = "00000000-0000-0000-0000-000000000001";

let storage: ReturnType<typeof createStorage> | undefined;
export function getStorage() {
  return storage ??= createStorage();
}

export function createStorage(env: Record<string, string | undefined> = process.env) {
  const config = readStorageConfig(env);
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_SIZE,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "myai",
  });
  // Pool idle errors must not crash the process or expose connection credentials.
  pool.on("error", () => console.error("[postgres] Idle connection lost; the next request will reconnect."));
  pool.on("connect", (client) => {
    client.on("error", () => console.error("[postgres] Connection interrupted."));
  });
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

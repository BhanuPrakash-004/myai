import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { makeWorkerUtils } from "graphile-worker";

export async function migrateDatabase(pool: Pool, options: { directory?: string; through?: string } = {}) {
  const directory = options.directory || path.resolve("migrations");
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No SQL migrations found");
  if (options.through && !names.includes(options.through)) throw new Error("Unknown migration boundary");
  const migrations = await Promise.all(names.map(async (name) => {
    const body = await readFile(path.join(directory, name), "utf8");
    return { name, body, hash: createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex") };
  }));
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(71202002)");
    await client.query("CREATE TABLE IF NOT EXISTS myai_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const existing = await client.query<{ name: string; sha256: string }>("SELECT name, sha256 FROM myai_migrations ORDER BY name");
    for (const row of existing.rows) {
      const file = migrations.find((migration) => migration.name === row.name);
      if (!file || file.hash !== row.sha256) throw new Error("Applied migration missing or modified: " + row.name);
    }
    for (const migration of migrations) {
      if (options.through && migration.name > options.through) break;
      if (existing.rows.some((row) => row.name === migration.name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.body);
        await client.query("INSERT INTO myai_migrations (name, sha256) VALUES ($1, $2)", [migration.name, migration.hash]);
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    // Graphile owns its own migrations; run them explicitly with the same deployment lock.
    const worker = await makeWorkerUtils({ pgPool: pool });
    try { await worker.migrate(); } finally { await worker.release(); }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(71202002)");
    client.release();
  }
}

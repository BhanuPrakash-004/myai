import { createStorage } from "../../src/lib/storage/client";
import { loadCliEnv } from "./env";

async function main() {
  loadCliEnv();
  const storage = createStorage();
  try {
    const { rows } = await storage.pool.query("SELECT name, applied_at FROM myai_migrations ORDER BY name");
    console.log(JSON.stringify({ migrations: rows, workerTasksImplemented: false }, null, 2));
  } finally { await storage.close(); }
}
main().catch(() => { console.error("Database status unavailable; check configuration and run db:migrate."); process.exitCode = 1; });

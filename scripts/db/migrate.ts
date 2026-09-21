import { createStorage } from "../../src/lib/storage/client";
import { migrateDatabase } from "../../src/lib/storage/migrate";
import { loadCliEnv } from "./env";

async function main() {
  loadCliEnv();
  const storage = createStorage();
  try {
    const applied = await migrateDatabase(storage.pool);
    console.log(applied.length ? "Applied: " + applied.join(", ") : "Database is up to date.");
  } finally { await storage.close(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Database migration failed");
  process.exitCode = 1;
});

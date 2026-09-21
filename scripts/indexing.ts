import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { asMaintenance } from "../src/lib/storage/access";
import { requeue, processingStatus } from "../src/lib/worker/admin";
loadCliEnv();
const storage = createStorage(), command = process.argv[2] || "status";
try {
  await asMaintenance(async () => {
    if (command === "status" || command === "health") {
      const status = await processingStatus(storage.pool);
      if (command === "health") process.exitCode = status.workers.some((worker) => worker.alive) ? 0 : 1;
      else console.log(JSON.stringify(status, null, 2));
    } else if (command === "retry" || command === "rebuild") console.log(JSON.stringify(await requeue(storage.pool, { action: command, ...(process.argv[3] ? { noteId: process.argv[3] } : {}) }), null, 2));
    else throw new Error("Unknown command");
  });
} catch { console.error("Indexing command failed. Use status, health, retry or rebuild [note UUID]."); process.exitCode = 1; }
finally { await storage.close(); }

import { randomUUID } from "node:crypto";
import { run, Logger } from "graphile-worker";
import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { readStorageConfig } from "../src/lib/storage/config";
import { asMaintenance } from "../src/lib/storage/access";
import { taskRegistry, productionRegistry } from "../src/lib/worker/runtime";
import { recoverInterrupted } from "../src/lib/worker/admin";

loadCliEnv();
const storage = createStorage(), id = randomUUID();
const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 || readStorageConfig().DATABASE_POOL_SIZE < concurrency + 3) throw new Error("Use WORKER_CONCURRENCY=1–4 and DATABASE_POOL_SIZE at least concurrency + 3.");
const logger = new Logger((scope) => (level) => {
  if (level === "error" || level === "warning") console.error("[worker]", scope.taskIdentifier || "runtime", "Check database processing status for the failure code.");
});
await asMaintenance(async () => {
  let timer: ReturnType<typeof setInterval> | undefined, ticking = false;
  try {
    if (!(await storage.pool.query("SELECT 1 FROM myai_migrations WHERE name='0008_projection_cache.sql'")).rowCount) throw new Error("Run db:migrate before starting the worker.");
    await storage.pool.query("INSERT INTO worker_heartbeats(id,status,handlers) VALUES($1,'running',$2)", [id, JSON.stringify(Object.keys(productionRegistry))]);
    const runner = await run({ pgPool: storage.pool, taskList: taskRegistry(storage.pool), concurrency, pollInterval: 1000, logger, gracefulShutdownAbortTimeout: 1000 });
    const tick = async () => {
      if (ticking) return; ticking = true;
      try {
        await storage.pool.query("UPDATE worker_heartbeats SET heartbeat_at=now() WHERE id=$1", [id]);
        await recoverInterrupted(storage.pool);
        await storage.pool.query("DELETE FROM worker_heartbeats WHERE heartbeat_at<now()-interval '7 days'");
      } catch { console.error("[worker] Heartbeat/recovery failed; check database connectivity."); }
      finally { ticking = false; }
    };
    timer = setInterval(() => { void tick(); }, 15000);
    await tick();
    console.log("Worker running. Registered projection handlers: " + Object.keys(productionRegistry).join(", "));
    await runner.promise;
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith("Run db:migrate") ? error.message : "Worker stopped. Check database configuration and processing status.");
    process.exitCode = 1;
  } finally {
    if (timer) clearInterval(timer);
    await storage.pool.query("UPDATE worker_heartbeats SET status='stopped',heartbeat_at=now() WHERE id=$1", [id]).catch(() => {});
    await storage.close();
  }
});

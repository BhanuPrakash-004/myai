import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { loadCliEnv } from "./db/env";
import { migrateDatabase } from "../src/lib/storage/migrate";

// Optional external compatibility check, separate from deterministic CI.
if (!process.argv.includes("--live")) throw new Error("Pass --live to send synthetic text to OpenRouter; provider charges may apply.");
loadCliEnv();
if (!process.env.OPENROUTER_API_KEY) throw new Error("Configure OPENROUTER_API_KEY server-side first.");
const url = new URL(process.env.TEST_DATABASE_URL || "postgresql://myai_test:test-only-password@127.0.0.1:55433/myai_test");
if (!url.pathname.startsWith("/myai_test")) throw new Error("Use the isolated test database.");
const name = "myai_test_live_" + randomUUID().replaceAll("-", "");
const admin = new Pool({ connectionString: url.toString() });
let created = false;
try {
  await admin.query('CREATE DATABASE "' + name + '"'); created = true;
  url.pathname = "/" + name;
  const pool = new Pool({ connectionString: url.toString() });
  try { await migrateDatabase(pool); } finally { await pool.end(); }
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/ai-smoke.ts", "--live"], {
      env: { ...process.env, DATABASE_URL: url.toString(), AI_DAILY_REQUEST_LIMIT: "20", AI_DAILY_TOKEN_BUDGET: "20000" },
      stdio: "inherit", windowsHide: true, shell: false,
    });
    child.on("error", reject); child.on("exit", code => resolve(code ?? 1));
  });
} finally {
  if (created) await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
  await admin.end();
}

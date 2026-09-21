import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { asMaintenance } from "../src/lib/storage/access";
import { SettingsService } from "../src/lib/storage/settings";
import { UsageService } from "../src/lib/storage/usage";
import { EmbeddingProfiles } from "../src/lib/storage/embedding-profiles";
import { resolveAIConfig } from "../src/lib/ai/preferences";
import { OpenRouterClient } from "../src/lib/ai/openrouter";
import { checkConnection, checkTask } from "../src/lib/ai/checks";

loadCliEnv();
if (!process.argv.includes("--live")) throw new Error("Opt in with npm run ai:smoke -- --live. Checks send synthetic text and can incur OpenRouter charges.");
const storage = createStorage();
try {
  await asMaintenance(async () => {
    const config = resolveAIConfig(await new SettingsService(storage.pool).read());
    if (!config.apiKey) { console.log("SKIPPED: OPENROUTER_API_KEY is not configured."); process.exitCode = 2; return; }
    const client = new OpenRouterClient({ ...config, rerankEnabled: true }, new UsageService(storage.pool, config), fetch, undefined, new EmbeddingProfiles(storage.pool));
    const results = [];
    for (const task of checkTask.options) results.push(await checkConnection(client, task));
    console.log(JSON.stringify({ date: new Date().toISOString(), syntheticOnly: true, results }, null, 2));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  });
} catch { console.error("Live checks could not run. Check database migrations and AI configuration."); process.exitCode = 1; }
finally { await storage.close(); }

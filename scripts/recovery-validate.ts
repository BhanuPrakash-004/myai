import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { readStorageConfig } from "../src/lib/storage/config";
import { asMaintenance } from "../src/lib/storage/access";
import { validateRecovery } from "../src/lib/storage/recovery";
loadCliEnv();
const storage = createStorage();
try { console.log(JSON.stringify(await asMaintenance(() => validateRecovery(storage.pool, readStorageConfig().DATA_DIR)), null, 2)); }
finally { await storage.close(); }

import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { readStorageConfig } from "../src/lib/storage/config";
import { asMaintenance } from "../src/lib/storage/access";
import { purgeNote } from "../src/lib/storage/purge";
const [id, version, confirmation] = process.argv.slice(2);
if (confirmation !== "--permanently-delete") throw new Error("Usage: npm run notes:purge -- NOTE_UUID EXPECTED_VERSION --permanently-delete (30-day trash retention required)");
loadCliEnv(); const storage = createStorage();
try { console.log(await asMaintenance(() => purgeNote(storage.pool, readStorageConfig().DATA_DIR, id, Number(version)))); }
finally { await storage.close(); }

import { asMaintenance } from "../../src/lib/storage/access";
import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { createStorage } from "../../src/lib/storage/client";
import { inventoryLegacy, importLegacy } from "../../src/lib/storage/legacy";
import { loadCliEnv } from "./env";

async function main() {
  const command = process.argv[2];
  if (!["inventory", "import"].includes(command)) throw new Error("Use inventory or import");
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: { sqlite: { type: "string" }, vault: { type: "string" }, out: { type: "string" }, namespace: { type: "string" } },
  });
  if (!values.sqlite && !values.vault) throw new Error("Choose --sqlite PATH and/or --vault PATH explicitly. Fresh installations need no import.");
  const inventory = await inventoryLegacy({ sqlitePath: values.sqlite, vaultPath: values.vault });
  // The manifest contains hashes/metadata, not private content or secret values.
  const manifest = { ...inventory, items: inventory.items.map(({ body, ...item }) => ({ ...item, characters: body.length })) };
  if (values.out) await writeFile(values.out, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  if (command === "inventory") { console.log(JSON.stringify(manifest, null, 2)); return; }
  if (!values.namespace) throw new Error("Import requires --namespace NAME for repeatable checkpoints");
  loadCliEnv();
  const storage = createStorage();
  try { console.log(JSON.stringify(await asMaintenance(() => importLegacy(storage.pool, inventory, values.namespace!)))); }
  finally { await storage.close(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Legacy operation failed");
  process.exitCode = 1;
});

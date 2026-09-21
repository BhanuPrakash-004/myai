import { createStorage } from "../../src/lib/storage/client";
import { asMaintenance } from "../../src/lib/storage/access";
import { runStage } from "../../src/lib/worker/runtime";
if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/myai_test_")) throw new Error("Isolated fixture only.");
const storage = createStorage();
await asMaintenance(() => runStage(storage.pool, {
  chunks: { version: "test-v1", async prepare() { console.log("CLAIMED"); return new Promise(() => {}); }, async publish() { throw new Error("Never publish interrupted work"); } },
}, "chunks", { noteId: process.argv[2], noteVersion: 1, pipelineVersion: "v1" }));

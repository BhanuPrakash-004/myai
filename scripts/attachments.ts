import { loadCliEnv } from "./db/env";
import { createStorage } from "../src/lib/storage/client";
import { readStorageConfig } from "../src/lib/storage/config";
import { AttachmentService } from "../src/lib/storage/attachments";
import { asMaintenance } from "../src/lib/storage/access";
async function main(){loadCliEnv();const storage=createStorage();try{console.log(await asMaintenance(()=>new AttachmentService(storage.pool,readStorageConfig().DATA_DIR).reconcile()));}finally{await storage.close();}}
main().catch(()=>{console.error("Attachment reconciliation failed.");process.exitCode=1;});

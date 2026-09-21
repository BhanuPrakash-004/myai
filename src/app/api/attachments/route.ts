import { NextRequest } from "next/server";
import { AttachmentService } from "@/lib/storage/attachments";
import { getStorage } from "@/lib/storage/client";
import { readStorageConfig } from "@/lib/storage/config";
import { privateRoute,readBody } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const POST=privateRoute(async(r:NextRequest)=>{
 const files=new AttachmentService(getStorage().pool,readStorageConfig().DATA_DIR);
 const staged=await files.stage(Buffer.from(await readBody(r,10*1024*1024)),r.headers.get("x-file-name")||"attachment",r.headers.get("content-type")||"application/octet-stream");
 return ok({attachment:await files.finalize(staged.id)},{status:201});
});


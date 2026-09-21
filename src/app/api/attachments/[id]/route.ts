import { NextRequest } from "next/server";
import { AttachmentService } from "@/lib/storage/attachments";
import { getStorage } from "@/lib/storage/client";
import { readStorageConfig } from "@/lib/storage/config";
import { privateRoute } from "@/lib/http";
export const runtime="nodejs";
export const GET=privateRoute(async(_r:NextRequest,c:{params:Promise<{id:string}>})=>{
 const {row,bytes}=await new AttachmentService(getStorage().pool,readStorageConfig().DATA_DIR).download((await c.params).id);
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(row.original_name)}});
});


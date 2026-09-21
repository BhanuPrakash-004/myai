import { NextRequest } from "next/server";
import { z } from "zod";
import { knowledge } from "@/lib/storage/knowledge";
import { transaction } from "@/lib/storage/client";
import { privateRoute,jsonBody,operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const POST=privateRoute(async(r:NextRequest)=>{
 const input=z.object({pastedText:z.string().min(1).max(1000000),title:z.string().max(200).default("Imported conversation")}).strict().parse(await jsonBody(r));
 const service=knowledge(),receipt=await transaction(service.pool,async client=>{
  const folderId=await service.ensureFolderPath("imported/conversations",client);
  return service.executeInTransaction(client,{action:"create",idempotencyKey:operationKey(r),folderId,title:input.title,body:input.pastedText,provenance:"imported"});
 });
 return ok({importedCount:1,receipt,message:"Complete conversation text saved without AI rewriting. Structured conversation extraction is a later import feature."});
});

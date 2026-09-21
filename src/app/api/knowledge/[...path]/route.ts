import { NextRequest } from "next/server";
import { z } from "zod";
import { knowledge,presentNote } from "@/lib/storage/knowledge";
import { transaction } from "@/lib/storage/client";
import { DomainError } from "@/lib/storage/access";
import { privateRoute,jsonBody,operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{path:string[]}>};
async function target(c:Context){return (await c.params).path.join("/");}
export const GET=privateRoute(async(_r:NextRequest,c:Context)=>{
 const note=await knowledge().get(await target(c),true);
 if(!note) throw new DomainError("NOT_FOUND","Note not found.",404);
 return ok({path:note.path,content:note.body,metadata:presentNote(note)});
});
export const PUT=privateRoute(async(r:NextRequest,c:Context)=>{
 const service=knowledge(),path=await target(c),input=z.object({content:z.string().max(1000000),expectedVersion:z.number().int().positive().optional(),title:z.string().min(1).max(200).optional(),importance:z.number().int().min(1).max(5).optional()}).strict().parse(await jsonBody(r));
 const existing=await service.get(path,true),key=operationKey(r);
 const receipt=existing?await service.execute({action:"edit",idempotencyKey:key,noteId:existing.id,expectedVersion:z.number().int().positive().parse(input.expectedVersion),title:input.title??existing.title,body:input.content,importance:input.importance??existing.importance,metadata:existing.metadata})
 :await transaction(service.pool,async client=>{
  const folderId=await service.ensureFolderPath(path.split("/").slice(0,-1).join("/"),client);
  return service.executeInTransaction(client,{action:"create",idempotencyKey:key,folderId,path,title:input.title??input.content.match(/^#\s+(.+)$/m)?.[1]?.slice(0,200)??path.split("/").pop()!.slice(0,-3),body:input.content,importance:input.importance});
 });
 return ok({receipt,path:receipt.path,metadata:presentNote((await service.get(receipt.noteId,true))!)});
});
export const DELETE=privateRoute(async(r:NextRequest,c:Context)=>{
 const service=knowledge(),note=await service.get(await target(c),true);
 if(!note) throw new DomainError("NOT_FOUND","Note not found.",404);
 const input=z.object({expectedVersion:z.number().int().positive()}).strict().parse(await jsonBody(r));
 return ok({receipt:await service.execute({action:"lifecycle",idempotencyKey:operationKey(r),noteId:note.id,expectedVersion:input.expectedVersion,lifecycle:"trashed"})});
});
export const POST=privateRoute(async(r:NextRequest,c:Context)=>{
 const service=knowledge(),note=await service.get(await target(c),true);
 if(!note) throw new DomainError("NOT_FOUND","Note not found.",404);
 const input=z.object({newPath:z.string().min(1).max(500),expectedVersion:z.number().int().positive()}).strict().parse(await jsonBody(r));
 const receipt=await transaction(service.pool,async client=>{
  const folderId=await service.ensureFolderPath(input.newPath.split("/").slice(0,-1).join("/"),client);
  return service.executeInTransaction(client,{action:"move",idempotencyKey:operationKey(r),noteId:note.id,expectedVersion:input.expectedVersion,folderId,path:input.newPath});
 });
 return ok({newPath:receipt.path,receipt});
});

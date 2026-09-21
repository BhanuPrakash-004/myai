import { NextRequest } from "next/server";
import { z } from "zod";
import { knowledge } from "@/lib/storage/knowledge";
import { privateRoute,jsonBody,operationKey } from "@/lib/http";
import { DomainError } from "@/lib/storage/access";
import { ok } from "@/lib/api";
export const runtime="nodejs";
type Context={params:Promise<{id:string}>};
export const GET=privateRoute(async(r:NextRequest,c:Context)=>{
 const id=z.uuid().parse((await c.params).id),service=knowledge();
 if(r.nextUrl.searchParams.has("detail"))return ok(await service.detail(id));
 const note=await service.get(id,true);
 if(!note) throw new DomainError("NOT_FOUND","Note not found.",404);
 return ok({note,...(r.nextUrl.searchParams.has("history")?{history:await service.history(id)}:{})});
});
export const PATCH=privateRoute(async(r:NextRequest,c:Context)=>ok({receipt:await knowledge().execute({...await jsonBody(r),noteId:z.uuid().parse((await c.params).id),idempotencyKey:operationKey(r)})}));

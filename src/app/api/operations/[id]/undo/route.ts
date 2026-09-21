import { NextRequest } from "next/server";
import { knowledge } from "@/lib/storage/knowledge";
import { privateRoute,operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const POST=privateRoute(async(r:NextRequest,c:{params:Promise<{id:string}>})=>ok({receipt:await knowledge().execute({action:"undo",operationId:(await c.params).id,idempotencyKey:operationKey(r)})}));


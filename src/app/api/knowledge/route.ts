import { NextRequest } from "next/server";
import { knowledge,presentNote } from "@/lib/storage/knowledge";
import { ROOT_FOLDER_ID } from "@/lib/storage/client";
import { privateRoute,jsonBody,operationKey } from "@/lib/http";
import { ok,clampInt } from "@/lib/api";
import { z } from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const GET=privateRoute(async(request:NextRequest)=>{
 const p=request.nextUrl.searchParams,service=knowledge(),view=p.get("view")||"tree";
 const items=await service.list({limit:view==="tree"?10001:clampInt(p.get("limit"),100,1,500),offset:clampInt(p.get("offset"),0,0,100000),important:view==="important",folderId:p.has("folderId")?z.guid().parse(p.get("folderId")):undefined,lifecycle:view==="trashed"?"trashed":view==="archived"?"archived":"active"});
 if(view!=="tree") return ok({items:items.map(presentNote),total:items.length});
 const folders=await service.folders();
 interface Tree{id:string;name:string;path:string;type:"directory"|"file";children?:Tree[]}
 const nodes=new Map<string,Tree>(folders.map(f=>[f.id,{id:f.id,name:f.name,path:f.path,type:"directory",children:[]}]));
 for(const f of folders) if(f.parent_id) nodes.get(f.parent_id)?.children?.push(nodes.get(f.id)!);
 for(const n of items) nodes.get(n.folder_id)?.children?.push({id:n.id,name:n.title,path:n.path,type:"file"});
 return ok({tree:nodes.get(ROOT_FOLDER_ID),totalFiles:items.length,folders});
});
export const POST=privateRoute(async(request:NextRequest)=>ok({receipt:await knowledge().execute({...await jsonBody(request),action:"create",idempotencyKey:operationKey(request)})},{status:201}));

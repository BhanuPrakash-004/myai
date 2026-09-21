import { NextRequest } from "next/server";
import { RetrievalService } from "@/lib/retrieval/service";
import { getStorage } from "@/lib/storage/client";
import { privateRoute } from "@/lib/http";
import { ok } from "@/lib/api";
import { z } from "zod";
export const runtime="nodejs";
export const GET=privateRoute(async(r:NextRequest)=>{
 const p=r.nextUrl.searchParams,query=p.get("q")||"";
 const result=await new RetrievalService(getStorage().pool).retrieve({query,folderId:p.get("folderId")||undefined,descendants:p.get("descendants")!=="false",
   provenance: z.enum(["user_written","imported","ai_generated","ai_improved","migrated_unknown"]).optional().parse(p.get("provenance")||undefined),
   mode:p.get("mode")==="summary"?"summary":"search",method:p.get("method")==="keyword"?"keyword":"hybrid",
   offset:z.coerce.number().int().min(0).max(199).parse(p.get("offset")??0),limit:z.coerce.number().int().min(1).max(50).parse(p.get("limit")??15)},{signal:r.signal});
 return ok({...result,query,results:result.passages.map(p=>({...p,chunkId:p.id,id:p.noteId,filePath:p.path,snippet:p.body,rank:p.score}))});
});

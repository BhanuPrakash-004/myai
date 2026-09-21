import { NextRequest } from "next/server";
import { z } from "zod";
import { knowledge } from "@/lib/storage/knowledge";
import { transaction } from "@/lib/storage/client";
import { privateRoute,jsonBody,operationKey } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const GET=privateRoute(async(r:NextRequest)=>{
 const notes=(await knowledge().list({limit:10001})).filter(n=>n.metadata.kind==="leetcode"),pattern=r.nextUrl.searchParams.get("pattern");
 return ok({problems:notes.filter(n=>!pattern||pattern==="All"||n.metadata.pattern===pattern).map(n=>({id:n.id,problem_name:n.title,problem_number:n.metadata.problemNumber,pattern:n.metadata.pattern,difficulty:n.metadata.difficulty,file_path:n.path,times_reviewed:0,updated_at:n.updated_at})),patterns:[...new Set(notes.map(n=>n.metadata.pattern))]});
});
export const POST=privateRoute(async(r:NextRequest)=>{
 const text=z.string().max(20000).optional(),input=z.object({problemName:z.string().trim().min(1).max(150),problemNumber:z.number().int().positive().nullish(),pattern:z.string().trim().min(1).max(100),difficulty:z.enum(["Easy","Medium","Hard"]).default("Medium"),approach:text,keyInsight:text,code:text,mistakes:text}).strict().parse(await jsonBody(r));
 const body=["# "+input.problemName,"Pattern: "+input.pattern,"Difficulty: "+input.difficulty,...[["Approach",input.approach],["Key insight",input.keyInsight],["Code",input.code],["Mistakes",input.mistakes]].filter(([,value])=>value).map(([heading,value])=>"## "+heading+"\n"+value)].join("\n\n");
 const service=knowledge();
 const receipt=await transaction(service.pool,async client=>{
  const folderId=await service.ensureFolderPath("leetcode/"+input.pattern,client);
  return service.executeInTransaction(client,{action:"create",idempotencyKey:operationKey(r),folderId,title:input.problemName,body,importance:4,metadata:{kind:"leetcode",pattern:input.pattern,difficulty:input.difficulty,problemNumber:input.problemNumber}});
 });
 return ok({filePath:receipt.path,receipt});
});

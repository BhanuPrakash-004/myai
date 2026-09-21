import { NextRequest } from "next/server";
import { z } from "zod";
import { StudyService } from "@/lib/storage/study";
import { getStorage } from "@/lib/storage/client";
import { privateRoute,jsonBody } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const POST=privateRoute(async(r:NextRequest)=>{
 const input=await jsonBody(r),study=new StudyService(getStorage().pool);
 if(input.action==="start"){
  const data=z.object({action:z.literal("start"),mode:z.string().default("quick"),topic:z.string().max(300).optional(),limit:z.number().int().min(1).max(20).default(8)}).strict().parse(input);
  return ok(await study.startReview(data.mode,data.topic,data.limit));
 }
 return ok(await study.reviewAnswer(input));
});
export const GET=privateRoute(async()=>ok({message:"Start a review with POST action=start."}));

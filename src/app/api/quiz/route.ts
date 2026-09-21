import { NextRequest } from "next/server";
import { z } from "zod";
import { StudyService } from "@/lib/storage/study";
import { getStorage } from "@/lib/storage/client";
import { getAIProvider } from "@/lib/ai";
import { privateRoute,jsonBody } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const POST=privateRoute(async(r:NextRequest)=>{
 const input=await jsonBody(r),study=new StudyService(getStorage().pool);
 if(input.action==="generate"){
  const data=z.object({action:z.literal("generate"),topic:z.string().max(300).optional(),count:z.number().int().min(1).max(10).default(5)}).strict().parse(input);
  return ok(await study.generateQuiz(await getAIProvider(),data.topic,data.count,r.signal));
 }
 return ok(await study.quizAnswer(input));
});
export const GET=privateRoute(async()=>ok({message:"Generate a quiz with POST action=generate."}));

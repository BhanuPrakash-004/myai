import { NextRequest } from "next/server";
import { StudyService } from "@/lib/storage/study";
import { getStorage } from "@/lib/storage/client";
import { privateRoute } from "@/lib/http";
import { ok,clampInt } from "@/lib/api";
export const runtime="nodejs";
export const GET=privateRoute(async(r:NextRequest)=>ok(await new StudyService(getStorage().pool).dashboard(clampInt(r.nextUrl.searchParams.get("limit"),5,1,20))));

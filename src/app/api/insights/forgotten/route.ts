import { StudyService } from "@/lib/storage/study";
import { getStorage } from "@/lib/storage/client";
import { privateRoute } from "@/lib/http";
import { ok } from "@/lib/api";
export const runtime="nodejs";
export const GET=privateRoute(async()=>ok({items:await new StudyService(getStorage().pool).forgotten(20)}));

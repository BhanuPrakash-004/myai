import { NextResponse } from "next/server";
import {
  getDashboardStats,
  getFrequentlyForgotten,
  getWeakAreas,
  getRecentMemories,
  getImportantMemories,
} from "@/lib/memory/tracker";

export async function GET() {
  try {
    const stats = getDashboardStats();
    const forgotten = getFrequentlyForgotten(5);
    const weakAreas = getWeakAreas(5);
    const recent = getRecentMemories(5);
    const important = getImportantMemories(5);

    return NextResponse.json({
      stats,
      forgotten,
      weakAreas,
      recent,
      important,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { searchKnowledge } from "@/lib/ai/tools/search";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const limit = parseInt(searchParams.get("limit") || "15", 10);

    if (!query.trim()) {
      return NextResponse.json({ results: [] });
    }

    const results = searchKnowledge(query, limit);
    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeTree, listKnowledge } from "@/lib/vault";
import { getRecentMemories, getImportantMemories } from "@/lib/memory/tracker";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view"); // 'tree' | 'recent' | 'important' | 'all'

    if (view === "recent") {
      const recent = getRecentMemories(20);
      return NextResponse.json({ items: recent });
    }

    if (view === "important") {
      const important = getImportantMemories(20);
      return NextResponse.json({ items: important });
    }

    if (view === "all") {
      const db = getDb();
      const all = db.prepare("SELECT * FROM memories ORDER BY topic ASC, subcategory ASC").all();
      return NextResponse.json({ items: all });
    }

    // Default: tree view
    const tree = getKnowledgeTree();
    const files = listKnowledge();

    return NextResponse.json({
      tree,
      totalFiles: files.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

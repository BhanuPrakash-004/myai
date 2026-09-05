import { NextRequest, NextResponse } from "next/server";
import { readKnowledge, writeKnowledge, deleteKnowledge, knowledgeExists, moveKnowledge } from "@/lib/vault";
import { getDb } from "@/lib/db";
import { recordInteraction } from "@/lib/memory/tracker";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { path: pathSegments } = await context.params;
    const relPath = pathSegments.join("/");

    if (!knowledgeExists(relPath)) {
      return NextResponse.json({ error: "Knowledge note not found" }, { status: 404 });
    }

    const content = readKnowledge(relPath);
    const db = getDb();
    const memory = db.prepare("SELECT * FROM memories WHERE file_path = ?").get(relPath);

    if (memory && (memory as any).id) {
      recordInteraction((memory as any).id, "viewed");
    }

    return NextResponse.json({
      path: relPath,
      content,
      metadata: memory || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { path: pathSegments } = await context.params;
    const relPath = pathSegments.join("/");
    const body = await req.json();
    const { content, importance, topic, subcategory } = body;

    if (typeof content !== "string") {
      return NextResponse.json({ error: "Content must be a string" }, { status: 400 });
    }

    writeKnowledge(relPath, content);
    const db = getDb();
    const now = new Date().toISOString();

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : relPath;

    const existing = db.prepare("SELECT id FROM memories WHERE file_path = ?").get(relPath);
    if (existing) {
      db.prepare(`
        UPDATE memories
        SET updated_at = ?,
            content_preview = ?,
            title = COALESCE(?, title),
            importance = COALESCE(?, importance),
            topic = COALESCE(?, topic),
            subcategory = COALESCE(?, subcategory)
        WHERE file_path = ?
      `).run(
        now,
        content.slice(0, 300),
        title,
        importance || null,
        topic || null,
        subcategory || null,
        relPath
      );
    }

    // Refresh FTS
    try {
      db.prepare("DELETE FROM memories_fts WHERE file_path = ?").run(relPath);
      db.prepare(`
        INSERT INTO memories_fts (title, content, topic, subcategory, file_path)
        VALUES (?, ?, ?, ?, ?)
      `).run(title, content, topic || "General", subcategory || "", relPath);
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true, message: "Saved successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { path: pathSegments } = await context.params;
    const relPath = pathSegments.join("/");

    const deleted = deleteKnowledge(relPath);
    if (!deleted) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const db = getDb();
    db.prepare("DELETE FROM memories WHERE file_path = ?").run(relPath);
    try {
      db.prepare("DELETE FROM memories_fts WHERE file_path = ?").run(relPath);
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true, message: "Deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  // Move or rename
  try {
    const { path: pathSegments } = await context.params;
    const oldPath = pathSegments.join("/");
    const body = await req.json();
    const { newPath } = body;

    if (!newPath) {
      return NextResponse.json({ error: "newPath is required" }, { status: 400 });
    }

    moveKnowledge(oldPath, newPath);

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("UPDATE memories SET file_path = ?, updated_at = ? WHERE file_path = ?").run(
      newPath,
      now,
      oldPath
    );

    try {
      db.prepare("UPDATE memories_fts SET file_path = ? WHERE file_path = ?").run(newPath, oldPath);
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true, newPath });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

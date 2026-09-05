import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import path from "path";
import fs from "fs";
import { getVaultPath, writeKnowledge } from "@/lib/vault";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name;
    const db = getDb();
    const now = new Date().toISOString();
    let importedCount = 0;

    if (fileName.endsWith(".zip")) {
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (!entry.isDirectory && entry.entryName.endsWith(".md")) {
          // Normalize path: strip leading vault/ if present
          let cleanPath = entry.entryName.replace(/^vault[\/\\]/, "").replace(/\\/g, "/");
          const content = entry.getData().toString("utf-8");

          writeKnowledge(cleanPath, content);
          indexImportedFile(db, cleanPath, content, now);
          importedCount++;
        }
      }
    } else if (fileName.endsWith(".md")) {
      const content = buffer.toString("utf-8");
      const cleanPath = `Imported/${fileName}`;
      writeKnowledge(cleanPath, content);
      indexImportedFile(db, cleanPath, content, now);
      importedCount++;
    } else {
      return NextResponse.json({ error: "Only .md or .zip files supported" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${importedCount} knowledge files.`,
      importedCount,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function indexImportedFile(db: any, filePath: string, content: string, timestamp: string) {
  const parts = filePath.split("/");
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : parts[parts.length - 1].replace(/\.md$/, "");
  const topic = parts.length > 1 ? parts[0] : "General";
  const subcategory = parts.length > 2 ? parts.slice(1, -1).join("/") : parts[0] || "Notes";

  const id = `mem_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  db.prepare(`
    INSERT INTO memories (
      id, title, file_path, topic, subcategory, knowledge_type,
      importance, content_preview, query_count, quiz_correct_count,
      quiz_incorrect_count, forgetting_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'concept', 3, ?, 0, 0, 0, 2.4, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      content_preview = excluded.content_preview,
      updated_at = excluded.updated_at
  `).run(id, title, filePath, topic, subcategory, content.slice(0, 300), timestamp, timestamp);

  try {
    db.prepare("DELETE FROM memories_fts WHERE file_path = ?").run(filePath);
    db.prepare(`
      INSERT INTO memories_fts (title, content, topic, subcategory, file_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, content, topic, subcategory, filePath);
  } catch {
    // ignore
  }
}

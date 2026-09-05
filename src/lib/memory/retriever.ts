import { getDb } from "../db";
import { readKnowledge, knowledgeExists } from "../vault";
import { MemoryRecord } from "./types";

export interface RetrievedMemory {
  record: MemoryRecord | null;
  content: string | null;
  existsOnDisk: boolean;
}

export function retrieveMemoryByPath(filePath: string): RetrievedMemory {
  const db = getDb();
  const normalizedPath = filePath.replace(/\\/g, "/");

  const stmt = db.prepare("SELECT * FROM memories WHERE file_path = ?");
  const record = stmt.get(normalizedPath) as MemoryRecord | undefined;

  const exists = knowledgeExists(normalizedPath);
  let content: string | null = null;
  if (exists) {
    try {
      content = readKnowledge(normalizedPath);
    } catch {
      content = null;
    }
  }

  return {
    record: record || null,
    content,
    existsOnDisk: exists,
  };
}

export function findSimilarMemories(
  topic: string,
  subcategory: string,
  contentSample: string
): MemoryRecord[] {
  const db = getDb();

  // Try exact topic + subcategory match
  const matchStmt = db.prepare(`
    SELECT * FROM memories
    WHERE topic LIKE ? OR subcategory LIKE ?
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  const results = matchStmt.all(`%${topic}%`, `%${subcategory}%`) as MemoryRecord[];

  if (results.length > 0) return results;

  // Try FTS search with first few words of contentSample
  const cleanTokens = contentSample
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4)
    .join(" OR ");

  if (cleanTokens) {
    try {
      const ftsStmt = db.prepare(`
        SELECT m.* FROM memories m
        JOIN memories_fts fts ON fts.file_path = m.file_path
        WHERE memories_fts MATCH ?
        LIMIT 3
      `);
      return ftsStmt.all(cleanTokens) as MemoryRecord[];
    } catch {
      // ignore FTS syntax errors
    }
  }

  return [];
}

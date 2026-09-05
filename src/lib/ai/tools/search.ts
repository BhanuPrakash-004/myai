import { getDb } from "../../db";
import { readKnowledge, listKnowledge } from "../../vault";
import { recordInteraction } from "../../memory/tracker";

export interface SearchResult {
  id?: string;
  title: string;
  filePath: string;
  topic: string;
  subcategory: string;
  snippet: string;
  score: number;
  importance?: number;
}

export function searchKnowledge(query: string, limit = 10): SearchResult[] {
  const db = getDb();
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const results: SearchResult[] = [];
  const seenPaths = new Set<string>();

  // 1. Try SQLite FTS5 first
  try {
    const ftsTokens = cleanQuery
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => `"${w}"*`)
      .join(" OR ");

    if (ftsTokens) {
      const ftsStmt = db.prepare(`
        SELECT
          m.id,
          m.title,
          m.file_path,
          m.topic,
          m.subcategory,
          m.importance,
          snippet(memories_fts, 1, '<mark>', '</mark>', '...', 24) as snippet,
          bm25(memories_fts) as rank
        FROM memories_fts
        JOIN memories m ON m.file_path = memories_fts.file_path
        WHERE memories_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const rows = ftsStmt.all(ftsTokens, limit) as any[];
      for (const row of rows) {
        seenPaths.add(row.file_path);
        results.push({
          id: row.id,
          title: row.title,
          filePath: row.file_path,
          topic: row.topic,
          subcategory: row.subcategory,
          importance: row.importance,
          snippet: row.snippet || row.title,
          score: Math.abs(row.rank),
        });

        // Record query interaction
        if (row.id) {
          recordInteraction(row.id, "queried", `Searched for: ${cleanQuery}`);
        }
      }
    }
  } catch {
    // FTS error fallback
  }

  // 2. If results are few, perform LIKE search on title, topic, subcategory
  if (results.length < limit) {
    const likeStmt = db.prepare(`
      SELECT id, title, file_path, topic, subcategory, importance, content_preview
      FROM memories
      WHERE title LIKE ? OR topic LIKE ? OR subcategory LIKE ? OR content_preview LIKE ?
      LIMIT ?
    `);

    const likeTerm = `%${cleanQuery}%`;
    const likeRows = likeStmt.all(likeTerm, likeTerm, likeTerm, likeTerm, limit) as any[];

    for (const row of likeRows) {
      if (!seenPaths.has(row.file_path)) {
        seenPaths.add(row.file_path);
        results.push({
          id: row.id,
          title: row.title,
          filePath: row.file_path,
          topic: row.topic,
          subcategory: row.subcategory,
          importance: row.importance,
          snippet: row.content_preview || row.title,
          score: 1.0,
        });

        if (row.id) {
          recordInteraction(row.id, "queried", `Searched for: ${cleanQuery}`);
        }
      }
    }
  }

  // 3. Filesystem grep fallback for unindexed Markdown files
  if (results.length < limit) {
    const files = listKnowledge();
    const lowerQuery = cleanQuery.toLowerCase();

    for (const relPath of files) {
      if (seenPaths.has(relPath)) continue;
      try {
        const content = readKnowledge(relPath);
        const lowerContent = content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);

        if (index !== -1 || relPath.toLowerCase().includes(lowerQuery)) {
          seenPaths.add(relPath);
          const start = Math.max(0, index - 40);
          const end = Math.min(content.length, index + 100);
          const snippet =
            index !== -1
              ? "..." + content.slice(start, end).replace(/\n/g, " ") + "..."
              : content.slice(0, 100);

          const parts = relPath.split("/");
          results.push({
            title: parts[parts.length - 1].replace(/\.md$/, ""),
            filePath: relPath,
            topic: parts[0] || "General",
            subcategory: parts.slice(1, -1).join("/") || "",
            snippet,
            score: 0.5,
          });

          if (results.length >= limit) break;
        }
      } catch {
        // continue
      }
    }
  }

  return results;
}

export function buildSearchContext(query: string, maxItems = 3): { contextText: string; sources: string[] } {
  const items = searchKnowledge(query, maxItems);
  if (items.length === 0) {
    return { contextText: "", sources: [] };
  }

  const sources: string[] = [];
  const blocks: string[] = [];

  for (const item of items) {
    try {
      const fullText = readKnowledge(item.filePath);
      sources.push(item.filePath);
      blocks.push(`### Source: ${item.filePath} (${item.topic} → ${item.subcategory})\n${fullText.slice(0, 1500)}`);
    } catch {
      // skip
    }
  }

  const contextText = `\n\n--- USER'S SAVED KNOWLEDGE BASE ---\n${blocks.join("\n\n---\n\n")}\n--- END SAVED KNOWLEDGE ---\n`;
  return { contextText, sources };
}

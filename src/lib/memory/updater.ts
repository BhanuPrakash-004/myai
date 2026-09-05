import { readKnowledge, writeKnowledge } from "../vault";
import { getDb } from "../db";
import { MemoryDecision } from "./types";
import { AIProvider } from "../ai/provider";

export async function updateMemory(
  decision: MemoryDecision,
  filePath: string,
  ai?: AIProvider
): Promise<{ title: string; filePath: string }> {
  const db = getDb();
  const existingContent = readKnowledge(filePath);
  const now = new Date().toISOString();

  let updatedContent = "";

  if (ai) {
    try {
      const prompt = `You are updating an existing developer knowledge base Markdown note with new information.
DO NOT overwrite or lose previously saved details. Seamlessly merge the new information into the appropriate section (e.g. Under Important Details, Common Mistakes, or Personal Memory).
Existing File Content:
---
${existingContent}
---
New Information to Merge:
Topic: ${decision.topic} / ${decision.subcategory}
Type: ${decision.knowledgeType}
Content: ${decision.content}

Return ONLY the updated Markdown document.`;

      updatedContent = await ai.chat([
        { role: "system", content: "You are an intelligent knowledge base merger. Return raw Markdown." },
        { role: "user", content: prompt },
      ]);
    } catch {
      updatedContent = appendFallback(existingContent, decision);
    }
  } else {
    updatedContent = appendFallback(existingContent, decision);
  }

  writeKnowledge(filePath, updatedContent);

  // Update SQLite
  const updateStmt = db.prepare(`
    UPDATE memories
    SET updated_at = ?,
        importance = MAX(importance, ?),
        content_preview = ?
    WHERE file_path = ?
  `);

  updateStmt.run(now, decision.importance, decision.content.slice(0, 300), filePath);

  // Refresh FTS5
  try {
    const deleteFts = db.prepare("DELETE FROM memories_fts WHERE file_path = ?");
    deleteFts.run(filePath);

    const ftsInsert = db.prepare(`
      INSERT INTO memories_fts (title, content, topic, subcategory, file_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    const titleMatch = updatedContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : filePath;
    ftsInsert.run(title, updatedContent, decision.topic, decision.subcategory, filePath);
  } catch {
    // ignore
  }

  // Log interaction
  const logStmt = db.prepare(`
    INSERT INTO memory_interactions (id, memory_id, interaction_type, details, created_at)
    SELECT ?, id, 'updated', ?, ? FROM memories WHERE file_path = ?
  `);
  logStmt.run(`act_${Date.now()}`, `Updated knowledge with: ${decision.content.slice(0, 100)}`, now, filePath);

  const titleMatch = updatedContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : filePath;
  return { title, filePath };
}

function appendFallback(existing: string, decision: MemoryDecision): string {
  const timestamp = new Date().toLocaleDateString();
  const appendBlock = `\n\n### Update (${timestamp})\n- **${decision.knowledgeType.replace("_", " ")}**: ${decision.content}\n`;

  if (existing.includes("## Personal Memory")) {
    return existing.replace("## Personal Memory", `## Personal Memory${appendBlock}`);
  } else {
    return existing + appendBlock;
  }
}

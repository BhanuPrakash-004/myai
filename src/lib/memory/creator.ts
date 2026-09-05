import { writeKnowledge } from "../vault";
import { getDb } from "../db";
import { MemoryDecision } from "./types";
import { extractTitle } from "./classifier";
import { AIProvider } from "../ai/provider";

export async function createMemory(
  decision: MemoryDecision,
  filePath: string,
  ai?: AIProvider
): Promise<{ title: string; filePath: string; id: string }> {
  const db = getDb();
  const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const title = decision.title || extractTitle(filePath);
  const now = new Date().toISOString();

  let markdownContent = "";

  if (ai) {
    try {
      const prompt = `You are an expert technical documentation assistant. Generate a clean, concise, human-readable Obsidian-compatible Markdown note for a personal developer knowledge base.
Title: ${title}
Topic: ${decision.topic} / ${decision.subcategory}
Type: ${decision.knowledgeType}
Content details: ${decision.content}
Importance: ${decision.importance}/5

Format requirement:
# ${title}

## Core Concept
(Brief 2-3 sentences explaining what it is)

## Important Details
(Key rules, API syntax, or logic)

## Common Mistakes
(Pitfalls, what users tend to forget)

## Code Example
\`\`\`${decision.topic.toLowerCase().includes("java") ? "java" : decision.topic.toLowerCase().includes("python") ? "python" : "typescript"}
// Concise example
\`\`\`

## Personal Memory
User Note: ${decision.content}

## Related
- ${decision.topic}
- ${decision.subcategory}

Return ONLY the markdown note. Do not wrap in outer backticks.`;

      markdownContent = await ai.chat([
        { role: "system", content: "You are a Markdown documentation generator. Output raw Markdown." },
        { role: "user", content: prompt },
      ]);
    } catch {
      markdownContent = generateFallbackMarkdown(title, decision);
    }
  } else {
    markdownContent = generateFallbackMarkdown(title, decision);
  }

  // Write file to vault
  writeKnowledge(filePath, markdownContent);

  // Preview snippet for SQLite
  const preview = decision.content.slice(0, 300);

  // Insert into SQLite (robust against orphaned records)
  const insertStmt = db.prepare(`
    INSERT INTO memories (
      id, title, file_path, topic, subcategory, knowledge_type,
      importance, content_preview, query_count, quiz_correct_count,
      quiz_incorrect_count, forgetting_score, last_accessed_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, 0, 0,
      0, ?, ?,
      ?, ?
    )
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      topic = excluded.topic,
      subcategory = excluded.subcategory,
      knowledge_type = excluded.knowledge_type,
      importance = excluded.importance,
      content_preview = excluded.content_preview,
      forgetting_score = excluded.forgetting_score,
      updated_at = excluded.updated_at
  `);

  insertStmt.run(
    id,
    title,
    filePath,
    decision.topic,
    decision.subcategory,
    decision.knowledgeType,
    decision.importance,
    preview,
    decision.importance * 0.8,
    now,
    now,
    now
  );

  // Sync to FTS5 with defensive delete to prevent duplicate FTS rows
  try {
    db.prepare("DELETE FROM memories_fts WHERE file_path = ?").run(filePath);
    const ftsInsert = db.prepare(`
      INSERT INTO memories_fts (title, content, topic, subcategory, file_path)
      VALUES (?, ?, ?, ?, ?)
    `);
    ftsInsert.run(title, markdownContent, decision.topic, decision.subcategory, filePath);
  } catch {
    // ignore FTS collision if handled
  }

  // Log interaction
  const logStmt = db.prepare(`
    INSERT INTO memory_interactions (id, memory_id, interaction_type, details, created_at)
    VALUES (?, ?, 'created', ?, ?)
  `);
  logStmt.run(`act_${Date.now()}`, id, `Created knowledge in ${filePath}`, now);

  return { title, filePath, id };
}

function generateFallbackMarkdown(title: string, decision: MemoryDecision): string {
  const codeLang = decision.topic.toLowerCase().includes("java")
    ? "java"
    : decision.topic.toLowerCase().includes("python")
    ? "python"
    : "typescript";

  return `# ${title}

## Core Concept
${decision.content}

## Important Details
- **Type**: ${decision.knowledgeType.replace("_", " ")}
- **Category**: ${decision.topic} → ${decision.subcategory}
- **Importance**: ${decision.importance} / 5

## Common Mistakes
- Overlooking edge cases or syntax variations.

## Code Example
\`\`\`${codeLang}
// ${title} pattern
\`\`\`

## Personal Memory
${decision.content}

## Related
- ${decision.topic}
- ${decision.subcategory}
`;
}

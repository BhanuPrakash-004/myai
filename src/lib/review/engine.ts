import { getDb } from "../db";
import { readKnowledge } from "../vault";
import { MemoryRecord } from "../memory/types";
import { recordInteraction } from "../memory/tracker";

export interface ReviewItem {
  id: string;
  title: string;
  filePath: string;
  topic: string;
  subcategory: string;
  knowledgeType: string;
  importance: number;
  content: string;
  forgettingScore: number;
}

export interface ReviewSessionConfig {
  mode: "quick" | "topic" | "interview" | "weak_areas" | "random";
  topic?: string;
  limit?: number;
}

export function startReviewSession(config: ReviewSessionConfig): { sessionId: string; items: ReviewItem[] } {
  const db = getDb();
  const limit = config.limit || 8;
  let records: MemoryRecord[] = [];

  if (config.mode === "topic" && config.topic) {
    const stmt = db.prepare(`
      SELECT * FROM memories
      WHERE topic LIKE ? OR subcategory LIKE ?
      ORDER BY forgetting_score DESC, importance DESC
      LIMIT ?
    `);
    records = stmt.all(`%${config.topic}%`, `%${config.topic}%`, limit) as MemoryRecord[];
  } else if (config.mode === "interview") {
    const stmt = db.prepare(`
      SELECT * FROM memories
      WHERE topic IN ('DSA', 'Java', 'LeetCode', 'System Design')
         OR knowledge_type IN ('common_mistake', 'dsa_pattern', 'leetcode_approach', 'interview')
      ORDER BY importance DESC, forgetting_score DESC
      LIMIT ?
    `);
    records = stmt.all(limit) as MemoryRecord[];
  } else if (config.mode === "weak_areas") {
    const stmt = db.prepare(`
      SELECT * FROM memories
      ORDER BY forgetting_score DESC, quiz_incorrect_count DESC
      LIMIT ?
    `);
    records = stmt.all(limit) as MemoryRecord[];
  } else if (config.mode === "random") {
    const stmt = db.prepare(`
      SELECT * FROM memories
      ORDER BY RANDOM()
      LIMIT ?
    `);
    records = stmt.all(limit) as MemoryRecord[];
  } else {
    // Default: quick review (highest importance + high forgetting score)
    const stmt = db.prepare(`
      SELECT * FROM memories
      ORDER BY (importance * 1.5 + forgetting_score) DESC, updated_at DESC
      LIMIT ?
    `);
    records = stmt.all(limit) as MemoryRecord[];
  }

  const items: ReviewItem[] = [];
  for (const rec of records) {
    let content = rec.content_preview || "";
    try {
      content = readKnowledge(rec.file_path);
    } catch {
      // fallback
    }

    items.push({
      id: rec.id,
      title: rec.title,
      filePath: rec.file_path,
      topic: rec.topic,
      subcategory: rec.subcategory,
      knowledgeType: rec.knowledge_type,
      importance: rec.importance,
      content,
      forgettingScore: rec.forgetting_score,
    });
  }

  const sessionId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO review_sessions (id, mode, topic, items_reviewed, items_forgotten, created_at)
    VALUES (?, ?, ?, 0, 0, ?)
  `).run(sessionId, config.mode, config.topic || null, new Date().toISOString());

  return { sessionId, items };
}

export function logReviewOutcome(sessionId: string, memoryId: string, remembered: boolean) {
  const db = getDb();
  const type = remembered ? "reviewed" : "forgotten";
  recordInteraction(memoryId, type);

  if (remembered) {
    db.prepare("UPDATE review_sessions SET items_reviewed = items_reviewed + 1 WHERE id = ?").run(sessionId);
  } else {
    db.prepare("UPDATE review_sessions SET items_forgotten = items_forgotten + 1 WHERE id = ?").run(sessionId);
  }
}

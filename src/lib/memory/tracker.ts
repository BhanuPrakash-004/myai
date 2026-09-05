import { getDb } from "../db";
import { calculateForgettingScore } from "./scorer";
import { MemoryRecord } from "./types";

export function recordInteraction(
  memoryId: string,
  type:
    | "viewed"
    | "queried"
    | "updated"
    | "quizzed_correct"
    | "quizzed_incorrect"
    | "reviewed"
    | "forgotten",
  details?: string
): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Log in memory_interactions
  const logStmt = db.prepare(`
    INSERT INTO memory_interactions (id, memory_id, interaction_type, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  logStmt.run(`act_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`, memoryId, type, details || null, now);

  // Update memory statistics
  const memStmt = db.prepare("SELECT * FROM memories WHERE id = ?");
  const mem = memStmt.get(memoryId) as MemoryRecord | undefined;
  if (!mem) return;

  let newQueryCount = mem.query_count;
  let newQuizCorrect = mem.quiz_correct_count;
  let newQuizIncorrect = mem.quiz_incorrect_count;

  if (type === "queried") newQueryCount += 1;
  if (type === "quizzed_correct") newQuizCorrect += 1;
  if (type === "quizzed_incorrect" || type === "forgotten") newQuizIncorrect += 1;

  const newForgettingScore = calculateForgettingScore(
    newQueryCount,
    newQuizIncorrect,
    newQuizCorrect,
    mem.importance
  );

  const updateStmt = db.prepare(`
    UPDATE memories
    SET query_count = ?,
        quiz_correct_count = ?,
        quiz_incorrect_count = ?,
        forgetting_score = ?,
        last_accessed_at = ?
    WHERE id = ?
  `);

  updateStmt.run(newQueryCount, newQuizCorrect, newQuizIncorrect, newForgettingScore, now, memoryId);
}

export function getFrequentlyForgotten(limit = 10): MemoryRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM memories
    ORDER BY forgetting_score DESC, query_count DESC, importance DESC
    LIMIT ?
  `);
  return stmt.all(limit) as MemoryRecord[];
}

export interface WeakArea {
  topic: string;
  subcategory: string;
  totalNotes: number;
  totalQueries: number;
  avgForgettingScore: number;
  unresolvedMistakes: number;
}

export function getWeakAreas(limit = 5): WeakArea[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      topic,
      subcategory,
      COUNT(*) as totalNotes,
      SUM(query_count) as totalQueries,
      ROUND(AVG(forgetting_score), 2) as avgForgettingScore,
      SUM(CASE WHEN knowledge_type = 'common_mistake' THEN 1 ELSE 0 END) as unresolvedMistakes
    FROM memories
    GROUP BY topic, subcategory
    ORDER BY avgForgettingScore DESC, totalQueries DESC
    LIMIT ?
  `);
  return stmt.all(limit) as WeakArea[];
}

export function getRecentMemories(limit = 10): MemoryRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM memories
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as MemoryRecord[];
}

export function getImportantMemories(limit = 10): MemoryRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE importance >= 4
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as MemoryRecord[];
}

export function getDashboardStats() {
  const db = getDb();
  const totalCount = db.prepare("SELECT COUNT(*) as count FROM memories").get() as { count: number };
  const totalReviews = db.prepare("SELECT COUNT(*) as count FROM review_sessions").get() as { count: number };
  const totalQuizzes = db.prepare("SELECT COUNT(*) as count FROM quiz_sessions").get() as { count: number };
  const totalMistakes = db
    .prepare("SELECT COUNT(*) as count FROM memories WHERE knowledge_type = 'common_mistake'")
    .get() as { count: number };

  return {
    totalKnowledge: totalCount.count,
    totalReviews: totalReviews.count,
    totalQuizzes: totalQuizzes.count,
    totalMistakes: totalMistakes.count,
  };
}

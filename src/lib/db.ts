import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(config.databasePath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");

  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db: Database.Database) {
  // Memories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      topic TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      knowledge_type TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      content_preview TEXT,
      query_count INTEGER NOT NULL DEFAULT 0,
      quiz_correct_count INTEGER NOT NULL DEFAULT 0,
      quiz_incorrect_count INTEGER NOT NULL DEFAULT 0,
      forgetting_score REAL NOT NULL DEFAULT 0.0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
    CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memories_forgetting ON memories(forgetting_score);
  `);

  // Full-Text Search 5 virtual table
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title,
        content,
        topic,
        subcategory,
        file_path,
        tokenize='porter unicode61'
      );
    `);
  } catch {
    // If FTS5 is already set up or alternative tokenization
  }

  // Memory interactions
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_interactions (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      interaction_type TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_interactions_memory ON memory_interactions(memory_id);
    CREATE INDEX IF NOT EXISTS idx_interactions_created ON memory_interactions(created_at);
  `);

  // Chat sessions and messages
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      memory_saved TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
  `);

  // Review sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      topic TEXT,
      items_reviewed INTEGER NOT NULL DEFAULT 0,
      items_forgotten INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Quiz sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id TEXT PRIMARY KEY,
      topic TEXT,
      total_questions INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // LeetCode problems
  db.exec(`
    CREATE TABLE IF NOT EXISTS leetcode_problems (
      id TEXT PRIMARY KEY,
      problem_name TEXT NOT NULL,
      problem_number INTEGER,
      pattern TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'Medium',
      file_path TEXT NOT NULL UNIQUE,
      times_reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leetcode_pattern ON leetcode_problems(pattern);
  `);

  // App settings key-value
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

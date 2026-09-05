export type KnowledgeType =
  | "concept"
  | "syntax"
  | "api_function"
  | "logic"
  | "common_mistake"
  | "code_snippet"
  | "dsa_pattern"
  | "leetcode_approach"
  | "interview"
  | "general";

export type MemoryAction =
  | "IGNORE"
  | "CREATE"
  | "UPDATE"
  | "MERGE"
  | "DELETE"
  | "QUERY"
  | "EXPLAIN"
  | "QUIZ"
  | "REVIEW";

export interface MemoryDecision {
  action: MemoryAction;
  topic: string;
  subcategory: string;
  title?: string;
  knowledgeType: KnowledgeType;
  importance: 1 | 2 | 3 | 4 | 5;
  content: string;
  relatedFile?: string;
  reasoning: string;
}

export interface MemoryResult {
  saved: boolean;
  action: MemoryAction;
  topic?: string;
  subcategory?: string;
  filePath?: string;
  title?: string;
  knowledgeType?: KnowledgeType;
  importance?: number;
  message?: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  file_path: string;
  topic: string;
  subcategory: string;
  knowledge_type: KnowledgeType;
  importance: number;
  content_preview: string | null;
  query_count: number;
  quiz_correct_count: number;
  quiz_incorrect_count: number;
  forgetting_score: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

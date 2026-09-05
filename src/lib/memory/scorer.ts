import { KnowledgeType } from "./types";

export function scoreImportance(
  content: string,
  knowledgeType: KnowledgeType,
  currentQueryCount = 0
): 1 | 2 | 3 | 4 | 5 {
  const text = content.toLowerCase();

  // High importance indicators
  if (
    text.includes("always forget") ||
    text.includes("must remember") ||
    text.includes("critical") ||
    text.includes("vital") ||
    text.includes("trap") ||
    text.includes("important") ||
    knowledgeType === "common_mistake"
  ) {
    return 5;
  }

  if (
    knowledgeType === "syntax" ||
    knowledgeType === "dsa_pattern" ||
    knowledgeType === "leetcode_approach" ||
    text.includes("interview") ||
    currentQueryCount >= 2
  ) {
    return 4;
  }

  if (
    knowledgeType === "api_function" ||
    knowledgeType === "logic" ||
    knowledgeType === "code_snippet"
  ) {
    return 3;
  }

  return 2;
}

export function calculateForgettingScore(
  queryCount: number,
  quizIncorrect: number,
  quizCorrect: number,
  importance: number
): number {
  // Higher score = more frequently forgotten
  // Incorrect quiz responses weigh heavily (+2.5 each)
  // High query count indicates user keeps coming back (+1.2 each)
  // Importance adds baseline weight
  // Correct quizzes reduce score (-1.0 each)
  const base = importance * 0.8;
  const queries = queryCount * 1.2;
  const incorrect = quizIncorrect * 2.5;
  const correct = quizCorrect * 1.0;

  const raw = base + queries + incorrect - correct;
  return Math.max(0, Math.round(raw * 10) / 10);
}

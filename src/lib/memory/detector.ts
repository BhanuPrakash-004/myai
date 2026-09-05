import { AIProvider } from "../ai/provider";
import { MemoryDecision, KnowledgeType } from "./types";
import { scoreImportance } from "./scorer";

const DECISION_SCHEMA = `{
  "action": "IGNORE | CREATE | UPDATE | MERGE | QUERY | EXPLAIN | QUIZ | REVIEW",
  "topic": "string (e.g. Java, DSA, LeetCode, Python, Database, Frontend)",
  "subcategory": "string (e.g. Graph/BFS, Collections/Map, Two-Pointers, Streams)",
  "title": "string (optional specific title e.g. Queue Size in BFS)",
  "knowledgeType": "concept | syntax | api_function | logic | common_mistake | code_snippet | dsa_pattern | leetcode_approach | interview | general",
  "importance": 1 to 5,
  "content": "string (concise distilled technical knowledge to save or query)",
  "reasoning": "string (why this decision was made)"
}`;

export async function detectMemory(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  ai: AIProvider
): Promise<MemoryDecision> {
  const prompt = `Analyze this user message in a developer/student personal knowledge base app.
The user chats naturally. Determine if this message is:
- Knowledge to save (CREATE, UPDATE, or MERGE)
- A query asking about their saved knowledge (QUERY or EXPLAIN)
- A study or quiz request (QUIZ or REVIEW)
- Casual conversation with no knowledge value (IGNORE)

User message: "${message}"

Recent conversation context:
${history.slice(-3).map((h) => `${h.role}: ${h.content}`).join("\n")}

Return a JSON object conforming strictly to the schema.`;

  try {
    const decision = await ai.chatStructured<MemoryDecision>(
      [
        {
          role: "system",
          content: `You are the Memory Engine of an AI Personal Knowledge Base. Your job is to classify developer messages into structured actions.`,
        },
        { role: "user", content: prompt },
      ],
      DECISION_SCHEMA
    );

    // Validate and fill default fields
    if (decision && decision.action) {
      decision.importance = decision.importance || scoreImportance(decision.content || message, decision.knowledgeType || "concept");
      return decision;
    }
  } catch {
    // Fallback heuristic detection
  }

  return heuristicDetect(message);
}

function heuristicDetect(message: string): MemoryDecision {
  const lower = message.toLowerCase();

  if (
    lower.startsWith("hi") ||
    lower.startsWith("hello") ||
    lower.startsWith("thanks") ||
    lower.startsWith("bye") ||
    lower.length < 5
  ) {
    return {
      action: "IGNORE",
      topic: "General",
      subcategory: "",
      knowledgeType: "general",
      importance: 1,
      content: message,
      reasoning: "Casual chat or greeting",
    };
  }

  if (lower.includes("quiz me") || lower.includes("test my knowledge")) {
    return {
      action: "QUIZ",
      topic: lower.includes("java") ? "Java" : lower.includes("dsa") ? "DSA" : "General",
      subcategory: "",
      knowledgeType: "general",
      importance: 3,
      content: message,
      reasoning: "Quiz intent detected",
    };
  }

  if (lower.includes("review") || lower.includes("revise") || lower.includes("what should i")) {
    return {
      action: "REVIEW",
      topic: lower.includes("java") ? "Java" : lower.includes("dsa") ? "DSA" : "General",
      subcategory: "",
      knowledgeType: "general",
      importance: 3,
      content: message,
      reasoning: "Review intent detected",
    };
  }

  if (
    lower.startsWith("what ") ||
    lower.startsWith("how ") ||
    lower.startsWith("explain ") ||
    lower.startsWith("show ") ||
    lower.startsWith("tell ") ||
    lower.startsWith("find ")
  ) {
    return {
      action: "QUERY",
      topic: lower.includes("java") ? "Java" : lower.includes("bfs") ? "DSA" : "General",
      subcategory: lower.includes("bfs") ? "Graph/BFS" : "",
      knowledgeType: "concept",
      importance: 3,
      content: message,
      reasoning: "Querying saved knowledge",
    };
  }

  // Otherwise it's knowledge to store
  let topic = "General";
  let subcategory = "Notes";
  let kType: KnowledgeType = "concept";

  if (lower.includes("java") || lower.includes("hashmap") || lower.includes("entryset") || lower.includes("stream")) {
    topic = "Java";
    subcategory = lower.includes("map") || lower.includes("hashmap") ? "Collections/Map" : "Syntax";
    if (lower.includes("entryset") || lower.includes("map.entry")) kType = "syntax";
  } else if (lower.includes("bfs") || lower.includes("dfs") || lower.includes("graph") || lower.includes("queue")) {
    topic = "DSA";
    subcategory = "Graph/BFS";
    if (lower.includes("forget") || lower.includes("mistake") || lower.includes("size")) kType = "common_mistake";
  } else if (lower.includes("dp") || lower.includes("memo")) {
    topic = "DSA";
    subcategory = "Dynamic-Programming";
  } else if (lower.includes("3sum") || lower.includes("leetcode")) {
    topic = "LeetCode";
    subcategory = "3Sum";
    kType = "leetcode_approach";
  }

  return {
    action: "CREATE",
    topic,
    subcategory,
    knowledgeType: kType,
    importance: scoreImportance(message, kType),
    content: message.replace(/^(remember|save|note that|i always forget that)\s*/i, "").trim(),
    reasoning: "Heuristic classification of developer knowledge",
  };
}

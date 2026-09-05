import { AIProvider } from "../ai/provider";
import { detectMemory } from "./detector";
import { classifyVaultPath } from "./classifier";
import { retrieveMemoryByPath, findSimilarMemories } from "./retriever";
import { createMemory } from "./creator";
import { updateMemory } from "./updater";
import { mergeMemory } from "./merger";
import { MemoryResult, MemoryDecision } from "./types";

export async function processMessageMemory(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  ai: AIProvider
): Promise<{ decision: MemoryDecision; result: MemoryResult }> {
  const decision = await detectMemory(message, history, ai);

  // If casual message or non-storage action
  if (decision.action === "IGNORE") {
    return {
      decision,
      result: {
        saved: false,
        action: "IGNORE",
        message: "No technical knowledge identified to store.",
      },
    };
  }

  if (["QUERY", "EXPLAIN", "QUIZ", "REVIEW"].includes(decision.action)) {
    return {
      decision,
      result: {
        saved: false,
        action: decision.action,
        topic: decision.topic,
        subcategory: decision.subcategory,
      },
    };
  }

  // Target vault file path
  let targetPath = classifyVaultPath(decision);

  // Check if file or similar memory exists
  const existing = retrieveMemoryByPath(targetPath);

  if (existing.existsOnDisk) {
    // If user asked to merge or note exists, update without overwriting
    const updated = await updateMemory(decision, targetPath, ai);
    return {
      decision,
      result: {
        saved: true,
        action: "UPDATE",
        filePath: updated.filePath,
        title: updated.title,
        topic: decision.topic,
        subcategory: decision.subcategory,
        knowledgeType: decision.knowledgeType,
        importance: decision.importance,
        message: `Updated existing knowledge in ${updated.filePath}`,
      },
    };
  }

  // Check if similar note exists under another filename in same subcategory
  const similar = findSimilarMemories(decision.topic, decision.subcategory, decision.content);
  if (similar.length > 0 && decision.action === "MERGE") {
    const target = similar[0].file_path;
    const merged = await mergeMemory(decision, target, ai);
    return {
      decision,
      result: {
        saved: true,
        action: "MERGE",
        filePath: merged.filePath,
        title: merged.title,
        topic: decision.topic,
        subcategory: decision.subcategory,
        knowledgeType: decision.knowledgeType,
        importance: decision.importance,
        message: `Merged with existing knowledge in ${merged.filePath}`,
      },
    };
  }

  // Otherwise CREATE new note
  const created = await createMemory(decision, targetPath, ai);
  return {
    decision,
    result: {
      saved: true,
      action: "CREATE",
      filePath: created.filePath,
      title: created.title,
      topic: decision.topic,
      subcategory: decision.subcategory,
      knowledgeType: decision.knowledgeType,
      importance: decision.importance,
      message: `Created new knowledge in ${created.filePath}`,
    },
  };
}

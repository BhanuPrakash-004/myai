import { updateMemory } from "./updater";
import { MemoryDecision } from "./types";
import { AIProvider } from "../ai/provider";

export async function mergeMemory(
  decision: MemoryDecision,
  targetFilePath: string,
  ai?: AIProvider
): Promise<{ title: string; filePath: string }> {
  // Merging routes through the smart updater
  return updateMemory(decision, targetFilePath, ai);
}

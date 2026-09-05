import { MemoryDecision } from "./types";

export function sanitizePathComponent(part: string): string {
  return part
    .replace(/[<>:"|?*]/g, "") // remove forbidden filesystem characters
    .trim()
    .replace(/\s+/g, "-") // replace spaces with dash
    .replace(/\.+/g, "."); // no double dots
}

export function classifyVaultPath(decision: MemoryDecision): string {
  // If a related file was explicitly suggested
  if (decision.relatedFile && decision.relatedFile.endsWith(".md")) {
    return decision.relatedFile.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  }

  const rawTopic = decision.topic?.trim() || "General";
  const rawSub = decision.subcategory?.trim() || "";

  const topicParts = rawTopic
    .split(/[\/\\]/)
    .map(sanitizePathComponent)
    .filter(Boolean);

  const subParts = rawSub
    .split(/[\/\\]/)
    .map(sanitizePathComponent)
    .filter(Boolean);

  const allParts = [...topicParts, ...subParts];

  if (allParts.length === 0) {
    allParts.push("General", "Note");
  } else if (allParts.length === 1) {
    allParts.push("Overview");
  }

  // Ensure last part becomes the filename with .md
  const lastIndex = allParts.length - 1;
  if (!allParts[lastIndex].endsWith(".md")) {
    allParts[lastIndex] = `${allParts[lastIndex]}.md`;
  }

  return allParts.join("/");
}

export function extractTitle(filePath: string): string {
  const base = filePath.split("/").pop() || "";
  return base.replace(/\.md$/i, "").replace(/-/g, " ");
}

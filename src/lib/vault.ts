import fs from "fs";
import path from "path";
import { config } from "./config";

export interface VaultFileNode {
  name: string;
  path: string; // relative to vault
  type: "file" | "directory";
  children?: VaultFileNode[];
  sizeBytes?: number;
  updatedAt?: string;
}

export function getVaultPath(): string {
  if (!fs.existsSync(config.vaultPath)) {
    fs.mkdirSync(config.vaultPath, { recursive: true });
  }
  return config.vaultPath;
}

export function resolveVaultPath(relativePath: string): string {
  const root = getVaultPath();
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(root)) {
    throw new Error("Access denied: path outside vault");
  }
  return resolved;
}

export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function knowledgeExists(relativePath: string): boolean {
  try {
    const fullPath = resolveVaultPath(relativePath);
    return fs.existsSync(fullPath);
  } catch {
    return false;
  }
}

export function readKnowledge(relativePath: string): string {
  const fullPath = resolveVaultPath(relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

export function writeKnowledge(relativePath: string, content: string): string {
  const fullPath = resolveVaultPath(relativePath);
  const dir = path.dirname(fullPath);
  ensureDirectory(dir);
  fs.writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

export function deleteKnowledge(relativePath: string): boolean {
  const fullPath = resolveVaultPath(relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    // Optionally clean up empty parent directories
    let parent = path.dirname(fullPath);
    const root = getVaultPath();
    while (parent !== root && parent.startsWith(root)) {
      try {
        const files = fs.readdirSync(parent);
        if (files.length === 0) {
          fs.rmdirSync(parent);
          parent = path.dirname(parent);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
    return true;
  }
  return false;
}

export function moveKnowledge(oldRelativePath: string, newRelativePath: string): void {
  const oldPath = resolveVaultPath(oldRelativePath);
  const newPath = resolveVaultPath(newRelativePath);
  if (!fs.existsSync(oldPath)) {
    throw new Error(`Source file not found: ${oldRelativePath}`);
  }
  const dir = path.dirname(newPath);
  ensureDirectory(dir);
  fs.renameSync(oldPath, newPath);
}

export function listKnowledge(subDir = ""): string[] {
  const baseDir = resolveVaultPath(subDir);
  if (!fs.existsSync(baseDir)) return [];

  const results: string[] = [];
  const root = getVaultPath();

  function traverse(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        results.push(rel);
      }
    }
  }

  traverse(baseDir);
  return results;
}

export function getKnowledgeTree(subDir = ""): VaultFileNode {
  const root = getVaultPath();
  const baseDir = resolveVaultPath(subDir);

  function buildTree(currentPath: string, name: string): VaultFileNode {
    const stat = fs.statSync(currentPath);
    if (!stat.isDirectory()) {
      return {
        name,
        path: path.relative(root, currentPath).replace(/\\/g, "/"),
        type: "file",
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    }

    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const children: VaultFileNode[] = [];

    // Sort folders first, then files alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        const subTree = buildTree(full, entry.name);
        // Only include non-empty directories or include all
        children.push(subTree);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const fileStat = fs.statSync(full);
        children.push({
          name: entry.name,
          path: path.relative(root, full).replace(/\\/g, "/"),
          type: "file",
          sizeBytes: fileStat.size,
          updatedAt: fileStat.mtime.toISOString(),
        });
      }
    }

    return {
      name: name || "vault",
      path: path.relative(root, currentPath).replace(/\\/g, "/") || "",
      type: "directory",
      children,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  return buildTree(baseDir, path.basename(baseDir));
}

import AdmZip from "adm-zip";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import { KnowledgeService, hash, safePath, slug, folderPathsSql, type Receipt } from "./knowledge";
import { AttachmentService } from "./attachments";
import { requireAccess, DomainError } from "./access";
import { transaction, ROOT_FOLDER_ID } from "./client";
import { stableId } from "../retrieval/chunks";

export const importPolicy = z.enum(["error", "skip", "create", "merge"]);
const extensions = new Set(["md", "txt", "java", "js", "jsx", "ts", "tsx", "py", "c", "cpp", "h", "cs", "go", "rs", "sql", "sh", "css", "html", "json", "yaml", "yml"]);
export interface ImportEntry { path: string; originalPath: string; body: string; original: string; hash: string }
// Nothing is extracted to the filesystem. Limit both claimed and ACTUAL expanded bytes.
export function parseImport(buffer: Buffer, name: string): ImportEntry[] {
  if (buffer.length > 10 * 1024 * 1024) throw new DomainError("IMPORT_LIMIT", "Upload exceeds 10 MB.", 413);
  const utf8 = new TextDecoder("utf-8", { fatal: true }), entries: ImportEntry[] = [], seen = new Set<string>();
  let total = 0;
  function add(filename: string, data: Buffer) {
    const originalPath = filename.replace(/^vault\//, ""), ext = originalPath.split(".").pop()!.toLowerCase();
    if (!extensions.has(ext)) throw new DomainError("IMPORT_FORMAT", "Unsupported file: " + filename + ". Use UTF-8 Markdown, text or supported code files.");
    const path = safePath(originalPath + (ext === "md" ? "" : ".md"));
    const canonical = canonicalImportPath(path).toLowerCase();
    if (seen.has(canonical)) throw new DomainError("DUPLICATE_PATH", "Archive contains duplicate or colliding folder/file paths.");
    seen.add(canonical); total += data.length;
    if (entries.length >= 200 || data.length > 1_000_000 || total > 20_000_000) throw new DomainError("IMPORT_LIMIT", "Import exceeds 200 files, 1 MB/file or 20 MB expanded.", 413);
    let original: string;
    try { original = utf8.decode(data); } catch { throw new DomainError("IMPORT_ENCODING", "Files must be valid UTF-8 text."); }
    if (original.includes("\0")) throw new DomainError("IMPORT_BINARY", "Binary files are unsupported.");
    // Choose a fence longer than any run inside the code. Preserve original bytes in sources/upload.
    const fence = "`".repeat(Math.max(3, ...Array.from(original.matchAll(/`+/g), m => m[0].length + 1)));
    const body = ["md", "txt"].includes(ext) ? original : `${fence}${ext}\n${original}\n${fence}\n`;
    if (body.length > 1_000_000) throw new DomainError("IMPORT_LIMIT", "Rendered note exceeds 1 MB.", 413);
    entries.push({ path, originalPath, body, original, hash: hash(original) });
  }
  if (name.toLowerCase().endsWith(".zip")) {
    let zip: AdmZip;
    try { zip = new AdmZip(buffer); } catch { throw new DomainError("INVALID_ARCHIVE", "Invalid ZIP archive."); }
    const items = zip.getEntries();
    if (items.length > 500) throw new DomainError("IMPORT_LIMIT", "Archive has too many entries.", 413);
    for (const item of items) {
      // Check raw names, even directory and manifest entries.
      const raw = item.entryName;
      if (raw.includes("\\") || raw.startsWith("/") || /[\u0000-\u001f:]/.test(raw) || raw.replace(/\/$/, "").split("/").some(s => !s || s === "." || s === "..")) throw new DomainError("INVALID_PATH", "Unsafe archive path.");
      const unixType = (item.attr >>> 16) & 0xf000;
      if (unixType && ![0x8000, 0x4000].includes(unixType)) throw new DomainError("INVALID_ARCHIVE", "Links and special files are unsupported.");
      if (item.isDirectory) continue;
      if (["manifest.json", "graph.json", "sources.json", "attachments.json"].includes(raw)) continue; // Export metadata is never executable or authoritative on import.
      if (item.header.size > 1_000_000 || total + item.header.size > 20_000_000 || (item.header.flags & 1)) throw new DomainError("IMPORT_LIMIT", "Oversized or encrypted archive entry.", 413);
      let data: Buffer;
      try {
        const compressed = item.getCompressedData();
        if (item.header.method === 0) data = compressed;
        else if (item.header.method === 8) data = inflateRawSync(compressed, { maxOutputLength: 1_000_000 });
        else throw new Error("unsupported compression");
      } catch { throw new DomainError("INVALID_ARCHIVE", "Invalid, oversized or unsupported compressed entry."); }
      if (data.length !== item.header.size) throw new DomainError("INVALID_ARCHIVE", "Archive entry size mismatch.");
      // adm-zip performs CRC validation after bounded decompression has proven the output size.
      try { if (!item.getData().equals(data)) throw new Error("CRC"); } catch { throw new DomainError("INVALID_ARCHIVE", "Archive integrity check failed."); }
      add(raw, data);
    }
  } else add(name, buffer);
  if (!entries.length) throw new DomainError("EMPTY_IMPORT", "No supported content was found.");
  return entries;
}
export async function previewImport(service: KnowledgeService, buffer: Buffer, name: string, destinationId = ROOT_FOLDER_ID) {
  requireAccess(); z.guid().parse(destinationId);
  const entries = parseImport(buffer, name);
  const destination = (await service.pool.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [destinationId])).rows[0];
  if (!destination) throw new DomainError("NOT_FOUND", "Destination folder not found.", 404);
  const items = [];
  for (const e of entries) {
    const path = [destination.path, canonicalImportPath(e.path)].filter(Boolean).join("/");
    const old = await service.get(path, true);
    items.push({ path: e.path, targetPath: path, bytes: Buffer.byteLength(e.original), sourceHash: e.hash, existingId: old?.id ?? null, expectedVersion: old?.current_version ?? null,
      status: !old ? "new" : old.body === e.body ? "unchanged" : "conflict", lifecycle: old?.lifecycle });
  }
  return { items, uploadHash: hash(buffer.toString("base64")), destinationId };
}
export async function importMarkdown(service: KnowledgeService, files: AttachmentService, buffer: Buffer, name: string, key: string, destinationId = ROOT_FOLDER_ID,
  options: { policy?: z.infer<typeof importPolicy>; expectedVersions?: Record<string, number>; preview?: boolean } = {}) {
  requireAccess(); z.string().min(8).max(200).parse(key); z.guid().parse(destinationId);
  const entries = parseImport(buffer, name), policy = importPolicy.parse(options.policy ?? "error");
  if (options.preview) return previewImport(service, buffer, name, destinationId);
  const identity = "upload:" + key, requestHash = hash(JSON.stringify([hash(buffer.toString("base64")), name, destinationId, policy, options.expectedVersions || {}]));
  const attachmentId = stableId(identity);
  await files.stage(buffer, name, name.toLowerCase().endsWith(".zip") ? "application/zip" : "text/plain", attachmentId); await files.finalize(attachmentId);
  return transaction(service.pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(71202001)");
    const prior = (await client.query("SELECT request_hash,result FROM operations WHERE idempotency_key=$1", [identity])).rows[0];
    if (prior) { if (prior.request_hash !== requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT", "Upload key belongs to a different import.", 409); return prior.result; }
    const destination = (await client.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [destinationId])).rows[0];
    if (!destination) throw new DomainError("NOT_FOUND", "Destination folder not found.", 404);
    const receipts: Receipt[] = [], items = [];
    for (const [index, e] of entries.entries()) {
      let path = [destination.path, canonicalImportPath(e.path)].filter(Boolean).join("/");
      const old = (await client.query("SELECT n.* FROM notes n WHERE n.id IN(SELECT note_id FROM note_routes WHERE lower(path)=lower($1) UNION SELECT note_id FROM note_aliases WHERE lower(path)=lower($1))", [path])).rows[0];
      const sourceKey = "upload:" + destinationId + ":" + e.originalPath + ":" + e.hash;
      const imported = (await client.query("SELECT i.note_id FROM import_items i JOIN notes n ON n.id=i.note_id WHERE source_key=$1 AND n.lifecycle='active'", [sourceKey])).rows[0];
      if (policy !== "create" && (imported || old?.body === e.body || (old && policy === "skip"))) { items.push({ path, status: "skipped", noteId: imported?.note_id ?? old.id }); continue; }
      if (old && policy === "error") throw new DomainError("IMPORT_CONFLICT", "A path already exists. Preview and choose skip, create copy or merge.", 409);
      if (old && policy === "merge" && (old.lifecycle !== "active" || options.expectedVersions?.[e.path] !== old.current_version)) throw new DomainError("VERSION_CONFLICT", "A merge target changed or is inactive. Preview again.", 409);
      if (old && policy === "create") path = path.slice(0, -3) + "-import-" + hash(key).slice(0, 12) + ".md";
      const folderId = await service.ensureFolderPath(path.split("/").slice(0, -1).join("/"), client);
      const actualFolder = (await client.query(folderPathsSql + " SELECT path FROM folder_paths WHERE id=$1", [folderId])).rows[0].path;
      if (actualFolder !== path.split("/").slice(0, -1).join("/")) throw new DomainError("FOLDER_ALIAS_CONFLICT", "An imported folder path is a moved-folder alias. Rename that archive folder or choose its current destination.", 409);
      const title = (e.body.match(/^#\s+(.+)$/m)?.[1] ?? e.path.split("/").pop()!.slice(0, -3)).slice(0, 200) || "Imported note";
      const sources = [{ body: e.original, origin: "imported" as const, attachmentId, metadata: { importedPath: e.originalPath, sourceHash: e.hash } }];
      const receipt = await service.executeInTransaction(client, old && policy === "merge"
        ? { action: "edit", idempotencyKey: identity + ":" + index, noteId: old.id, expectedVersion: old.current_version, title: old.title, body: old.body + "\n\n---\n\n" + e.body, importance: old.importance, metadata: old.metadata, provenance: "imported", sources }
        : { action: "create", idempotencyKey: identity + ":" + index, folderId, path, title, body: e.body, provenance: "imported", sources });
      receipts.push(receipt); items.push({ path: receipt.path, status: old && policy === "merge" ? "merged" : "created", noteId: receipt.noteId });
      const sourceId = (await client.query("SELECT s.id FROM sources s JOIN note_sources ns ON ns.source_id=s.id WHERE ns.note_id=$1 AND ns.version=$2 AND s.attachment_id=$3 ORDER BY s.created_at DESC LIMIT 1", [receipt.noteId, receipt.version, attachmentId])).rows[0].id;
      await client.query("INSERT INTO import_items(source_key,source_hash,source_id,note_id,legacy_path) VALUES($1,$2,$3,$4,$5) ON CONFLICT(source_key) DO NOTHING", [sourceKey, e.hash, sourceId, receipt.noteId, e.originalPath]);
    }
    const result = { importedCount: receipts.length, skippedCount: items.filter(i => i.status === "skipped").length, receipts, items, attachmentId };
    await client.query("INSERT INTO operations(idempotency_key,request_hash,action,status,input,result) VALUES($1,$2,'import','completed',$3,$4)", [identity, requestHash, JSON.stringify({ name, destinationId, policy }), JSON.stringify(result)]);
    return result;
  });
}
function canonicalImportPath(path: string) { const parts = path.split("/"); return [...parts.slice(0, -1).map(slug), parts.at(-1)].join("/"); }

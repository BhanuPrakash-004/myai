import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rename, readdir, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import { requireAccess, DomainError } from "./access";
import { transaction } from "./client";

interface Attachment { id: string; storage_key: string; original_name: string; mime_type: string; byte_size: number; sha256: string; state: string; created_at: Date }
export class AttachmentService {
  constructor(private pool: Pool, private directory: string) { this.directory = path.resolve(directory); }
  private file(area: "staging" | "objects", key: string) {
    z.uuid().parse(key);
    return path.join(this.directory, area, key);
  }
  async stage(bytes: Buffer, originalName: string, mimeType: string, id: string = randomUUID()) {
    requireAccess(); z.uuid().parse(id);
    if (bytes.length > 10 * 1024 * 1024) throw new DomainError("TOO_LARGE", "Attachments are limited to 10 MB.", 413);
    const sha = createHash("sha256").update(bytes).digest("hex");
    await mkdir(path.join(this.directory, "staging"), { recursive: true });
    await mkdir(path.join(this.directory, "objects"), { recursive: true });
    return transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202002)");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["attachment:" + id]);
      const existing = (await client.query<Attachment>("SELECT * FROM attachments WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (existing) {
        if (existing.state === "purged") throw new DomainError("UPLOAD_PURGED", "This upload was permanently removed. Use a new upload key.", 409);
        if (existing.sha256 !== sha || existing.original_name !== originalName) throw new DomainError("IDEMPOTENCY_CONFLICT", "Upload key belongs to different content.", 409);
        if (existing.state === "ready") return existing;
      }
      const key = existing?.storage_key ?? randomUUID();
      // A failed DB commit leaves only a generated, reconcilable staging file.
      await writeFile(this.file("staging", key), bytes, { flag: existing ? "w" : "wx", mode: 0o600 });
      return (await client.query<Attachment>("INSERT INTO attachments(id,storage_key,original_name,mime_type,byte_size,sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET state='staged' RETURNING *",
        [id, key, z.string().min(1).max(255).parse(originalName), z.string().max(150).parse(mimeType), bytes.length, sha])).rows[0];
    });
  }
  async finalize(id: string) {
    requireAccess(); z.uuid().parse(id);
    return transaction(this.pool, async (client) => {
      const row = (await client.query<Attachment>("SELECT * FROM attachments WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!row) throw new DomainError("NOT_FOUND", "Attachment not found.", 404);
      if (row.state === "purged") throw new DomainError("UPLOAD_PURGED", "This upload was permanently removed.", 409);
      const staged = this.file("staging", row.storage_key), final = this.file("objects", row.storage_key);
      let bytes: Buffer;
      try { bytes = await this.readRegular(final); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; bytes = await this.readRegular(staged); }
      if (bytes.length !== row.byte_size || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new DomainError("ATTACHMENT_CORRUPT", "Attachment checksum does not match.", 409);
      try { await rename(staged, final); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      await client.query("UPDATE attachments SET state='ready' WHERE id=$1", [id]);
      return { ...row, state: "ready" };
    });
  }
  private async readRegular(file: string) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new DomainError("INVALID_ATTACHMENT", "Attachment must be a regular file.", 409);
    return readFile(file);
  }
  async download(id: string) {
    requireAccess(); z.uuid().parse(id);
    const row = (await this.pool.query<Attachment>("SELECT * FROM attachments WHERE id=$1 AND state='ready'", [id])).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", "Ready attachment not found.", 404);
    return { row, bytes: await this.readRegular(this.file("objects", row.storage_key)) };
  }
  async reconcile(graceMs = 60 * 60 * 1000) {
    requireAccess();
    const report = { finalized: 0, failed: 0, orphanFilesRemoved: 0 };
    const rows = (await this.pool.query<Attachment>("SELECT * FROM attachments WHERE state IN ('staged','failed') AND created_at < now()-($1 * interval '1 millisecond')", [graceMs])).rows;
    for (const row of rows) {
      try { await this.finalize(row.id); report.finalized++; }
      catch { await this.pool.query("UPDATE attachments SET state='failed' WHERE id=$1 AND state<>'ready'", [row.id]); report.failed++; }
    }
    // No referenced or tracked file is removed, including trashed note sources.
    // Staging writes take the same structural advisory lock as this sweep.
    await transaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(71202002)");
      for (const area of ["staging", "objects"] as const) {
        // Runtime-mounted data is not part of the application build artifact.
        const dir = path.join(/*turbopackIgnore: true*/ this.directory, area);
        const entries = await readdir(/*turbopackIgnore: true*/ dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
        for (const entry of entries) {
          if (!entry.isFile() || !z.uuid().safeParse(entry.name).success) continue;
          const file = this.file(area, entry.name);
          const stat = await lstat(file);
          if (Date.now() - stat.mtimeMs < graceMs) continue;
          if ((await client.query("SELECT 1 FROM attachments WHERE storage_key=$1 AND state<>'purged'", [entry.name])).rowCount) continue;
          await unlink(file); report.orphanFilesRemoved++;
        }
      }
    });
    return report;
  }
}

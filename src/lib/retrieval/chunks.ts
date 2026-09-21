import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const CHUNKER_VERSION = "markdown-codepoints-v1";
const MAX_POINTS = 2400, OVERLAP = 240;
export interface PassageChunk { id: string; noteId: string; version: number; ordinal: number; body: string; start: number; end: number; heading: string; tokens: number }
export function stableId(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// All offsets are Unicode code points, matching PostgreSQL substring/char_length.
// Blocks remain intact when they fit. Oversized code/list blocks split at line boundaries;
// very long lines use a hard bound. Body bytes are never normalized or reconstructed.
export function chunkNote(noteId: string, version: number, body: string): PassageChunk[] {
  const points = Array.from(body), blocks: { start: number; end: number; heading: string }[] = [];
  let position = 0, blockStart = 0, heading = "", blockHeading = "", fence = "";
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const end = position + Array.from(line).length;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    const header = !fence && line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\r?\n?$/);
    if (header && position > blockStart) { blocks.push({ start: blockStart, end: position, heading: blockHeading }); blockStart = position; }
    if (header) { heading = header[1].trim(); blockHeading = heading; }
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
    }
    if (!fence && (!line.trim() || marker)) { blocks.push({ start: blockStart, end, heading: blockHeading }); blockStart = end; blockHeading = heading; }
    position = end;
  }
  if (blockStart < points.length) blocks.push({ start: blockStart, end: points.length, heading: blockHeading });
  const ranges: { start: number; end: number; heading: string }[] = [];
  for (const block of blocks) {
    const previous = ranges.at(-1);
    if (previous && previous.heading === block.heading && block.end - previous.start <= MAX_POINTS) { previous.end = block.end; continue; }
    let start = block.start;
    while (start < block.end) {
      let end = Math.min(start + MAX_POINTS, block.end);
      if (end < block.end) {
        for (let i = end - 1; i > start + MAX_POINTS / 2; i--) if (points[i] === "\n") { end = i + 1; break; }
      }
      // Carry trailing context only within the same heading and only inside the budget.
      const prior = ranges.at(-1);
      const overlapStart = prior?.heading === block.heading ? Math.max(prior.start, start - OVERLAP) : start;
      const actualStart = end - overlapStart <= MAX_POINTS ? overlapStart : start;
      ranges.push({ start: actualStart, end, heading: block.heading });
      start = end < block.end ? Math.max(start + 1, end - OVERLAP) : end;
    }
  }
  return ranges.filter((r) => points.slice(r.start, r.end).join("").trim()).map((r, ordinal) => {
    const text = points.slice(r.start, r.end).join("");
    return { id: stableId([noteId, version, CHUNKER_VERSION, ordinal].join(":")), noteId, version, ordinal, body: text,
      start: r.start, end: r.end, heading: r.heading, tokens: Buffer.byteLength(text, "utf8") }; // Conservative byte upper bound, not a tokenizer claim.
  });
}
export async function storeChunks(client: PoolClient, chunks: PassageChunk[]) {
  for (const chunk of chunks) await client.query(`INSERT INTO chunks(id,note_id,note_version,ordinal,body,start_offset,end_offset,heading,token_count,chunker_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(note_id,note_version,chunker_version,ordinal) DO NOTHING`,
  [chunk.id, chunk.noteId, chunk.version, chunk.ordinal, chunk.body, chunk.start, chunk.end, chunk.heading, chunk.tokens, CHUNKER_VERSION]);
}

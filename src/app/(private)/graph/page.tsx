import { GraphPanel } from "@/components/knowledge/graph-panel";
import { z } from "zod";
export default async function GraphPage({ searchParams }: { searchParams: Promise<{ folderId?: string; noteId?: string }> }) {
  const params = await searchParams;
  return <GraphPanel initialFolder={z.guid().safeParse(params.folderId).success ? params.folderId : undefined} initialNote={z.uuid().safeParse(params.noteId).success ? params.noteId : undefined} />;
}

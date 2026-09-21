import { z } from "zod";
import { PracticePanel } from "@/components/knowledge/practice-panel";
export default async function QuizPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <PracticePanel initialMode="folder" initialFolderId={z.guid().safeParse(params.folderId).data} initialNoteId={z.uuid().safeParse(params.noteId).data} />;
}

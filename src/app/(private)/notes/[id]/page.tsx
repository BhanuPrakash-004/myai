import { Workspace } from "@/components/knowledge/workspace";
import { notFound } from "next/navigation";
import { z } from "zod";
import { knowledge } from "@/lib/storage/knowledge";
import { withPageOwner } from "@/lib/auth/page";
import { DomainError } from "@/lib/storage/access";
export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [detail, folders] = await withPageOwner(async () => {
    try { return await Promise.all([knowledge().detail(id), knowledge().folders()]); }
    catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  });
  return <Workspace noteId={id} initialData={detail} initialFolders={folders} />;
}

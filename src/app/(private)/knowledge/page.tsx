import { Workspace } from "@/components/knowledge/workspace";
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ capture?: string }> }) {
  const capture = (await searchParams).capture === "1";
  return <Workspace key={capture ? "capture" : "library"} startCapture={capture} />;
}

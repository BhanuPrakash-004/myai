import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RetrievalService } from "@/lib/retrieval/service";
import { getStorage } from "@/lib/storage/client";
import { withPageOwner } from "@/lib/auth/page";
import { DomainError } from "@/lib/storage/access";

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const passage = await withPageOwner(async () => {
    try { return await new RetrievalService(getStorage().pool).inspect(id); }
    catch (error) { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }
  });
  return <div className="max-w-4xl mx-auto p-6 space-y-5">
    <p className="eyebrow">Source evidence</p><h1 className="font-display text-2xl">{passage.title}</h1>
    <p className="text-sm text-paper-dim">Version {passage.note_version} · Unicode offsets {passage.start_offset}–{passage.end_offset} · {passage.current ? "Current active version" : "Historical evidence — not the current active source"}</p>
    <Link className="text-signal underline" href={"/notes/" + passage.note_id}>Open current note</Link>
    <pre className="panel p-5 whitespace-pre-wrap break-words text-sm overflow-x-auto">{passage.body}</pre>
    <p className="text-sm text-mist">This is the exact stored passage. A matching quotation establishes traceability, not factual truth.</p>
    <ul className="space-y-2 text-sm">{passage.sources.map((s: { id: string; origin: string; observed_at: Date; valid_as_of: Date | null }) => <li key={s.id}>{s.origin} · captured {new Date(s.observed_at).toISOString()}{s.valid_as_of ? " · source valid as of " + new Date(s.valid_as_of).toISOString() : " · factual date not supplied"}</li>)}</ul>
  </div>;
}

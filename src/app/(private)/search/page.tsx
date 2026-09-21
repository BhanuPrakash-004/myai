"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { request, message, ROOT, type FolderRecord } from "@/components/knowledge/shared";
import type { RetrievalResult } from "@/lib/retrieval/service";

export default function SearchPage() {
  const [query, setQuery] = useState(""), [folder, setFolder] = useState(ROOT), [provenance, setProvenance] = useState("");
  const [folders, setFolders] = useState<FolderRecord[]>([]), [data, setData] = useState<RetrievalResult>();
  const [mode, setMode] = useState("search"), [method, setMethod] = useState("hybrid"), [offset, setOffset] = useState(0);
  const [descendants, setDescendants] = useState(true);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [submitted, setSubmitted] = useState("");
  useEffect(() => { const abort = new AbortController(); request<{ folders: FolderRecord[] }>("/api/folders", "GET", undefined, undefined, abort.signal).then((r) => setFolders(r.folders)).catch((e) => { if (!abort.signal.aborted) setError(message(e)); }); return () => abort.abort(); }, []);
  useEffect(() => {
    if (!submitted) return;
    const abort = new AbortController();
    request<RetrievalResult>(submitted, "GET", undefined, undefined, abort.signal).then(setData).catch((e) => { if (!abort.signal.aborted) setError(message(e)); }).finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [submitted]);
  function search(nextOffset = 0) {
    setBusy(true); setError(""); setOffset(nextOffset); setData(undefined);
    const params = new URLSearchParams({ q: query, folderId: folder, provenance, mode, method, descendants: String(descendants), offset: String(nextOffset), limit: "15" });
    // A request token permits retrying the same query after a failure or note change.
    params.set("request", crypto.randomUUID()); setSubmitted("/api/search?" + params);
  }
  return <div className="max-w-4xl mx-auto p-5 sm:p-8 space-y-6">
    <div><p className="eyebrow">Library / Search</p><h1 className="font-display text-3xl mt-2">Find your evidence</h1><p className="text-sm text-paper-dim mt-2">Search current notes by words, quoted phrases, code tokens or meaning. Open an exact passage to inspect its version and sources.</p></div>
    <form onSubmit={(e) => { e.preventDefault(); search(); }} className="panel p-4 space-y-4">
      <label className="block text-sm">Question or search terms<Input value={query} maxLength={4000} onChange={(e) => setQuery(e.target.value)} placeholder={'Map.Entry, C++, or "solar energy"'} className="mt-1" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Folder<select className="block mt-1 w-full bg-ink-2 border border-line rounded p-2" value={folder} onChange={(e) => setFolder(e.target.value)}>{folders.map((f) => <option key={f.id} value={f.id}>{f.path ? "/" + f.path : "Entire library"}</option>)}</select></label>
        <label className="text-sm">Origin<select className="block mt-1 w-full bg-ink-2 border border-line rounded p-2" value={provenance} onChange={(e) => setProvenance(e.target.value)}><option value="">All origins</option>{["user_written", "imported", "ai_generated", "ai_improved", "migrated_unknown"].map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-sm">View<select className="block mt-1 w-full bg-ink-2 border border-line rounded p-2" value={mode} onChange={(e) => setMode(e.target.value)}><option value="search">Relevant passages</option><option value="summary">Folder coverage</option></select></label>
        <label className="text-sm">Retrieval<select className="block mt-1 w-full bg-ink-2 border border-line rounded p-2" value={method} onChange={(e) => setMethod(e.target.value)}><option value="hybrid">Hybrid (AI when configured)</option><option value="keyword">Keyword only</option></select></label>
      </div>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={descendants} onChange={(e) => setDescendants(e.target.checked)} />Include subfolders</label>
      <Button disabled={busy || (mode === "search" && !query.trim())}>{busy ? "Searching…" : "Search"}</Button>
      <p className="text-xs text-mist">Hybrid search may use OpenRouter embeddings and reranking. Folder coverage shows one passage per note and explicitly reports omissions.</p>
    </form>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {data && <section aria-live="polite" className="space-y-4">
      <p className="text-sm text-paper-dim">{data.passages.length} passages · {data.coverage.representedNotes}/{data.coverage.totalNotes} active notes represented · {data.latencyMs} ms</p>
      {data.warnings.map((w) => <p key={w} className="text-sm text-signal">{w}</p>)}
      {!data.passages.length && <p className="panel p-6">No supporting passages found. Try different words or a broader folder.</p>}
      {data.passages.map((p) => <article key={p.id} className="panel p-5 space-y-3">
        <div className="flex flex-wrap justify-between gap-2"><Link className="text-lg text-paper hover:text-signal" href={"/notes/" + p.noteId}>{p.title}</Link><span className="text-xs text-mist">v{p.version} · {p.via.join(" + ")}</span></div>
        <p className="text-xs text-mist">{p.path} · {p.provenance.replaceAll("_", " ")}{p.heading ? " · " + p.heading : ""}</p>
        <pre className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto bg-ink-0 border border-line rounded p-3">{p.body}</pre>
        <div className="flex gap-4 text-xs"><Link className="text-signal underline" href={p.url}>Inspect exact passage</Link><Link className="text-signal underline" href={"/graph?noteId=" + p.noteId + "&folderId=" + folder}>Relationships</Link></div>
      </article>)}
      <div className="flex gap-3"><Button variant="outline" disabled={busy || offset === 0} onClick={() => search(Math.max(0, offset - 15))}>Previous</Button><Button variant="outline" disabled={busy || !data.hasMore || offset >= 195} onClick={() => search(offset + 15)}>Next</Button></div>
    </section>}
  </div>;
}

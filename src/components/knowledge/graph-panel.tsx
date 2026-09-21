"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { request, message, ROOT, type FolderRecord } from "./shared";
type Node = { id: string; label: string; kind: string; note_id: string | null; scope_folder_id: string; metadata: { description?: string } };
type Edge = { id: string; from_node_id: string; to_node_id: string; from_label: string; to_label: string; relation: string; origin: string; review_state: string; revision: number; disabled: boolean; model: string | null };
type Evidence = { id: string; edge_id: string; chunk_id: string; note_id: string; note_version: number; quote: string; start_offset: number; end_offset: number; title: string };
type Neighborhood = { nodes: Node[]; edges: Edge[]; evidence: Evidence[]; hasMore: boolean; truncated: boolean };
const relations = ["mentions", "explains", "prerequisite_for", "related_to", "supports", "contradicts"];
export function GraphPanel({ initialFolder = ROOT, initialNote = "" }: { initialFolder?: string; initialNote?: string }) {
  const [folder, setFolder] = useState(initialFolder), [folders, setFolders] = useState<FolderRecord[]>([]), [query, setQuery] = useState("");
  const [note, setNote] = useState(initialNote), [focus, setFocus] = useState(""), [offset, setOffset] = useState(0), [hidden, setHidden] = useState(false);
  const [data, setData] = useState<Neighborhood>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [change, storeChange] = useState<{ action: string; edge?: Edge; node?: Node } | null>(null), [value, setValue] = useState(""), [target, setTarget] = useState("");
  const [changeKey, setChangeKey] = useState(""), [mergeQuery, setMergeQuery] = useState(""), [mergeNodes, setMergeNodes] = useState<Node[]>([]);
  function setChange(next: typeof change) { storeChange(next); if (next) { setChangeKey(crypto.randomUUID()); setError(""); setMergeQuery(""); setMergeNodes([]); } }
  const mergeScope = change?.action === "merge" ? change.node?.scope_folder_id : undefined;
  useEffect(() => {
    if (!mergeScope) return;
    const abort = new AbortController(), timer = setTimeout(() => {
      request<Neighborhood>("/api/graph?" + new URLSearchParams({ folderId: mergeScope, q: mergeQuery }), "GET", undefined, undefined, abort.signal)
        .then((r) => setMergeNodes(r.nodes.filter((n) => n.kind === "concept" && n.scope_folder_id === mergeScope)))
        .catch((e) => { if (!abort.signal.aborted) setError(message(e)); });
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [mergeScope, mergeQuery]);
  useEffect(() => { const abort = new AbortController(); request<{ folders: FolderRecord[] }>("/api/folders", "GET", undefined, undefined, abort.signal).then((r) => setFolders(r.folders)).catch((e) => { if (!abort.signal.aborted) setError(message(e)); }); return () => abort.abort(); }, []);
  useEffect(() => {
    const abort = new AbortController(), params = new URLSearchParams({ folderId: folder, q: query, noteId: note, nodeId: focus, offset: String(offset), includeDisabled: String(hidden) });
    const timer = setTimeout(() => { request<Neighborhood>("/api/graph?" + params, "GET", undefined, undefined, abort.signal).then(setData).catch((e) => { if (!abort.signal.aborted) setError(message(e)); }); }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [folder, query, note, focus, offset, hidden, refresh]);
  function reset() { setNote(""); setFocus(""); setOffset(0); setData(undefined); }
  async function apply() {
    if (!change) return; setBusy(true); setError("");
    const payload = change.action === "alias" ? { action: "alias", nodeId: change.node!.id, alias: value } : change.action === "merge" ? { action: "merge", fromId: change.node!.id, toId: target } : change.action === "correct" ? { action: "correct", edgeId: change.edge!.id, expectedRevision: change.edge!.revision, relation: value } : { action: "review", edgeId: change.edge!.id, expectedRevision: change.edge!.revision, disabled: change.action === "remove" };
    try { await request("/api/graph", "POST", payload, changeKey); setChange(null); setRefresh((n) => n + 1); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="max-w-5xl mx-auto p-5 sm:p-8 space-y-5">
    <div><p className="eyebrow">Library / Relationships</p><h1 className="font-display text-3xl mt-2">Knowledge graph</h1><p className="mt-2 text-sm text-paper-dim">Explore a small neighborhood, inspect its source, and review proposed relations. Quotes establish traceability; AI relations are proposals, not verified facts.</p></div>
    <div className="panel p-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Folder<select className="block w-full rounded border border-line bg-ink-2 p-2 mt-1" value={folder} onChange={(e) => { setFolder(e.target.value); reset(); }}>{folders.map((f) => <option key={f.id} value={f.id}>{f.path ? "/" + f.path : "Entire library"}</option>)}</select></label>
      <label className="text-sm">Find a concept<Input className="mt-1" value={query} maxLength={200} onChange={(e) => { setQuery(e.target.value); reset(); }} /></label>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />Include removed relations</label>
      <div className="flex gap-2"><Button variant="outline" onClick={reset}>Clear focus</Button><Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>Refresh</Button></div>
    </div>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {!data && <p role="status" className="text-sm text-mist">Loading relationships…</p>}
    {data && <>
      {!data.nodes.length && <p className="panel p-5">No current relationships in this scope. The worker adds folder/source links automatically; enable AI indexing in Settings for concept extraction.</p>}
      <ul aria-label="Graph nodes" className="flex flex-wrap gap-2">{data.nodes.map((node) => <li key={node.id} className="panel p-3 max-w-sm"><button className="text-left text-signal underline" onClick={() => { setFocus(node.id); setNote(""); setOffset(0); }}>{node.label}</button><p className="text-xs text-mist mt-1">{node.kind}{node.metadata.description ? " · " + node.metadata.description : ""}</p>{node.kind === "concept" && <div className="flex gap-2 mt-2"><button className="text-xs underline" onClick={() => { setChange({ action: "alias", node }); setValue(""); }}>Add alias</button><button className="text-xs underline" onClick={() => { setChange({ action: "merge", node }); setTarget(""); }}>Merge</button></div>}</li>)}</ul>
      <ol aria-label="Evidence-linked relationships" className="space-y-3">{data.edges.map((edge) => <li key={edge.id} className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><button className="text-signal underline" onClick={() => { setFocus(edge.from_node_id); setNote(""); }}>{edge.from_label}</button><span aria-label="relationship">→ {edge.relation.replaceAll("_", " ")} →</span><button className="text-signal underline" onClick={() => { setFocus(edge.to_node_id); setNote(""); }}>{edge.to_label}</button></div>
        <p className="text-xs text-mist">{edge.disabled ? "Removed · " : ""}{edge.origin === "ai_extracted" ? "AI proposal" : edge.origin === "owner_curated" ? "Owner curated" : "Folder/source structure"} · {edge.review_state.replaceAll("_", " ")}{edge.model ? " · " + edge.model : ""}</p>
        <details><summary className="cursor-pointer text-sm">Inspect supporting passages</summary><ul className="mt-3 space-y-3">{data.evidence.filter((e) => e.edge_id === edge.id).map((e) => <li key={e.id}><blockquote className="border-l-2 border-signal pl-3 text-sm whitespace-pre-wrap max-h-48 overflow-auto">{e.quote}</blockquote><Link className="text-xs text-signal underline" href={"/evidence/" + e.chunk_id}>{e.title} · v{e.note_version} · chunk offsets {e.start_offset}–{e.end_offset}</Link></li>)}</ul></details>
        {edge.origin !== "deterministic" && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setChange({ action: "review", edge })}>{edge.disabled ? "Restore / accept" : "Accept as curated"}</Button><Button size="sm" variant="outline" onClick={() => { setChange({ action: "correct", edge }); setValue(edge.relation); }}>Correct relation</Button>{!edge.disabled && <Button size="sm" variant="ghost" onClick={() => setChange({ action: "remove", edge })}>Remove</Button>}</div>}
      </li>)}</ol>
      {data.truncated && <p className="text-sm text-signal">This neighborhood is bounded. Select a node to inspect fewer relationships.</p>}
      <div className="flex gap-3"><Button variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous nodes</Button><Button variant="outline" disabled={!data.hasMore || offset >= 10000} onClick={() => setOffset(offset + 50)}>Next nodes</Button></div>
    </>}
    <Dialog open={Boolean(change)} onOpenChange={(open) => { if (!open && !busy) setChange(null); }}><DialogHeader><DialogTitle>Review graph change</DialogTitle></DialogHeader>
      {error && <p role="alert" className="text-red-400 mb-3">{error}</p>}
      <fieldset disabled={busy} className="space-y-4 text-sm"><p>{change?.edge ? `${change.edge.from_label} → ${change.edge.relation} → ${change.edge.to_label}` : change?.node?.label}</p>
        <p>{change?.action === "merge" ? "Merge two meanings only when you have verified they are the same concept. Source evidence remains attached; this explicit merge is retained across rebuilds." : "This changes graph interpretation only. Original notes and source quotations remain unchanged."}</p>
        {change?.action === "correct" && <label>Correct relationship<select className="block w-full rounded border border-line bg-ink-2 p-2" value={value} onChange={(e) => setValue(e.target.value)}>{relations.map((r) => <option key={r} value={r}>{r.replaceAll("_", " ")}</option>)}</select></label>}
        {change?.action === "alias" && <label>Alias<Input value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} /></label>}
        {change?.action === "merge" && <><label className="block">Find the equivalent concept<Input value={mergeQuery} onChange={(e) => { setMergeQuery(e.target.value); setTarget(""); }} placeholder="Search concepts in the same folder" /></label><label className="block">Keep this concept<select className="block w-full rounded border border-line bg-ink-2 p-2 mt-1" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a verified equivalent meaning</option>{mergeNodes.filter((n) => n.id !== change.node?.id).map((n) => <option key={n.id} value={n.id}>{n.label} — {n.metadata.description || "Inspect its source before merging"}</option>)}</select></label></>}
      </fieldset><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setChange(null)}>Cancel</Button><Button disabled={busy || (change?.action === "merge" && !target) || (change?.action === "alias" && !value.trim())} onClick={() => void apply()}>{busy ? "Applying…" : "Apply reviewed change"}</Button></DialogFooter>
    </Dialog>
  </div>;
}

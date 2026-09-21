"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Capture } from "./capture";
import { Explorer } from "./explorer";
import { changed, Destination, Markdown, message, request, ROOT, type FolderRecord, type NoteRecord, type SavedReceipt } from "./shared";
const ChatPanel = dynamic(() => import("./chat-panel").then((m) => m.ChatPanel), { loading: () => <p className="p-4">Opening chat…</p> });
interface Version { version: number; title: string; body: string; reason: string; provenance: string; operation_id: string; created_at: string }
export interface Detail { note: NoteRecord; history: Version[]; sources: { id: string; body: string; origin: string; metadata: Record<string, unknown> }[]; processing: { stage: string; status: string; error_code: string | null }[] }
export function Workspace({ noteId, initialData, initialFolders, startCapture = false }: { noteId?: string; initialData?: Detail; initialFolders?: FolderRecord[]; startCapture?: boolean }) {
  const [pane, setPane] = useState<"note" | "explorer" | "chat">("note"), [chatOpen, setChatOpen] = useState(true), [scope, setScope] = useState<string | undefined>(initialData?.note.folder_id);
  return <div className="flex h-[calc(100dvh-57px)] min-h-0 flex-col"><div className="flex items-center gap-2 border-b border-line px-3 py-2"><Button size="sm" variant="ghost" className="md:hidden" onClick={() => setPane("explorer")}>Folders</Button><Button size="sm" variant="ghost" onClick={() => setPane("note")}>Notes</Button><Button size="sm" variant="ghost" onClick={() => { setPane("chat"); setChatOpen(true); }}>AI chat</Button><button className="ml-auto hidden text-xs text-mist xl:block" onClick={() => setChatOpen(!chatOpen)}>{chatOpen ? "Hide chat pane" : "Show chat pane"}</button></div>
    <div className="flex min-h-0 flex-1"><div className={pane === "explorer" ? "w-full overflow-auto p-4 md:hidden" : "hidden"}><Explorer /></div>
      <div className={(pane === "note" ? "flex" : "hidden") + " min-w-0 flex-1 flex-col overflow-auto " + (pane === "explorer" ? "md:flex" : "xl:flex")}>
        {noteId ? <NoteDetail key={noteId} id={noteId} onScope={setScope} initialData={initialData} initialFolders={initialFolders} /> : <Library startCapture={startCapture} />}
      </div>
      {chatOpen ? <aside aria-label="Adjacent AI chat" className={(pane === "chat" ? "flex" : "hidden") + " min-h-0 w-full min-w-0 flex-col border-l border-line xl:flex xl:w-[36%] xl:min-w-[320px]"}><ChatPanel embedded folderId={scope} noteId={noteId} /></aside> : null}
    </div>
  </div>;
}
function Library({ startCapture }: { startCapture: boolean }) {
  const [view, setView] = useState("recent"), [items, setItems] = useState<NoteRecord[]>([]), [folders, setFolders] = useState<FolderRecord[]>([]);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [capture, setCapture] = useState(startCapture), [offset, setOffset] = useState(0);
  const refresh = useCallback(() => { Promise.all([request<{ items: NoteRecord[] }>(`/api/knowledge?view=${view}&limit=50&offset=${offset}`), request<{ folders: FolderRecord[] }>("/api/folders")]).then(([notes, fs]) => { setItems(notes.items); setFolders(fs.folders); setLoading(false); setError(""); }).catch((e) => { setError(message(e)); setLoading(false); }); }, [view, offset]);
  useEffect(() => { refresh(); window.addEventListener("myai:knowledge-changed", refresh); return () => window.removeEventListener("myai:knowledge-changed", refresh); }, [refresh]);
  useEffect(() => { const open = () => setCapture(true); window.addEventListener("myai:new-note", open); return () => window.removeEventListener("myai:new-note", open); }, []);
  return <div className="space-y-5 p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Your second brain</p><h1 className="font-display text-3xl">Knowledge</h1></div><Button disabled={!folders.length} onClick={() => setCapture(true)}>+ Add note</Button></div><p className="text-sm text-mist">Use the explorer + to add notes, subfolders or imports. Open a note to edit, review its history or inspect its sources.</p>
    <label className="block text-sm">Show<select value={view} className="ml-2 rounded border border-line bg-ink-2 p-2" onChange={(e) => { setView(e.target.value); setOffset(0); setLoading(true); }}><option value="recent">Recent notes</option><option value="important">Important</option><option value="archived">Archive</option><option value="trashed">Trash</option></select></label>
    {error ? <p role="alert" className="text-red-400">{error} <button onClick={refresh}>Retry</button></p> : null}
    {loading ? <p role="status">Loading notes…</p> : !items.length ? <p className="rounded border border-dashed border-line p-8 text-sm text-mist">No notes in this view. Your empty folders remain available in the explorer.</p> : <ul className="space-y-2">{items.map((note) => <li key={note.id}><Link href={"/notes/" + note.id} className="block rounded border border-line p-3 hover:border-signal"><p className="break-words font-medium">{note.title}</p><p className="truncate text-xs text-mist">{note.path} · v{note.current_version} · {note.provenance.replaceAll("_", " ")} · importance {note.importance}/5</p></Link></li>)}</ul>}
    <div className="flex gap-3"><Button variant="ghost" disabled={!offset || loading} onClick={() => { setOffset(Math.max(0, offset - 50)); setLoading(true); }}>Previous</Button><Button variant="ghost" disabled={items.length < 50 || loading} onClick={() => { setOffset(offset + 50); setLoading(true); }}>Next</Button></div>
    {capture && folders.length > 0 ? <Capture folders={folders} folderId={ROOT} onClose={() => setCapture(false)} onSaved={refresh} /> : null}
  </div>;
}
function NoteDetail({ id, onScope, initialData, initialFolders }: { id: string; onScope: (id: string) => void; initialData?: Detail; initialFolders?: FolderRecord[] }) {
  const [data, setData] = useState<Detail | null>(initialData ?? null), [folders, setFolders] = useState<FolderRecord[]>(initialFolders ?? []), [error, setError] = useState("");
  const [edit, setEdit] = useState(false), [busy, setBusy] = useState(false), [move, setMove] = useState(false), [destination, setDestination] = useState(ROOT);
  const [version, setVersion] = useState<Version | null>(null), [confirmation, setConfirmation] = useState<{ action: string; lifecycle?: string; operationId?: string } | null>(null);
  const [saved, setSaved] = useState<SavedReceipt | null>(null);
  const refresh = useCallback(() => Promise.all([request<Detail>(`/api/notes/${id}?detail=1`), request<{ folders: FolderRecord[] }>("/api/folders")]).then(([detail, fs]) => { setData(detail); setFolders(fs.folders); setDestination(detail.note.folder_id); onScope(detail.note.folder_id); setError(""); }).catch((e) => setError(message(e))), [id, onScope]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function mutate(body: Record<string, unknown>) {
    if (!data || busy) return; setBusy(true); setError("");
    try {
      const { receipt } = body.action === "undo"
        ? await request<{ receipt: SavedReceipt }>("/api/operations/" + body.operationId + "/undo", "POST", {})
        : await request<{ receipt: SavedReceipt }>("/api/notes/" + id, "PATCH", { ...body, expectedVersion: data.note.current_version });
      setSaved(receipt); changed(); setMove(false); setConfirmation(null); setVersion(null); await refresh();
    }
    catch (e) { setError(message(e) + " Refresh to review the latest version; no newer content was overwritten."); }
    finally { setBusy(false); }
  }
  if (!data) return <div className="p-6">{error ? <p role="alert">{error} <button onClick={refresh}>Retry</button></p> : <p role="status">Opening note…</p>}</div>;
  const note = data.note;
  return <div className="space-y-4 p-4 sm:p-6"><Link href="/knowledge" className="text-sm text-signal">← All notes</Link><div><p className="break-all text-xs text-mist">/{note.path}</p><h1 className="font-display mt-1 break-words text-3xl">{note.title}</h1><p className="mt-2 text-xs text-mist">Version {note.current_version} · {note.lifecycle} · {note.provenance.replaceAll("_", " ")}</p></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || note.lifecycle === "trashed"} onClick={() => setEdit(true)}>Edit / Improve</Button><Button size="sm" variant="outline" disabled={busy || note.lifecycle === "trashed"} onClick={() => setMove(true)}>Move</Button><Button size="sm" variant="ghost" disabled={busy} onClick={refresh}>Refresh</Button>
      {note.lifecycle === "active" ? <><Link className="px-3 py-2 text-sm text-signal underline" href={"/quiz?noteId=" + note.id + "&folderId=" + note.folder_id}>Practice this note</Link><Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmation({ action: "lifecycle", lifecycle: "archived" })}>Archive</Button></> : <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmation({ action: "lifecycle", lifecycle: "active" })}>Restore</Button>}
      {note.lifecycle !== "trashed" ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmation({ action: "lifecycle", lifecycle: "trashed" })}>Move to trash</Button> : null}
    </div>
    <label className="block text-sm">Importance<select className="ml-2 rounded border border-line bg-ink-2 p-1" value={note.importance} disabled={busy || note.lifecycle === "trashed"} onChange={(e) => mutate({ action: "edit", title: note.title, body: note.body, provenance: note.provenance, metadata: note.metadata, importance: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}/5</option>)}</select></label>
    {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}{saved ? <p role="status" className="text-sm text-signal">Saved version {saved.version}. <Link className="underline" href={"/notes/" + saved.noteId}>Open canonical note</Link></p> : null}
    <div className="rounded border border-line p-3 text-xs text-mist"><p>Current indexing: {data.processing.length ? data.processing.map((s) => `${s.stage}: ${s.status}${s.error_code ? " (" + s.error_code + ")" : ""}`).join(" · ") : "Not queued for this version."}</p><p className="mt-1">Saved content is available immediately to keyword search when active. Semantic and graph indexing are separate.</p></div>
    <div className="rounded border border-line bg-ink-1 p-4"><Markdown body={note.body} /></div>
    <details className="rounded border border-line p-3"><summary className="cursor-pointer text-sm">Original sources ({data.sources.length})</summary><div className="mt-3 space-y-3">{data.sources.map((s) => <details key={s.id}><summary className="break-all text-xs text-mist">{s.origin.replaceAll("_", " ")} · {s.id}</summary>{typeof s.metadata.conversationId === "string" ? <Link className="my-2 block text-xs text-signal underline" href={"/chat?session=" + encodeURIComponent(s.metadata.conversationId) + (typeof s.metadata.messageId === "string" ? "&message=" + encodeURIComponent(s.metadata.messageId) : "")}>Open original conversation</Link> : null}<pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{s.body}</pre></details>)}</div></details>
    <details className="rounded border border-line p-3"><summary className="cursor-pointer text-sm">Version history & undo ({data.history.length})</summary><ul className="mt-3 space-y-2">{data.history.map((v) => <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>v{v.version} · {v.reason} · <time dateTime={new Date(v.created_at).toISOString()}>{new Date(v.created_at).toISOString().replace("T", " ").replace("Z", " UTC")}</time></span><Button size="sm" variant="ghost" onClick={() => setVersion(v)}>Review version {v.version}</Button></li>)}</ul></details>
    {edit ? <Capture folderId={note.folder_id} folders={folders} note={note} onClose={() => { setEdit(false); void refresh(); }} onSaved={(receipt) => { setSaved(receipt); }} /> : null}
    {move ? <Dialog open onOpenChange={() => { if (!busy) setMove(false); }}><DialogHeader><DialogTitle>Move note</DialogTitle></DialogHeader><Destination folders={folders} value={destination} onChange={setDestination} disabled={busy} /><p className="mt-3 text-xs text-mist">The note ID and earlier links remain valid.</p>{error ? <p role="alert" className="text-red-400">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setMove(false)}>Cancel</Button><Button disabled={busy} onClick={() => mutate({ action: "move", folderId: destination })}>Move note</Button></DialogFooter></Dialog> : null}
    {version ? <Dialog open wide onOpenChange={() => setVersion(null)}><DialogHeader><DialogTitle>Review version {version.version}</DialogTitle></DialogHeader><p className="mb-3 text-sm">{version.title} · {version.provenance.replaceAll("_", " ")}</p><Markdown body={version.body} /><DialogFooter><Button variant="ghost" onClick={() => setVersion(null)}>Close</Button>{version.version === note.current_version ? <Button disabled={busy} onClick={() => setConfirmation({ action: "undo", operationId: version.operation_id })}>Undo this operation…</Button> : <Button disabled={busy || note.lifecycle === "trashed"} onClick={() => setConfirmation({ action: "restore-content" })}>Restore this content…</Button>}</DialogFooter></Dialog> : null}
    {confirmation ? <Dialog open onOpenChange={() => { if (!busy) setConfirmation(null); }}><DialogHeader><DialogTitle>{confirmation.action === "undo" ? "Undo latest operation?" : confirmation.action === "restore-content" ? "Restore historical content?" : confirmation.lifecycle === "trashed" ? "Move note to trash?" : confirmation.lifecycle === "archived" ? "Archive note?" : "Restore note?"}</DialogTitle></DialogHeader><p className="text-sm">This creates a new version and retains history. Archived and trashed notes are excluded from retrieval. Undo is refused if any affected note has changed.</p>{error ? <p role="alert" className="mt-3 text-red-400">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button disabled={busy} onClick={() => mutate(confirmation.action === "restore-content" && version ? { action: "restore", targetVersion: version.version } : confirmation)}>Confirm</Button></DialogFooter></Dialog> : null}
  </div>;
}

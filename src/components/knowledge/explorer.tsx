"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, ChevronDown, Folder, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Capture } from "./capture";
import { ImportPanel } from "./import-panel";
import { changed, Destination, message, request, ROOT, type FolderRecord } from "./shared";
interface Tree { id: string; name: string; path: string; type: "directory" | "file"; children?: Tree[] }
interface Data { tree: Tree; folders: FolderRecord[]; totalFiles: number }
export function Explorer() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [ROOT]: true });
  const [action, setAction] = useState<{ folder: FolderRecord; kind: "menu" | "note" | "folder" | "manage" | "import" } | null>(null);
  const refresh = useCallback(() => { request<Data>("/api/knowledge").then((result) => { setData(result); setError(""); }).catch((e) => setError(message(e))); }, []);
  useEffect(() => { refresh(); window.addEventListener("myai:knowledge-changed", refresh); return () => window.removeEventListener("myai:knowledge-changed", refresh); }, [refresh]);
  useEffect(() => { Promise.resolve().then(() => { try { const stored = JSON.parse(localStorage.getItem("myai:explorer:v1") || "null"); if (stored && typeof stored === "object") setExpanded({ ...stored, [ROOT]: true }); } catch { /* Use default expansion. */ } }); }, []);
  function toggle(id: string) { const next = { ...expanded, [id]: !expanded[id] }; setExpanded(next); try { localStorage.setItem("myai:explorer:v1", JSON.stringify(next)); } catch { /* Browsing works without persistence. */ } }
  function matches(node: Tree): boolean { return node.name.toLowerCase().includes(query.toLowerCase()) || Boolean(node.children?.some(matches)); }
  function render(node: Tree): React.ReactNode {
    if (query && !matches(node)) return null;
    if (node.type === "file") return <li key={node.id}><Link className="flex min-w-0 items-center gap-2 rounded px-2 py-2 text-sm text-paper-dim hover:bg-ink-2 focus-visible:outline focus-visible:outline-signal" title={node.name} href={"/notes/" + node.id}><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{node.name}</span></Link></li>;
    const open = Boolean(query || expanded[node.id]), folder = data!.folders.find((f) => f.id === node.id)!;
    return <li key={node.id}><div className="flex min-w-0 items-center"><button className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-2 text-left text-sm hover:bg-ink-2" aria-expanded={open} onClick={() => toggle(node.id)} title={node.path || "Root"}>{open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}<Folder className="h-4 w-4 shrink-0 text-mist" /><span className="truncate">{node.id === ROOT ? "Knowledge" : node.name}</span></button><button className="rounded p-2 text-signal hover:bg-ink-2" aria-label={"Add to " + (node.path || "root")} onClick={() => setAction({ folder, kind: "menu" })}><Plus className="h-4 w-4" /></button></div>{open ? <ul className={node.id === ROOT ? "" : "ml-3 border-l border-line pl-1"}>{node.children?.length ? node.children.map(render) : <li className="px-3 py-2 text-xs text-mist">Empty folder · use + to add</li>}</ul> : null}</li>;
  }
  return <section className="min-h-0 text-paper" aria-label="Knowledge explorer"><div className="mb-2 flex items-center justify-between"><h2 className="eyebrow">Explorer</h2><button className="text-xs text-mist hover:text-paper" onClick={refresh}>Refresh</button></div><Input aria-label="Filter explorer" placeholder="Find a folder or note…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2 h-8 text-xs" />
    {error ? <p role="alert" className="p-2 text-xs text-red-400">{error}</p> : null}
    {data ? <><ul>{render(data.tree)}</ul>{data.totalFiles >= 10000 ? <p className="p-2 text-xs text-amber-300">Explorer shows up to 10,000 notes. Use search for other entries.</p> : null}</> : !error ? <p role="status" className="p-2 text-xs text-mist">Loading folders…</p> : null}
    {action?.kind === "note" ? <Capture folderId={action.folder.id} folders={data!.folders} onClose={() => setAction(null)} onSaved={refresh} /> : null}
    {action?.kind === "menu" ? <Dialog open onOpenChange={() => setAction(null)}><DialogHeader><DialogTitle>{action.folder.path ? "/" + action.folder.path : "Root knowledge"}</DialogTitle></DialogHeader><div className="grid gap-2">{([ ["note", "Add note"], ["folder", "Add subfolder"], ["import", "Import notes / code"] ] as const).map(([kind, label]) => <Button key={kind} variant="outline" onClick={() => setAction({ ...action, kind })}>{label}</Button>)}{action.folder.id !== ROOT ? <Button variant="ghost" onClick={() => setAction({ ...action, kind: "manage" })}>Manage folder</Button> : null}<Button variant="ghost" onClick={() => setAction(null)}>Close</Button></div></Dialog> : null}
    {action?.kind === "import" ? <Dialog open onOpenChange={() => setAction(null)}><DialogHeader><DialogTitle>Import into /{action.folder.path}</DialogTitle></DialogHeader><ImportPanel folderId={action.folder.id} /></Dialog> : null}
    {action && (action.kind === "folder" || action.kind === "manage") ? <FolderAction key={action.kind + action.folder.id} kind={action.kind} folder={action.folder} folders={data!.folders} close={() => setAction(null)} /> : null}
  </section>;
}
function FolderAction({ kind, folder, folders, close }: { kind: "folder" | "manage"; folder: FolderRecord; folders: FolderRecord[]; close: () => void }) {
  const [name, setName] = useState(kind === "manage" ? folder.name : ""), [parent, setParent] = useState(kind === "manage" ? folder.parent_id! : folder.id);
  const [order, setOrder] = useState(folder.sort_order), [alias, setAlias] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request("/api/folders", kind === "manage" ? "PATCH" : "POST", kind === "manage" ? { id: folder.id, name, parentId: parent, sortOrder: order, aliases: alias.split(/[,\n]/).map((v) => v.trim()).filter(Boolean) } : { name, parentId: parent }); changed(); close();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function remove() { setBusy(true); setError(""); try { await request("/api/folders", "DELETE", { id: folder.id }); changed(); close(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  const destinations = kind === "manage" ? folders.filter((f) => f.id !== folder.id && !f.path.startsWith(folder.path + "/")) : folders;
  return <Dialog open onOpenChange={() => { if (!busy) close(); }}><DialogHeader><DialogTitle>{kind === "manage" ? "Manage folder" : "Add subfolder"}</DialogTitle></DialogHeader>
    <form onSubmit={submit}><fieldset disabled={busy} className="space-y-4"><Destination folders={destinations} value={parent} onChange={setParent} />
      <label className="block text-sm">Folder name<Input autoFocus value={name} required maxLength={200} onChange={(e) => setName(e.target.value)} /></label>
      {kind === "manage" ? <><label className="block text-sm">Order (lower comes first)<Input type="number" min={-100000} max={100000} value={order} onChange={(e) => setOrder(Number(e.target.value))} /></label><p className="break-all text-xs text-mist">Existing aliases: {folder.aliases.join(", ") || "None"}. Rename and move preserve former paths.</p><label className="block text-sm">Add aliases (comma separated)<Input value={alias} placeholder="java-basics, programming/java" onChange={(e) => setAlias(e.target.value)} /></label><p className="text-xs text-mist">Aliases are retained to protect links. Only empty folders without historical note references can be deleted.</p>{confirmDelete ? <Button type="button" variant="destructive" onClick={remove}>Confirm delete empty folder</Button> : <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete empty folder…</Button>}</> : null}
    </fieldset>{error ? <p role="alert" className="mt-3 text-sm text-red-400">{error}</p> : null}<DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Working…" : kind === "manage" ? "Save folder" : "Create folder"}</Button></DialogFooter></form>
  </Dialog>;
}

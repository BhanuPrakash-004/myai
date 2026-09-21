"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createParser } from "eventsource-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { changed, Destination, Markdown, message, request, ROOT, type FolderRecord, type NoteRecord, type Proposal } from "./shared";
import { apiFetch } from "@/lib/client-api";

type Mode = "auto" | "ask" | "generate" | "save" | "improve";
interface Memory { saved: boolean; noteId?: string; filePath?: string; version?: number; indexing?: string; title?: string }
interface Evidence { id: string; version: number; title: string; path: string; chunkId?: string; url?: string }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; status: string; sequence?: number; operation_id?: string; operation_status?: string; metadata?: { memory?: Memory; evidence?: Evidence[]; proposal?: Proposal & { applied?: boolean; state?: string }; mode?: string }; retry_key?: string; retry_request?: TurnRequest }
interface Session { id: string; title: string; folder_id: string; archived: boolean }
interface TurnRequest { sessionId?: string; messages: { role: "user"; content: string }[]; folderId: string; mode?: Exclude<Mode, "auto">; noteId?: string; expectedVersion?: number; retry?: boolean }
interface Pending { key: string; request: TurnRequest; operationId?: string }
interface History { session: Session; messages: ChatMessage[]; hasOlder: boolean }
interface ToolPlan { id: string; original: string; originalTitle?: string; changes: string[]; change: { action: string; title?: string; body?: string; folderId?: string; noteId?: string; expectedVersion?: number; lifecycle?: string } }
const storageKey = "myai:chat:v2";
export function ChatPanel({ embedded = false, folderId, noteId, initialSessionId, initialMessageId }: { embedded?: boolean; folderId?: string; noteId?: string; initialSessionId?: string; initialMessageId?: string }) {
  const [sessions, setSessions] = useState<Session[]>([]), [sessionId, setSessionId] = useState(""), [archived, setArchived] = useState(false), [sessionArchived, setSessionArchived] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]), [folders, setFolders] = useState<FolderRecord[]>([]), [notes, setNotes] = useState<NoteRecord[]>([]);
  const [input, setInput] = useState(""), [mode, setMode] = useState<Mode>("auto"), [scope, setScope] = useState(folderId ?? ROOT), [selected, setSelected] = useState<NoteRecord | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [booted, setBooted] = useState(false), [hasOlder, setHasOlder] = useState(false);
  const [moreSessions, setMoreSessions] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [storageWarning, setStorageWarning] = useState("");
  const [manage, setManage] = useState(false), [title, setTitle] = useState(""), [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSave, setConfirmSave] = useState<Pending | null>(null), [review, setReview] = useState<{ messageId: string; proposal: Proposal } | null>(null);
  const [reviewTitle, setReviewTitle] = useState(""), [reviewBody, setReviewBody] = useState(""), [reviewKey, setReviewKey] = useState("");
  const [planVisible, setPlanVisible] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false), [toolAction, setToolAction] = useState("edit"), [destination, setDestination] = useState(ROOT), [plan, setPlan] = useState<ToolPlan | null>(null), [noteView, setNoteView] = useState("recent");
  const focusedMessage = useRef(false);
  const controller = useRef<AbortController | null>(null), thread = useRef<HTMLDivElement>(null), pendingRef = useRef<Pending | null>(null), activeSession = useRef("");
  const loadHistory = useCallback(async (id: string, before?: number) => {
    const data = await request<History>("/api/chat?sessionId=" + id + (before ? "&before=" + before : initialMessageId && !focusedMessage.current ? "&message=" + initialMessageId : ""));
    if (activeSession.current !== id) return;
    setMessages((current) => before ? [...data.messages, ...current.filter((m) => !data.messages.some((n) => n.id === m.id))] : data.messages);
    setSessionArchived(data.session.archived); setTitle(data.session.title); setHasOlder(data.hasOlder);
  }, [initialMessageId]);
  const loadSessions = useCallback(() => request<{ sessions: Session[]; hasMoreSessions?: boolean }>("/api/chat?archived=" + archived).then((data) => { setSessions(data.sessions); setMoreSessions(Boolean(data.hasMoreSessions)); }), [archived]);
  const loadFolders = useCallback(() => request<{ folders: FolderRecord[] }>("/api/folders").then((data) => setFolders(data.folders)), []);
  useEffect(() => {
    let alive = true;
    Promise.all([request<{ folders: FolderRecord[] }>("/api/folders"), request<{ sessions: Session[]; hasMoreSessions?: boolean }>("/api/chat")]).then(async ([fs, cs]) => {
      if (!alive) return;
      setFolders(fs.folders); setSessions(cs.sessions); setMoreSessions(Boolean(cs.hasMoreSessions));
      let stored: { sessionId?: string; input?: string; mode?: Mode; scope?: string; pending?: Pending; plan?: ToolPlan } = {};
      try { stored = JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { setStorageWarning("Browser recovery is unavailable; server chat history remains saved."); }
      const id = initialSessionId ?? stored.sessionId;
      setInput(typeof stored.input === "string" ? stored.input : ""); setMode(["auto", "ask", "generate", "save", "improve"].includes(stored.mode ?? "") ? stored.mode! : "auto");
      setScope(folderId ?? stored.scope ?? ROOT); setPlan(stored.plan ?? null);
      if (stored.pending) { pendingRef.current = stored.pending; setPending(stored.pending); setNotice("An unfinished request was recovered. Check status before retrying."); }
      if (id) { activeSession.current = id; setSessionId(id); try { await loadHistory(id); } catch (e) { setError(message(e)); } }
      if (alive) setBooted(true);
    }).catch((e) => { if (alive) { setError(message(e)); setBooted(true); } });
    return () => { alive = false; controller.current?.abort(); };
  }, [initialSessionId, folderId, loadHistory]);
  useEffect(() => { if (!booted) return; try { localStorage.setItem(storageKey, JSON.stringify({ sessionId, input, mode, scope, pending, plan })); } catch { queueMicrotask(() => setStorageWarning("Draft recovery could not be stored in this browser.")); } }, [booted, sessionId, input, mode, scope, pending, plan]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { if (!booted) return; request<{ items: NoteRecord[] }>(`/api/knowledge?view=${noteView}&folderId=${scope}&limit=200`).then((data) => setNotes(data.items)).catch((e) => setError(message(e))); }, [booted, scope, noteView]);
  useEffect(() => { if (!noteId || !folderId) return; request<{ note: NoteRecord }>("/api/chat/tools", "POST", { tool: "read", folderId, noteId }).then((data) => setSelected(data.note)).catch((e) => setError(message(e))); }, [noteId, folderId]);
  useEffect(() => { const refresh = () => { void loadFolders().catch((e) => setError(message(e))); }; window.addEventListener("myai:knowledge-changed", refresh); return () => window.removeEventListener("myai:knowledge-changed", refresh); }, [loadFolders]);
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: busy ? "auto" : "smooth" }); }, [messages.length, busy]);
  useEffect(() => { if (initialMessageId && !focusedMessage.current && messages.some((m) => m.id === initialMessageId)) { document.getElementById("message-" + initialMessageId)?.scrollIntoView({ block: "center" }); focusedMessage.current = true; } }, [initialMessageId, messages]);
  async function chooseSession(id: string) {
    if (busy) return; setError(""); activeSession.current = id; setSessionId(id); setMessages([]); setSelected(null);
    try { if (id) { const data = await request<History>("/api/chat?sessionId=" + id); setScope(data.session.folder_id || ROOT); setMessages(data.messages); setSessionArchived(data.session.archived); setTitle(data.session.title); setHasOlder(data.hasOlder); } else { setSessionArchived(false); setTitle(""); setHasOlder(false); } } catch (e) { setError(message(e)); }
  }
  function recordPending(value: Pending | null) { pendingRef.current = value; setPending(value); try { const stored = JSON.parse(localStorage.getItem(storageKey) || "{}"); localStorage.setItem(storageKey, JSON.stringify({ ...stored, pending: value, sessionId: activeSession.current })); } catch { setStorageWarning("Request recovery could not be stored in this browser."); } }
  async function send(existing?: Pending) {
    if (busy || sessionArchived) return;
    const draft: Pending = existing ?? { key: crypto.randomUUID(), request: { sessionId: sessionId || undefined, messages: [{ role: "user", content: input }], folderId: scope, mode: mode === "auto" ? undefined : mode, ...(selected ? { noteId: selected.id, expectedVersion: selected.current_version } : {}) } };
    if (!draft.request.messages[0].content.trim()) return;
    if (!existing && mode === "save" && selected) { setConfirmSave(draft); return; }
    recordPending(draft); setBusy(true); setStreaming(true); setError(""); setNotice(""); controller.current = new AbortController();
    const localId = "pending:" + draft.key; let reply = "", completed = false, currentSession = sessionId;
    setMessages((current) => [...current, { id: localId + ":user", role: "user", content: draft.request.messages[0].content, status: "completed" }, { id: localId, role: "assistant", content: "", status: "streaming" }]);
    try {
      const response = await apiFetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": draft.key }, body: JSON.stringify(draft.request), signal: controller.current.signal });
      if (!response.ok) { const body = await response.json(); if (body.details?.operationId) { draft.operationId = body.details.operationId; recordPending(draft); } throw new Error(body.error || "Chat request failed."); }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.json(); setScope(body.folderId); setInput(""); setMessages((current) => current.filter((m) => !m.id.startsWith(localId))); recordPending(null); setNotice("Folder scope selected. Add a topic or question."); return;
      }
      const reader = response.body?.getReader(); if (!reader) throw new Error("Response stream is unavailable.");
      const parser = createParser({ onEvent(event) {
        if (event.data === "[DONE]") return;
        const data = JSON.parse(event.data);
        if (data.type === "meta" && data.operationId) { draft.operationId = data.operationId; currentSession = data.sessionId; activeSession.current = currentSession; setSessionId(currentSession); setScope(data.folderId); recordPending({ ...draft }); }
        if (data.type === "chunk") { reply += data.content; setMessages((current) => current.map((m) => m.id === localId ? { ...m, content: reply } : m)); }
        if (data.type === "complete") { completed = true; setMessages((current) => current.map((m) => m.id === localId ? { ...m, id: data.result.assistantId, content: data.result.reply, status: "completed", metadata: { memory: data.result.memory, evidence: data.result.evidence, proposal: data.result.proposal, mode: data.result.mode } } : m)); if (data.result.memory?.saved) changed(); }
        if (data.type === "error") { setError(data.message); setMessages((current) => current.map((m) => m.id === localId ? { ...m, status: "failed" } : m)); }
        if (data.type === "retrieval") setNotice((data.warnings || []).join(" "));
      } });
      const decoder = new TextDecoder();
      try { while (true) { const { done, value } = await reader.read(); if (done) break; parser.feed(decoder.decode(value, { stream: true })); } parser.feed(decoder.decode()); } finally { reader.releaseLock(); }
      if (completed) { recordPending(null); setInput(""); } else setNotice("Response incomplete. Check stored status; retry deduplicates saved notes but may incur another inference charge.");
      if (currentSession) await loadHistory(currentSession); await loadSessions();
    } catch (e) { setError(controller.current.signal.aborted ? "Stopped. Partial text is retained; check status before retrying." : message(e)); setMessages((current) => current.map((m) => m.id === localId ? { ...m, status: "interrupted" } : m)); }
    finally { setBusy(false); setStreaming(false); controller.current = null; }
  }
  async function checkStatus() {
    if (!pending) return;
    if (!pending.operationId) { setNotice("No operation receipt reached the browser. Retry uses the same request key to recover or deduplicate it."); return; }
    try { const { operation } = await request<{ operation: { status: string; session_id: string; result?: { memory?: Memory } } }>("/api/chat/operations/" + pending.operationId); setNotice("Stored response status: " + operation.status + (operation.status === "running" ? ". Interrupted server work is recoverable after its three-minute lease expires." : ""));
      if (operation.status === "completed") { recordPending(null); setInput(""); if (operation.result?.memory?.saved) changed(); }
      activeSession.current = operation.session_id; setSessionId(operation.session_id); await loadHistory(operation.session_id);
    } catch (e) { setError(message(e)); }
  }
  async function stop() { controller.current?.abort(); const id = pendingRef.current?.operationId; if (id) { try { await request("/api/chat/operations/" + id, "DELETE"); setNotice("Response cancelled. Already-committed saves remain available in history."); } catch (e) { setError(message(e)); } } }
  async function manageSession(action: "rename" | "archive" | "restore" | "delete" | "create") {
    setError(""); setBusy(true);
    try { if (action === "create") { const id = crypto.randomUUID(); await request("/api/chat", "PATCH", { action: "create", id, title: "New conversation", folderId: scope }); await chooseSession(id); }
      else if (action === "delete") { await request("/api/chat?sessionId=" + sessionId, "DELETE"); await chooseSession(""); }
      else { await request("/api/chat", "PATCH", { action: "update", id: sessionId, ...(action === "rename" ? { title } : { archived: action === "archive" }) }); setSessionArchived(action === "archive"); }
      setManage(false); setConfirmDelete(false); await loadSessions();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function chooseScope(id: string) {
    setScope(id); setSelected(null);
    const prefix = input.match(/^\/[^\s]*(?:\s([\s\S]*))?$/);
    if (prefix) { setInput(prefix[1] ?? ""); if (mode === "auto") setMode("generate"); }
    setNotice("Folder selected by its stable ID. Review the mode before sending.");
  }
  async function refreshSelected() {
    if (!selected) return;
    try { const data = await request<{ note: NoteRecord }>("/api/chat/tools", "POST", { tool: "read", folderId: scope, noteId: selected.id }); setSelected(data.note); setNotice("Loaded current note version " + data.note.current_version + ". Review it before applying changes."); } catch (e) { setError(message(e)); }
  }
  async function createFolder(path: string) { setBusy(true); try { const result = await request<{ folderId: string }>("/api/chat/tools", "POST", { tool: "create-folder", path }); await loadFolders(); setScope(result.folderId); setSelected(null); changed(); setNotice("Folder created. Review your mode and send when ready."); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function saveAnswer(id: string) { setBusy(true); setError(""); try { await request("/api/chat/tools", "POST", { tool: "save-answer", messageId: id, folderId: scope }); changed(); await loadHistory(sessionId); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function openProposal(m: ChatMessage) { const p = m.metadata!.proposal!; setReview({ messageId: m.id, proposal: p }); setReviewTitle(p.title); setReviewBody(p.body); setReviewKey(crypto.randomUUID()); }
  async function decideProposal(apply: boolean) { if (!review) return; setBusy(true); setError(""); try {
    if (apply) { await request("/api/chat/tools", "POST", { tool: "apply-improvement", messageId: review.messageId, proposalId: review.proposal.id, title: reviewTitle, body: reviewBody }, reviewKey); changed(); }
    else await request("/api/improvements", "PATCH", { id: review.proposal.id, decision: "reject" });
    setReview(null); await loadHistory(sessionId);
  } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function planChange() { setBusy(true); setError(""); try { const result = await request<{ plan: ToolPlan }>("/api/chat/tools", "POST", { tool: "plan", folderId: scope, instructions: input || toolAction, allowedAction: toolAction, ...(selected ? { noteId: selected.id, expectedVersion: selected.current_version } : {}), ...(toolAction === "move" ? { destinationId: destination } : {}) }); setPlan(result.plan); setPlanVisible(true); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  async function applyPlan(apply: boolean) { if (!plan) return; setBusy(true); setError(""); try { const result = await request<{ receipt?: { noteId: string; version: number } }>("/api/chat/tools", "POST", { tool: apply ? "apply" : "reject", planId: plan.id }); if (result.receipt) { changed(); setNotice("Saved version " + result.receipt.version + ". Open the note from the explorer."); if (selected) { const current = await request<{ note: NoteRecord }>("/api/notes/" + selected.id); setSelected(current.note); } } setPlan(null); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  const slash = input.match(/^\/([^\s]*)(?:\s[\s\S]*)?$/), candidates = slash ? folders.flatMap((f) => [f.path, ...f.aliases].filter(Boolean).filter((p) => p.startsWith(slash[1].toLowerCase())).map((path) => ({ ...f, command: "/" + path }))).slice(0, 12) : [];
  const unknownPath = slash && slash[1] && !folders.some((f) => f.path === slash[1].toLowerCase() || f.aliases.includes(slash[1].toLowerCase())) ? slash[1] : "";
  const effectiveMode = mode === "auto" ? slash ? "generate" : "ask" : mode;
  return <section aria-label="AI chat" className={embedded ? "flex h-full min-h-0 flex-col bg-ink-0" : "flex h-[calc(100dvh-57px)] min-h-0 flex-col bg-ink-0"}>
    <header className="space-y-2 border-b border-line p-3"><div className="flex items-center justify-between gap-2"><h1 className="font-display text-xl">AI chat</h1><Button size="sm" variant="ghost" disabled={busy} onClick={() => manageSession("create")}>New conversation</Button></div>
      <div className="flex gap-2"><select aria-label="Conversation" className="min-w-0 flex-1 rounded border border-line bg-ink-2 p-2 text-sm" value={sessionId} disabled={busy} onChange={(e) => chooseSession(e.target.value)}><option value="">Choose a conversation</option>{sessionId && !sessions.some((s) => s.id === sessionId) ? <option value={sessionId}>{title || "Current conversation"}</option> : null}{sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select><Button size="sm" variant="outline" disabled={!sessionId || busy} onClick={() => setManage(true)}>Manage</Button></div>
      <label className="text-xs text-mist"><input type="checkbox" checked={archived} disabled={busy} onChange={(e) => { const value = e.target.checked; setArchived(value); request<{ sessions: Session[]; hasMoreSessions?: boolean }>("/api/chat?archived=" + value).then((r) => { setSessions(r.sessions); setMoreSessions(Boolean(r.hasMoreSessions)); }).catch((e) => setError(message(e))); }} /> Show archived conversations</label>
      {moreSessions ? <button className="text-xs text-signal underline" disabled={busy} onClick={() => request<{ sessions: Session[]; hasMoreSessions: boolean }>("/api/chat?archived=" + archived + "&offset=" + sessions.length).then((r) => { setSessions((current) => [...current, ...r.sessions.filter((n) => !current.some((c) => c.id === n.id))]); setMoreSessions(r.hasMoreSessions); }).catch((e) => setError(message(e)))}>Load older conversations</button> : null}
    </header>
    <div ref={thread} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {hasOlder ? <Button size="sm" variant="ghost" onClick={() => loadHistory(sessionId, messages[0]?.sequence).catch((e) => setError(message(e)))}>Load earlier messages</Button> : null}
      {!messages.length ? <p className="text-sm leading-6 text-mist">Ask uses current library passages and checks cited support before answering. Use /folder topic to generate and save general information, or select an explicit mode. /folder alone selects the destination. Open a source link to inspect its exact saved version.</p> : null}
      {messages.map((m) => <article key={m.id} id={"message-" + m.id} className={m.role === "user" ? "rounded border border-line bg-ink-2 p-3" : "space-y-2"}><p className="text-xs text-mist">{m.role === "user" ? "You" : "MyAI"} · {m.status}</p><Markdown body={m.content} />
        {m.metadata?.evidence?.length ? <div className="flex flex-wrap gap-2 text-xs">{m.metadata.evidence.map((e) => <Link key={e.chunkId || e.id} href={e.url || "/notes/" + e.id} className="text-signal underline">{e.title} · source v{e.version}</Link>)}</div> : null}
        {m.metadata?.memory?.saved ? <p role="status" className="rounded border border-signal/40 p-2 text-xs text-signal">Saved {m.metadata.memory.title || "note"} · v{m.metadata.memory.version} · <Link className="underline" href={"/notes/" + m.metadata.memory.noteId}>{m.metadata.memory.filePath}</Link> · indexing queued at save; open note for current status.</p> : null}
        {m.role === "assistant" && m.status === "completed" ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(m.content).then(() => setNotice("Copied answer.")).catch(() => setError("Clipboard unavailable."))}>Copy</Button>{m.metadata?.mode === "ask" && !m.metadata.memory?.saved ? <Button size="sm" variant="outline" disabled={busy} onClick={() => saveAnswer(m.id)}>Save this answer to selected folder</Button> : null}{m.metadata?.proposal && !m.metadata.proposal.applied && !["rejected", "cancelled"].includes(m.metadata.proposal.state || "") ? <Button size="sm" variant="outline" disabled={busy} onClick={() => openProposal(m)}>Review improvement & save</Button> : null}</div> : null}
        {m.role === "assistant" && ["failed", "cancelled", "interrupted"].includes(m.operation_status || "") && m.retry_key && m.retry_request ? <Button size="sm" variant="outline" disabled={busy || sessionArchived} onClick={() => send({ key: m.retry_key!.replace(/^chat:/, ""), request: { ...m.retry_request!, retry: true }, operationId: m.operation_id })}>Retry this turn</Button> : null}
      </article>)}
    </div>
    <div className="space-y-2 border-t border-line bg-ink-1 p-3">
      {error ? <p role="alert" className="break-words text-sm text-red-400">{error}</p> : null}{notice ? <p role="status" className="text-xs text-mist">{notice}</p> : null}{storageWarning ? <p role="alert" className="text-xs text-amber-300">{storageWarning}</p> : null}
      {pending && !busy ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={checkStatus}>Check last request</Button><Button size="sm" variant="outline" onClick={() => send({ ...pending, request: { ...pending.request, retry: true } })}>Retry same request</Button><Button size="sm" variant="ghost" onClick={() => { recordPending(null); setNotice("Recovery shortcut cleared. The recorded turn remains in conversation history."); }}>Dismiss shortcut</Button></div> : null}
      <Destination folders={folders} value={scope} disabled={busy} onChange={chooseScope} />
      <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 text-xs">Context note<select aria-label="Context note" className="mt-1 w-full rounded border border-line bg-ink-2 p-2 text-sm" value={selected?.id ?? ""} disabled={busy} onChange={(e) => setSelected(notes.find((n) => n.id === e.target.value) ?? null)}><option value="">No targeted note</option>{selected && !notes.some((n) => n.id === selected.id) ? <option value={selected.id}>{selected.title}</option> : null}{notes.map((n) => <option key={n.id} value={n.id}>{n.title} · v{n.current_version}</option>)}</select></label><label className="text-xs">Mode<select aria-label="Chat mode" value={mode} disabled={busy} className="mt-1 block rounded border border-line bg-ink-2 p-2 text-sm" onChange={(e) => setMode(e.target.value as Mode)}><option value="auto">Auto: Ask / slash saves</option><option value="ask">Ask — read only</option><option value="generate">Generate & Save</option><option value="save">Save As Written</option><option value="improve">Improve & Save</option></select></label></div>
      {slash ? <div className="max-h-28 overflow-auto rounded border border-line">{candidates.map((f) => <button key={f.id + f.command} className="block w-full truncate p-2 text-left text-xs text-signal hover:bg-ink-2" onClick={() => chooseScope(f.id)}>{f.command} → /{f.path}</button>)}{unknownPath ? <Button size="sm" variant="outline" disabled={busy} onClick={() => createFolder(unknownPath)}>Create /{unknownPath}</Button> : null}</div> : null}
      <Textarea aria-label="Chat message" value={input} maxLength={200000} rows={3} disabled={busy || sessionArchived || !booted} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} placeholder="Ask a question, paste text, or /java explain classes" />
      <div className="flex items-center justify-between gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setToolsOpen(!toolsOpen)}>Note tools</Button><span className="text-xs text-mist">{effectiveMode === "ask" ? "Read only" : effectiveMode === "improve" ? "Review before saving" : selected && effectiveMode === "save" ? "Review targeted replacement" : "Saves to selected folder"}</span>{busy ? <Button size="sm" variant="outline" disabled={!streaming} onClick={stop}>{streaming ? "Stop" : "Working…"}</Button> : <Button size="sm" disabled={!input.trim() || sessionArchived || !booted} onClick={() => send()}>Send</Button>}</div>
      {toolsOpen ? <section className="space-y-2 rounded border border-line p-2"><p className="text-xs text-mist">Tools act only on the selected note and version. Enter instructions above, review the exact change, then apply.</p><div className="flex gap-2"><select aria-label="Note list lifecycle" value={noteView} onChange={(e) => { setNoteView(e.target.value); setSelected(null); }} className="rounded bg-ink-2 p-2 text-xs"><option value="recent">Active notes</option><option value="archived">Archived</option><option value="trashed">Trash</option></select><select aria-label="Tool action" className="min-w-0 rounded bg-ink-2 p-2 text-xs" value={toolAction} onChange={(e) => setToolAction(e.target.value)}><option value="edit">Propose targeted edit</option><option value="create">Propose new note</option><option value="move">Move note</option><option value="trash">Trash note</option><option value="restore">Restore note</option></select></div>{toolAction === "move" ? <Destination folders={folders} value={destination} onChange={setDestination} /> : null}<Button size="sm" variant="ghost" disabled={busy || !selected} onClick={refreshSelected}>Refresh selected note</Button><Button size="sm" variant="outline" disabled={busy || (toolAction !== "create" && !selected) || (toolAction === "create" && Boolean(selected))} onClick={planChange}>Prepare change for review</Button>{plan ? <Button size="sm" variant="outline" onClick={() => setPlanVisible(true)}>Review pending change</Button> : null}</section> : null}
    </div>
    {manage ? <Dialog open onOpenChange={() => setManage(false)}><DialogHeader><DialogTitle>Conversation settings</DialogTitle></DialogHeader><label className="block text-sm">Title<Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label><p className="mt-3 text-xs text-mist">Deleting removes this conversation from history. Linked messages and sources remain retained for saved-note provenance.</p><DialogFooter><Button variant="ghost" onClick={() => setManage(false)}>Close</Button><Button disabled={busy || !title.trim()} onClick={() => manageSession("rename")}>Rename</Button><Button variant="outline" disabled={busy} onClick={() => manageSession(sessionArchived ? "restore" : "archive")}>{sessionArchived ? "Restore" : "Archive"}</Button><Button variant="destructive" disabled={busy} onClick={() => confirmDelete ? manageSession("delete") : setConfirmDelete(true)}>{confirmDelete ? "Confirm delete" : "Delete…"}</Button></DialogFooter></Dialog> : null}
    {confirmSave ? <Dialog open wide onOpenChange={() => setConfirmSave(null)}><DialogHeader><DialogTitle>Replace selected note as written?</DialogTitle></DialogHeader><p className="text-sm">{selected?.title} · expected v{selected?.current_version}. A conflict will preserve the newer version.</p><div className="grid gap-3 md:grid-cols-2"><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">{selected?.body}</pre><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-sm">{confirmSave.request.messages[0].content}</pre></div><DialogFooter><Button variant="ghost" onClick={() => setConfirmSave(null)}>Cancel</Button><Button onClick={() => { const value = confirmSave; setConfirmSave(null); void send(value); }}>Save reviewed replacement</Button></DialogFooter></Dialog> : null}
    {review ? <Dialog open wide onOpenChange={() => { if (!busy) setReview(null); }}><DialogHeader><DialogTitle>Review improvement</DialogTitle></DialogHeader><div className="grid gap-3 md:grid-cols-2"><section><p className="mb-2 text-sm">Original — preserved as a source</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{review.proposal.original}</pre></section><section><label className="block text-sm">Proposed title<Input disabled={busy} value={reviewTitle} onChange={(e) => { setReviewTitle(e.target.value); setReviewKey(crypto.randomUUID()); }} /></label><label className="block text-sm">Editable proposal<Textarea disabled={busy} rows={12} value={reviewBody} onChange={(e) => { setReviewBody(e.target.value); setReviewKey(crypto.randomUUID()); }} /></label></section></div><p className="mt-3 text-xs text-mist">{review.proposal.changes.join(" · ")}</p>{review.proposal.uncertainties.length ? <p className="mt-2 text-xs text-amber-300">Review carefully: {review.proposal.uncertainties.join(" · ")}</p> : null}{error ? <p role="alert" className="text-red-400">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setReview(null)}>Close · keep proposal</Button><Button variant="outline" disabled={busy} onClick={() => decideProposal(false)}>Reject</Button><Button disabled={busy || !reviewTitle.trim()} onClick={() => decideProposal(true)}>Apply & Save</Button></DialogFooter></Dialog> : null}
    {plan && planVisible ? <Dialog open wide onOpenChange={() => setPlanVisible(false)}><DialogHeader><DialogTitle>Review {plan.change.action} change</DialogTitle></DialogHeader><p className="break-all text-sm">Target: {plan.change.noteId ?? "New note"} · expected version {plan.change.expectedVersion ?? "new"} · destination {folders.find((f) => f.id === plan.change.folderId)?.path ?? plan.change.folderId ?? "unchanged"}</p><ul className="my-3 list-inside list-disc text-sm">{plan.changes.map((c, i) => <li key={i}>{c}</li>)}</ul><div className="grid gap-3 md:grid-cols-2"><section><h3>Original</h3><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{plan.original}</pre></section><section><h3>{plan.change.title || "Proposed change"}</h3><Markdown body={plan.change.body ?? plan.change.lifecycle ?? "Content unchanged"} /></section></div>{error ? <p role="alert" className="mt-3 text-red-400">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setPlanVisible(false)}>Close · keep plan</Button><Button variant="outline" disabled={busy} onClick={() => applyPlan(false)}>Reject</Button><Button disabled={busy} onClick={() => applyPlan(true)}>Apply reviewed change</Button></DialogFooter></Dialog> : null}
  </section>;
}

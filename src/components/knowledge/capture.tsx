"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { changed, Destination, Markdown, message, request, RequestError, type FolderRecord, type NoteRecord, type Proposal, type SavedReceipt } from "./shared";

interface Draft { schema: 1; title: string; body: string; folderId: string; importance: number; key: string; proposal?: Proposal; proposedTitle?: string; proposedBody?: string; expectedVersion?: number; improveKey?: string }
export function Capture({ folderId, folders, note, onClose, onSaved }: { folderId: string; folders: FolderRecord[]; note?: NoteRecord; onClose: () => void; onSaved: (receipt: SavedReceipt) => void }) {
  const storageKey = "myai:draft:v1:" + (note?.id ?? "new:" + folderId);
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "improve" | "" >(""), [preview, setPreview] = useState(false), [receipt, setReceipt] = useState<SavedReceipt | null>(null);
  const controller = useRef<AbortController | null>(null), latest = useRef<Draft | null>(null);
  const [conflict, setConflict] = useState<NoteRecord | null>(null);
  const currentNote = conflict ?? note;
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      let recovered: Draft | null = null;
      try { const raw = localStorage.getItem(storageKey); const value = raw ? JSON.parse(raw) : null;
        if (value?.schema === 1 && typeof value.title === "string" && typeof value.body === "string" && typeof value.key === "string" && typeof value.folderId === "string") recovered = value;
      } catch { if (active) setNotice("Browser draft storage is unavailable. Keep this window open until saved."); }
      if (!active) return;
      const next: Draft = recovered ?? { schema: 1, title: note?.title ?? "", body: note?.body ?? "", folderId, importance: note?.importance ?? 3, key: crypto.randomUUID(), expectedVersion: note?.current_version };
      latest.current = next; setDraft(next); if (recovered) setNotice("Recovered your draft from this browser. Review it before saving.");
    });
    return () => { active = false; controller.current?.abort(); };
  }, [storageKey, folderId, note]);
  function update(patch: Partial<Draft>, rotate = true) {
    if (!latest.current) return;
    const next = { ...latest.current, ...patch, ...(rotate ? { key: crypto.randomUUID() } : {}) };
    latest.current = next; setDraft(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setNotice("Draft could not be stored in this browser. Keep this window open until saved."); }
  }
  function finish(saved: SavedReceipt) {
    try { localStorage.removeItem(storageKey); } catch { /* Keep the receipt visible. */ }
    setReceipt(saved); changed(); onSaved(saved);
  }
  async function save(improved: boolean) {
    if (!draft || busy) return;
    update({}, false); setBusy("save"); setError("");
    try {
      const result = draft.proposal
        ? await request<{ receipt: SavedReceipt }>("/api/improvements", "PATCH", { id: draft.proposal.id, decision: improved ? "apply" : "original", changes: { title: improved ? draft.proposedTitle : draft.title || "Untitled note", body: improved ? draft.proposedBody : draft.body, importance: draft.importance } }, draft.key)
        : await request<{ receipt: SavedReceipt }>(note ? "/api/notes/" + note.id : "/api/knowledge", note ? "PATCH" : "POST", {
          ...(note ? { action: "edit", expectedVersion: draft.expectedVersion, metadata: currentNote?.metadata } : { folderId: draft.folderId }),
          title: draft.title || "Untitled note", body: draft.body, importance: draft.importance, provenance: "user_written",
        }, draft.key);
      finish(result.receipt);
    } catch (e) { setError(message(e)); if (note && e instanceof RequestError && e.status === 409) { try { const current = await request<{ note: NoteRecord }>("/api/notes/" + note.id); setConflict(current.note); } catch { setError("Could not load the conflicting version. Close and reopen this draft to retry; it is preserved."); } } }
    finally { setBusy(""); }
  }
  async function improve() {
    if (!draft || busy) return;
    const key = draft.improveKey ?? crypto.randomUUID(); update({ improveKey: key }, false);
    controller.current = new AbortController(); setBusy("improve"); setError("");
    try {
      const { proposal } = await request<{ proposal: Proposal }>("/api/improvements", "POST", { title: draft.title || "Untitled note", body: draft.body, folderId: draft.folderId, ...(note ? { noteId: note.id, expectedVersion: draft.expectedVersion } : {}) }, key, controller.current.signal);
      if (proposal.receipt) { finish(proposal.receipt); return; }
      update({ proposal, proposedTitle: proposal.title, proposedBody: proposal.body });
    } catch (e) { setError(controller.current.signal.aborted ? "Improvement stopped. Your original draft is unchanged." : message(e)); update({ improveKey: undefined }, false); }
    finally { setBusy(""); }
  }
  async function reject() {
    if (!draft?.proposal) return;
    setBusy("save"); setError("");
    try { await request("/api/improvements", "PATCH", { id: draft.proposal.id, decision: "reject" }); update({ proposal: undefined, proposedTitle: undefined, proposedBody: undefined, improveKey: undefined }); }
    catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  return <Dialog open wide onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogHeader><DialogTitle>{receipt ? "Saved to your knowledge" : note ? "Edit note" : "Add a note"}</DialogTitle></DialogHeader>
    {receipt ? <div className="space-y-4"><p role="status">Version {receipt.version} saved. Original source and note history are retained. Indexing is queued separately.</p><p className="break-all text-sm text-mist">{receipt.path}</p><Link className="text-signal underline" href={"/notes/" + receipt.noteId} onClick={onClose}>Open saved note</Link><DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter></div>
    : !draft ? <p role="status">Recovering draft…</p> : <form onSubmit={(e) => { e.preventDefault(); void save(Boolean(draft.proposal)); }}>
      {notice ? <p className="mb-3 text-sm text-mist" role="status">{notice}</p> : null}
      <fieldset disabled={Boolean(busy)} className="space-y-4">
        <Destination folders={folders} value={draft.folderId} disabled={Boolean(note || draft.proposal)} onChange={(folderId) => update({ folderId, improveKey: undefined })} />
        {draft.proposal ? <>
          <p className="rounded border border-line p-3 text-sm">AI suggested wording and organization changes. Check every detail and code example. This is not a factual verification. The original below will be preserved as a linked source.</p>
          <div className="grid gap-4 md:grid-cols-2"><section><h3 className="mb-2 font-medium">Original (preserved)</h3><p>{draft.title}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-line p-3 text-sm">{draft.body}</pre></section>
          <section className="space-y-2"><h3 className="font-medium">Proposed version — editable</h3><label className="block text-sm">Proposed title<Input value={draft.proposedTitle ?? ""} maxLength={200} required onChange={(e) => update({ proposedTitle: e.target.value })} /></label><label className="block text-sm">Proposed Markdown<Textarea rows={14} value={draft.proposedBody ?? ""} maxLength={1000000} onChange={(e) => update({ proposedBody: e.target.value })} /></label></section></div>
          <ul className="list-inside list-disc text-sm text-paper-dim">{draft.proposal.changes.map((item, i) => <li key={i}>{item}</li>)}</ul>
          {draft.proposal.uncertainties.length ? <p className="text-sm text-amber-300">Review: {draft.proposal.uncertainties.join(" · ")}</p> : null}
        </> : <><label className="block text-sm">Title<Input autoFocus value={draft.title} maxLength={200} onChange={(e) => update({ title: e.target.value, improveKey: undefined })} /></label><label className="block text-sm">Markdown<Textarea rows={13} value={draft.body} maxLength={1000000} onChange={(e) => update({ body: e.target.value, improveKey: undefined })} className="font-mono" /></label></>}
        <Button type="button" variant="outline" onClick={() => setPreview(!preview)} aria-expanded={preview}>{preview ? "Hide preview" : "Preview Markdown & code"}</Button>
        {preview ? <div className="max-h-80 overflow-auto rounded border border-line p-4"><Markdown body={draft.proposal ? draft.proposedBody ?? "" : draft.body} /></div> : null}
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-sm text-red-400">{error}</p> : null}
      {currentNote && draft.expectedVersion !== currentNote.current_version ? <section className="mt-3 space-y-2 rounded border border-amber-400 p-3"><p>A newer version ({currentNote?.current_version}) exists. Your draft targets version {draft.expectedVersion}. Review the current text below before rebasing your draft.</p><p className="text-sm">Current title: {currentNote.title} · Importance: {currentNote.importance}/5 · {currentNote.lifecycle}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{currentNote?.body}</pre><Button type="button" variant="outline" disabled={Boolean(busy) || Boolean(draft.proposal)} onClick={() => update({ expectedVersion: currentNote!.current_version, folderId: currentNote!.folder_id })}>I reviewed the current version · rebase my draft</Button><p className="text-xs">Rebasing does not save. Edit the draft to merge any changes, then save. Reject an old AI proposal before rebasing.</p></section> : null}
      <p className="mt-3 text-xs text-mist">Unsaved text stays in this browser. Canonical notes and original sources are stored on your server only after saving.</p>
      {!draft.proposal ? <p className="mt-3 text-sm font-medium">Improve with AI before saving?</p> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={onClose}>Close · keep draft</Button>
        {busy === "improve" ? <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>Stop improvement</Button> : null}
        {draft.proposal ? <><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={reject}>Reject proposal</Button><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => save(false)}>Save original</Button><Button type="submit" disabled={Boolean(busy)}>Apply & Save</Button></>
        : <><Button type="button" variant="outline" disabled={Boolean(busy) || !draft.body.trim() || draft.body.length > 200000} onClick={improve}>{busy === "improve" ? "Improving…" : "Yes, improve with AI"}</Button><Button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "No, save as written"}</Button></>}
      </DialogFooter>
    </form>}
  </Dialog>;
}

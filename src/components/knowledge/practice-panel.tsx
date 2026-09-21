"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Destination, Markdown, message, request, ROOT, type FolderRecord } from "./shared";
import type { PracticeService } from "@/lib/storage/practice";
type Overview = Awaited<ReturnType<PracticeService["overview"]>>;
type Session = Awaited<ReturnType<PracticeService["session"]>>;
const kinds = ["mcq", "recall", "short_answer", "explanation", "code_completion", "debugging", "predict_output"];
const modes = ["due", "folder", "weak", "random", "interview", "exam"];
const label = (s: string) => s.replaceAll("_", " ");
export function PracticePanel({ initialMode = "due", initialFolderId = ROOT, initialNoteId }: { initialMode?: string; initialFolderId?: string; initialNoteId?: string }) {
  const [folders, setFolders] = useState<FolderRecord[]>([]), [folderId, setFolderId] = useState(initialFolderId), [noteId, setNoteId] = useState(initialNoteId);
  const [overview, setOverview] = useState<Overview>(), [session, setSession] = useState<Session>();
  const [mode, setMode] = useState(initialMode), [kind, setKind] = useState("mcq"), [query, setQuery] = useState("");
  const [answer, setAnswer] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [index, setIndex] = useState(0), [reason, setReason] = useState(""), [count, setCount] = useState(5);
  useEffect(() => { let active = true; Promise.all([request<{ folders: FolderRecord[] }>("/api/folders"), request<Overview>("/api/study?folderId=" + folderId)]).then(([f, o]) => { if (active) { setFolders(f.folders); setOverview(o); } }).catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, [folderId]);
  async function resume(id: string) {
    setBusy(true); setError("");
    try { const s = await request<Session>("/api/study?sessionId=" + id); setSession(s); setIndex(Math.max(0, s.questions.findIndex(q => !q.answered))); setAnswer(""); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ sessionId?: string; generated?: number }>("/api/study", "POST", body);
      if (result.generated) setNotice(`${result.generated} source-checked cards saved.`);
      const id = result.sessionId || session?.id;
      if (id) setSession(await request<Session>("/api/study?sessionId=" + id));
      if (body.action === "start") { setIndex(0); setAnswer(""); }
      setOverview(await request<Overview>("/api/study?folderId=" + folderId));
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const q = session?.questions[index];
  return <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8"><div><h1 className="text-2xl font-semibold">Practice your knowledge</h1><p className="mt-2 text-sm text-mist">Questions use your current notes. Practice stays in learning history and never changes notes.</p></div>
    {error && <p role="alert" className="rounded border border-red-400 p-3 text-red-400">{error}</p>}{notice && <p role="status" className="text-emerald-400">{notice}</p>}
    <section className="space-y-3 rounded-xl border border-line bg-ink-2 p-4"><div className="grid gap-3 sm:grid-cols-2"><Destination folders={folders} value={folderId} onChange={value => { setFolderId(value); setNoteId(undefined); }} disabled={busy} /><label className="text-sm">Focus topic (optional)<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="e.g. Java inheritance" /></label></div>
      <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Format<select className="block rounded border border-line bg-ink-2 p-2" value={kind} onChange={e => setKind(e.target.value)}>{kinds.map(k => <option key={k} value={k}>{label(k)}</option>)}</select></label><label className="text-sm">Cards<Input type="number" min={1} max={10} value={count} onChange={e => setCount(Number(e.target.value))} className="w-20" /></label><Button disabled={busy || count < 1 || count > 10} onClick={() => act({ action: "generate", folderId, query, kind, count, noteId })}>Generate from notes</Button></div>
      {noteId && <p className="text-sm">Generating from <a className="underline" href={"/notes/" + noteId}>the selected note</a>. <button className="underline" onClick={() => setNoteId(undefined)}>Use whole folder</button></p>}
      <p className="text-xs text-mist">Answers are checked against quoted evidence. Inspect the source and correct model judgments when needed. Code is never executed.</p>
      <div className="flex flex-wrap items-center gap-3"><label>Session<select className="ml-2 rounded border border-line bg-ink-2 p-2" value={mode} onChange={e => setMode(e.target.value)}>{modes.map(m => <option key={m}>{m}</option>)}</select></label><Button variant="outline" disabled={busy} onClick={() => act({ action: "start", folderId, mode, count })}>Start session</Button><span className="text-xs text-mist">Timezone: {overview?.timezone || "UTC"} (Settings)</span></div></section>
    {session && q && <section className="space-y-4 rounded-xl border border-line p-5"><div className="flex justify-between gap-3"><h2 className="font-semibold">{label(q.kind)} · {index + 1}/{session.total}</h2><span>{session.completed ? `Complete · ${session.score}/${session.total} correct` : label(session.mode)}</span></div><Markdown body={q.prompt} />
      {q.stale ? <p role="alert">This source changed. Regenerate its cards and start a current session.</p> : <>
        {!q.answered && <fieldset disabled={busy} className="space-y-3">{q.kind === "mcq" ? <div className="grid gap-2">{q.options?.map((o: { id: string; text: string }) => <label key={o.id} className="flex gap-3 rounded border border-line p-3"><input type="radio" name={q.id} value={o.id} checked={answer === o.id} onChange={() => setAnswer(o.id)} /><span className="whitespace-pre-wrap">{o.text}</span></label>)}</div> : q.kind !== "recall" || session.mode === "exam" ? <label className="block text-sm">Your answer<Textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={5} /></label> : <p>Recall your answer before revealing the source-backed key.</p>}
          {q.kind !== "recall" || session.mode === "exam" ? <Button disabled={!answer.trim()} onClick={() => act({ action: "answer", sessionId: session.id, questionId: q.id, answer })}>Submit answer</Button> : q.revealed ? <div className="flex flex-wrap gap-2">{["Again", "Hard", "Good", "Easy"].map((r, rating) => <Button key={r} variant="outline" onClick={() => act({ action: "answer", sessionId: session.id, questionId: q.id, rating })}>{r}</Button>)}</div> : null}
          {!q.revealed && session.mode !== "exam" && <Button variant="ghost" onClick={() => act({ action: "reveal", sessionId: session.id, questionId: q.id })}>Reveal answer{q.kind !== "recall" ? " (assisted attempt)" : ""}</Button>}</fieldset>}
        {q.answerKey !== undefined && <div className="space-y-3 rounded bg-ink-2 p-4"><h3 className="font-semibold">Answer and evidence</h3><Markdown body={q.answerKey} /><Markdown body={q.explanation || ""} /><blockquote className="border-l-2 border-line pl-3 text-sm whitespace-pre-wrap">{q.quote}</blockquote><a className="text-sky-400 underline" href={q.sourceUrl} target="_blank" rel="noreferrer">{q.sourceTitle} · version {q.sourceVersion}</a>
          {q.attempt && <><p className="text-sm">{q.attempt.correct === null ? "Uncertain — your assessment is needed." : q.attempt.correct ? "Correct" : "Needs review"} · {q.attempt.feedback}</p>{q.attempt.dueAt && <p className="text-xs text-mist">Next review: {new Date(q.attempt.dueAt).toLocaleString(undefined, { timeZone: session.timezone })} ({session.timezone})</p>}<details><summary className="cursor-pointer text-sm">Correct this assessment</summary><label className="mt-2 block text-sm">Reason<Input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></label><div className="mt-2 flex flex-wrap gap-2">{["Again", "Hard / partial", "Good", "Easy"].map((r, rating) => <Button key={r} variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => act({ action: "correct", sessionId: session.id, questionId: q.id, revision: q.attempt!.revision, rating, reason })}>{r}</Button>)}</div></details></>}
        </div>}
      </>}
      <div className="flex gap-2"><Button variant="ghost" disabled={busy || index === 0} onClick={() => { setIndex(index - 1); setAnswer(""); setReason(""); }}>Previous</Button><Button disabled={busy || !q.answered || index === session.total - 1} onClick={() => { setIndex(index + 1); setAnswer(""); setReason(""); }}>Next question</Button><Button variant="ghost" onClick={() => setSession(undefined)}>Close session</Button></div></section>}
    <div className="grid gap-6 md:grid-cols-2"><section className="space-y-2"><h2 className="font-semibold">Cards · {overview?.cards.length || 0} shown (up to 500)</h2><p className="text-xs text-mist">Due: {overview?.cards.filter(c => !c.stale && new Date(c.due_at) <= new Date()).length || 0} · Weak: {overview?.cards.filter(c => !c.stale && c.state?.lastRating !== undefined && c.state.lastRating <= 1).length || 0}</p>{overview?.cards.map(c => <div key={c.id} className="rounded border border-line p-3"><p className="text-sm">{c.prompt}</p><p className="mt-1 text-xs text-mist">{c.title} · {label(c.kind)} · {c.stale ? "Source changed" : c.due_at ? "Due " + new Date(c.due_at).toLocaleDateString(undefined, { timeZone: overview.timezone }) : "New"}</p>{c.stale && <Button variant="ghost" disabled={busy} onClick={() => act({ action: "generate", folderId, noteId: c.note_id, regenerateId: c.id, kind: c.kind, count: 1 })}>Regenerate from current source</Button>}</div>)}</section><section className="space-y-2"><h2 className="font-semibold">Recent sessions</h2>{overview?.sessions.map(s => <button key={s.id} disabled={busy} className="block w-full rounded border border-line p-3 text-left text-sm hover:bg-ink-2" onClick={() => resume(s.id)}>{label(s.mode)} · {new Date(s.created_at).toLocaleString()} · {s.completed_at ? "Review results" : "Resume"}</button>)}</section></div>
  </div>;
}




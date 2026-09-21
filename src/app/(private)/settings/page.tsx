"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImportPanel } from "@/components/knowledge/import-panel";
import type { AIPreferences } from "@/lib/ai/preferences";

type Usage = { requests: number; reportedTokens: string; budgetedTokens: string; reportedCost: number; unreportedRequests: number };
type Processing = {
  availableHandlers: string[]; stages: { stage: string; status: string; count: number; error_code: string | null }[];
  workers: { id: string; alive: boolean; heartbeat_at: string }[];
};
const models = [["chatModel", "Chat"], ["structuredModel", "Structured output"], ["embeddingModel", "Embeddings"], ["rerankModel", "Reranking"]] as const;
export default function SettingsPage() {
  const [values, setValues] = useState<AIPreferences>({}), [configured, setConfigured] = useState(false);
  const [usage, setUsage] = useState<Usage>(), [processing, setProcessing] = useState<Processing>();
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [task, setTask] = useState("chat");
  async function refresh(signal?: AbortSignal) {
    const responses = await Promise.all([apiFetch("/api/settings", { signal }), apiFetch("/api/vector/status", { signal })]);
    const [data, status] = await Promise.all(responses.map((response) => response.json()));
    if (responses.some((response) => !response.ok)) throw new Error(data.error || status.error || "Could not load settings.");
    const { hasApiKey, ...effective } = data.effective;
    setValues({ ...effective, timezone: data.settings.timezone || "UTC" }); setConfigured(hasApiKey); setUsage(data.usage); setProcessing(status); setLoaded(true);
  }
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([apiFetch("/api/settings", { signal: abort.signal }), apiFetch("/api/vector/status", { signal: abort.signal })])
      .then(async (responses) => {
        const [data, status] = await Promise.all(responses.map((response) => response.json()));
        if (responses.some((response) => !response.ok)) throw new Error(data.error || status.error || "Could not load settings.");
        const { hasApiKey, ...effective } = data.effective;
        setValues({ ...effective, timezone: data.settings.timezone || "UTC" }); setConfigured(hasApiKey); setUsage(data.usage); setProcessing(status); setLoaded(true);
      }).catch((error) => { if (!abort.signal.aborted) setMessage(error.message); });
    return () => abort.abort();
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed. Please retry."); }
    finally { setBusy(false); }
  }
  async function post(url: string, body: unknown) {
    const response = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Request failed."); return data;
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    void action(async () => {
      await post("/api/settings", Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")));
      await refresh(); setMessage("Settings saved. Changed indexing configuration invalidates work already in progress.");
    });
  }
  return <div className="mx-auto max-w-3xl p-5 sm:p-8 space-y-7">
    <div><p className="eyebrow">System / Settings</p><h1 className="font-display mt-2 text-3xl">Your second brain</h1></div>
    {message && <p role="status" className="rounded-lg border border-line bg-ink-1 p-4 text-sm text-signal">{message}</p>}
    <section className="rounded-lg border border-line bg-ink-1 p-6">
      <h2 className="text-xl">OpenRouter models</h2>
      <p className="my-3 text-sm text-paper-dim">{configured ? "The server API key is configured." : "Set OPENROUTER_API_KEY on your server to enable AI."} Manual notes and keyword search work without AI.</p>
      <form onSubmit={save} className="space-y-5">
        <fieldset disabled={busy || !loaded} className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">Review timezone (IANA)<Input value={values.timezone || "UTC"} onChange={event => setValues({ ...values, timezone: event.target.value })} placeholder="Asia/Kolkata" /></label>
          {models.map(([key, label]) => <label key={key} className="block text-sm">{label} model ID
            <Input className="mt-1" value={values[key] || ""} maxLength={200} placeholder="provider/model" onChange={(event) => setValues({ ...values, [key]: event.target.value })}/>
          </label>)}
          <p className="text-xs text-paper-dim sm:col-span-2">Embedding dimensions: 1536. Changing dimensions requires a schema migration and reindex. Use a live check to verify provider task support.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.aiIndexingEnabled || false} onChange={(event) => setValues({ ...values, aiIndexingEnabled: event.target.checked })}/>Allow AI indexing</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.rerankEnabled || false} onChange={(event) => setValues({ ...values, rerankEnabled: event.target.checked })}/>Rerank chat evidence</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.graphExpansionEnabled || false} onChange={(event) => setValues({ ...values, graphExpansionEnabled: event.target.checked })}/>Expand retrieval through graph relationships</label>
          <p className="text-xs text-paper-dim sm:col-span-2">AI indexing sends note passages to OpenRouter for embeddings and proposed relationships. Chunking and folder/source links work without AI. A new embedding profile becomes active after complete current-note coverage. Graph expansion is optional and always retrieves supporting passages.</p>
          <label className="text-sm">Daily request allowance<Input className="mt-1" type="number" min={1} max={100000} value={values.dailyRequestLimit ?? 200} onChange={(e) => setValues({ ...values, dailyRequestLimit: Number(e.target.value) })}/></label>
          <label className="text-sm">Daily token allowance<Input className="mt-1" type="number" min={1000} max={100000000} value={values.dailyTokenBudget ?? 200000} onChange={(e) => setValues({ ...values, dailyTokenBudget: Number(e.target.value) })}/></label>
          <label className="text-sm">Maximum output tokens per request<Input className="mt-1" type="number" min={128} max={32768} value={values.maxOutputTokens ?? 4096} onChange={(e) => setValues({ ...values, maxOutputTokens: Number(e.target.value) })}/></label>
        </fieldset>
        <Button disabled={busy || !loaded}>Save settings</Button>
      </form>
    </section>
    <section className="rounded-lg border border-line bg-ink-1 p-6 space-y-4">
      <h2 className="text-xl">Connection and usage</h2>
      <p className="text-sm text-paper-dim">Checks send a small synthetic example using saved settings and can incur provider charges.</p>
      <div className="flex flex-wrap gap-3"><label className="text-sm">Task <select aria-label="Connection check task" className="ml-2 rounded border border-line bg-ink-2 p-2" value={task} onChange={(e) => setTask(e.target.value)}>{["chat", "structured", "embeddings", "rerank"].map((name) => <option key={name}>{name}</option>)}</select></label>
        <Button disabled={busy || !configured} onClick={() => void action(async () => {
          const data = await post("/api/settings/test", { live: true, task }); await refresh();
          setMessage(data.result.ok ? task + " connection verified with " + data.result.model + "." : data.result.message);
        })}>Run live check</Button>
      </div>
      {usage && <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-paper-dim">Requests today</p><p>{usage.requests}</p></div>
        <div><p className="text-paper-dim">Reported tokens</p><p>{Number(usage.reportedTokens).toLocaleString()}</p></div>
        <div><p className="text-paper-dim">Budgeted tokens</p><p>{Number(usage.budgetedTokens).toLocaleString()}</p></div>
        <div><p className="text-paper-dim">Reported cost</p><p>{"$"}{usage.reportedCost.toFixed(4)}</p></div>
      </div>}
      <p className="text-xs text-paper-dim">Allowances reset at midnight UTC. Requests reserve tokens before sending. Missing usage stays reserved; reported cost can be incomplete and is not a billing cap. {usage?.unreportedRequests || 0} requests have unreported usage.</p>
    </section>
    <section className="rounded-lg border border-line bg-ink-1 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl">Background processing</h2><Button variant="outline" disabled={busy} onClick={() => void action(async () => { await refresh(); setMessage("Status refreshed."); })}>Refresh status</Button></div>
      <p className="text-sm">{processing?.workers.some((worker) => worker.alive) ? "Worker connected" : "No recent worker heartbeat"}</p>
      <p className="text-sm text-paper-dim">Registered handlers: {processing?.availableHandlers.join(", ") || "none yet"}. Saved notes remain readable and searchable while processing is pending.</p>
      {processing?.stages.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2">Stage</th><th>Status</th><th>Notes</th><th>Reason</th></tr></thead><tbody>{processing.stages.map((row) => <tr key={[row.stage, row.status, row.error_code].join(":")} className="border-t border-line"><td className="py-2">{row.stage}</td><td>{row.status}</td><td>{row.count}</td><td className="text-xs text-paper-dim">{row.error_code || "—"}</td></tr>)}</tbody></table></div> : <p className="text-sm text-paper-dim">No notes awaiting processing.</p>}
      <div className="flex flex-wrap gap-3">
        {(["retry", "rebuild"] as const).map((name) => <Button key={name} variant="outline" disabled={busy || !loaded} onClick={() => void action(async () => {
          const data = await post("/api/vector/reindex", { action: name }); await refresh(); setMessage(data.queued + " notes queued. " + data.message);
        })}>{name === "retry" ? "Retry pending or failed" : "Rebuild current indexes"}</Button>)}
      </div>
    </section>
    <section className="rounded-lg border border-line bg-ink-1 p-6 space-y-3"><h2 className="text-xl">Import and export</h2><ImportPanel folderId="00000000-0000-0000-0000-000000000001" /><div className="flex flex-wrap gap-4"><a href="/api/export" className="text-signal underline">Export active notes</a><a href="/api/export?includeInactive=true" className="text-signal underline">Export including archive and trash</a></div><p className="text-xs text-paper-dim">ZIP exports contain Markdown and provenance manifests, not a full installation backup. Use the local recovery command for database, learning history and attachment bytes. See docs/RECOVERY.md.</p></section>
    <p className="text-sm text-paper-dim">PostgreSQL stores notes, versions, sources, chat, study, usage and sessions. Original uploads use the persistent attachments volume.</p>
  </div>;
}

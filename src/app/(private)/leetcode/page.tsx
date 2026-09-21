"use client";
import { apiFetch } from "@/lib/client-api";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  BookOpen,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Problem {
  id: string; problem_name: string; problem_number: number | null; pattern: string;
  difficulty: string; file_path: string; updated_at: string;
}

const STANDARD_PATTERNS = [
  "All",
  "Two-Pointers",
  "Sliding-Window",
  "Binary-Search",
  "BFS-DFS",
  "Dynamic-Programming",
  "Monotonic-Stack",
  "Backtracking",
  "Graph",
];

export default function LeetCodePage() {
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedPattern, setSelectedPattern] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [problemName, setProblemName] = useState("");
  const [problemNumber, setProblemNumber] = useState("");
  const [pattern, setPattern] = useState("Two-Pointers");
  const [difficulty, setDifficulty] = useState("Medium");
  const [approach, setApproach] = useState("");
  const [keyInsight, setKeyInsight] = useState("");
  const [code, setCode] = useState("");
  const [mistakes, setMistakes] = useState("");

  const loadProblems = async () => {
    setIsLoading(true);
    try {
      const url =
        selectedPattern && selectedPattern !== "All"
          ? `/api/leetcode?pattern=${encodeURIComponent(selectedPattern)}`
          : "/api/leetcode";
      const res = await apiFetch(url);
      const data = await res.json();
      setProblems(data.problems || []);
    } catch {
      setProblems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const abort = new AbortController();
    const url = selectedPattern === "All" ? "/api/leetcode" : "/api/leetcode?pattern=" + encodeURIComponent(selectedPattern);
    apiFetch(url, { signal: abort.signal }).then((r) => r.json())
      .then((data) => { if (!abort.signal.aborted) setProblems(data.problems || []); })
      .catch(() => { if (!abort.signal.aborted) setProblems([]); })
      .finally(() => { if (!abort.signal.aborted) setIsLoading(false); });
    return () => abort.abort();
  }, [selectedPattern]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemName.trim()) return;

    try {
      const res = await apiFetch("/api/leetcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemName: problemName.trim(),
          problemNumber: problemNumber ? parseInt(problemNumber, 10) : undefined,
          pattern,
          difficulty,
          approach,
          keyInsight,
          code,
          mistakes,
        }),
      });

      if (res.ok) {
        setIsDialogOpen(false);
        setProblemName("");
        setProblemNumber("");
        setApproach("");
        setKeyInsight("");
        setCode("");
        setMistakes("");
        loadProblems();
      }
    } catch {
      // ignore
    }
  };

  const filteredProblems = problems.filter((p) =>
    p.problem_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-ink-0">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 space-y-6">
        {/* Masthead */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="eyebrow">02 / Library — LeetCode</p>
            <h1 className="font-display text-[26px] tracking-tight text-paper mt-2">
              Patterns, not problems.
            </h1>
            <p className="text-[13px] leading-relaxed text-paper-dim mt-1.5 max-w-xl">
              Track problem approaches, key insights, edge traps, and patterns across coding problems.
            </p>
          </div>
          <Button onClick={() => setIsDialogOpen(true)} size="sm" className="shrink-0">
            <Plus className="h-[15px] w-[15px]" strokeWidth={1.75} /> Add Problem Note
          </Button>
        </div>

        {/* Pattern filter — mono underline row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
          <span className="eyebrow flex items-center gap-1.5">
            <Layers className="h-[14px] w-[14px] text-mist" strokeWidth={1.75} /> Pattern
          </span>
          {STANDARD_PATTERNS.map((pat) => (
            <button
              key={pat}
              onClick={() => { if (pat !== selectedPattern) setIsLoading(true); setSelectedPattern(pat); }}
              className={`font-mono text-[12px] uppercase tracking-[0.08em] pb-0.5 transition-colors ${
                selectedPattern === pat
                  ? "text-signal underline underline-offset-[6px] decoration-signal/60"
                  : "text-mist hover:text-paper"
              }`}
            >
              {pat}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-[15px] w-[15px] text-mist"
            strokeWidth={1.75}
          />
          <Input
            placeholder="Filter problems by name (e.g. 3Sum, Trap Rain Water)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-ink-1 border-line-strong"
          />
        </div>

        {/* Index rows */}
        {isLoading ? (
          <div className="py-12 text-center meta-mono">Loading problem records...</div>
        ) : filteredProblems.length === 0 ? (
          <div className="panel p-12 text-center">
            <BookOpen
              className="h-[15px] w-[15px] mx-auto mb-3 text-mist"
              strokeWidth={1.75}
            />
            <h3 className="font-display text-[18px] tracking-tight text-paper">
              No LeetCode Problems Stored
            </h3>
            <p className="text-[13px] text-paper-dim max-w-sm mx-auto mt-1.5">
              Tell the AI in chat (e.g. &ldquo;I solved 3Sum with Two Pointers...&rdquo;) or click Add Problem Note!
            </p>
            <Button size="sm" onClick={() => setIsDialogOpen(true)} className="mt-5">
              Add Problem Note
            </Button>
          </div>
        ) : (
          <div>
            <div className="eyebrow pb-3">
              {filteredProblems.length} {filteredProblems.length === 1 ? "entry" : "entries"}
            </div>
            <div className="space-y-2">
              {filteredProblems.map((problem) => (
                <div
                  key={problem.id}
                  className="panel px-4 py-3 flex items-center justify-between gap-4 hover:border-line-strong transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="stamp shrink-0">{problem.pattern}</span>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-display text-[15px] tracking-tight text-paper truncate">
                        {problem.problem_name}
                      </span>
                      {problem.problem_number && (
                        <span className="font-mono text-[12px] text-mist shrink-0">
                          #{problem.problem_number}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span
                      className={`font-mono text-[12px] ${
                        problem.difficulty === "Easy"
                          ? "text-moss"
                          : problem.difficulty === "Hard"
                          ? "text-clay"
                          : "text-signal"
                      }`}
                    >
                      {problem.difficulty}
                    </span>
                    <span className="meta-mono hidden sm:inline">
                      {new Date(problem.updated_at).toLocaleDateString()}
                    </span>
                    <Link className="text-xs text-signal underline" href={"/quiz?noteId=" + problem.id}>Practice</Link>
                    <Link
                      href={`/knowledge/${problem.file_path}`}
                      className="font-mono text-[12px] text-mist hover:text-signal transition-colors"
                    >
                      Open →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Problem Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogHeader>
            <DialogTitle>Add LeetCode Problem Note</DialogTitle>
            <DialogDescription>
              Saves a Markdown note in your LeetCode folder and queues retrieval indexing. Practice uses the same source-linked cards and learning history.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="eyebrow block mb-1.5">Problem Name</label>
                <Input
                  required
                  placeholder="e.g. 3Sum"
                  value={problemName}
                  onChange={(e) => setProblemName(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow block mb-1.5">Number (#)</label>
                <Input
                  type="number"
                  placeholder="15"
                  value={problemNumber}
                  onChange={(e) => setProblemNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="eyebrow block mb-1.5">Pattern</label>
                <Input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="Two-Pointers"
                />
              </div>
              <div>
                <label className="eyebrow block mb-1.5">Difficulty</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full h-9 rounded-md border border-line-strong bg-ink-2 px-3 text-[13px] text-paper focus-visible:outline-none focus-visible:border-signal/60"
                >
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Key Insight</label>
              <Input
                placeholder="Sort first, fix one element, use two pointers for remaining sum"
                value={keyInsight}
                onChange={(e) => setKeyInsight(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Approach & Logic</label>
              <Textarea
                rows={3}
                placeholder="Detailed approach steps and complexity..."
                value={approach}
                onChange={(e) => setApproach(e.target.value)}
              />
            </div>

            <div>
              <label className="eyebrow block mb-1.5">Common Pitfalls & Mistakes</label>
              <Input
                placeholder="e.g. Forgetting to skip duplicate elements"
                value={mistakes}
                onChange={(e) => setMistakes(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Save Problem Note
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      </div>
    </div>
  );
}

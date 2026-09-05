"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Code2,
  Plus,
  Search,
  ExternalLink,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

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
  const [problems, setProblems] = useState<any[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
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
      const res = await fetch(url);
      const data = await res.json();
      setProblems(data.problems || []);
      if (data.patterns && data.patterns.length > 0) {
        setPatterns(data.patterns);
      }
    } catch {
      setProblems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProblems();
  }, [selectedPattern]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!problemName.trim()) return;

    try {
      const res = await fetch("/api/leetcode", {
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
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Code2 className="h-6 w-6 text-emerald-400" />
            <span>LeetCode & DSA Pattern Knowledge</span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Track problem approaches, key insights, edge traps, and patterns across coding problems.
          </p>
        </div>

        <Button
          onClick={() => setIsDialogOpen(true)}
          className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
        >
          <Plus className="h-4 w-4" /> Add Problem Note
        </Button>
      </div>

      {/* Pattern Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#161b22] border border-zinc-800 rounded-xl">
        <span className="text-xs text-zinc-400 px-2 font-medium flex items-center gap-1">
          <Layers className="h-3.5 w-3.5 text-zinc-400" /> Pattern:
        </span>
        {STANDARD_PATTERNS.map((pat) => (
          <button
            key={pat}
            onClick={() => setSelectedPattern(pat)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              selectedPattern === pat
                ? "bg-emerald-600/20 border border-emerald-500 text-emerald-300"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
            }`}
          >
            {pat}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-zinc-400" />
        <Input
          placeholder="Filter problems by name (e.g. 3Sum, Trap Rain Water)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 bg-[#161b22] border-zinc-700 text-sm"
        />
      </div>

      {/* Problem Cards Grid */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">Loading problem records...</div>
      ) : filteredProblems.length === 0 ? (
        <Card className="border-zinc-800 bg-[#161b22] p-12 text-center">
          <BookOpen className="h-10 w-10 mx-auto mb-3 text-zinc-600" />
          <h3 className="text-base font-semibold text-zinc-200">No LeetCode Problems Stored</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
            Tell the AI in chat (e.g. &ldquo;I solved 3Sum with Two Pointers...&rdquo;) or click Add Problem Note!
          </p>
          <Button
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            className="mt-4 text-xs bg-emerald-600 hover:bg-emerald-700"
          >
            Add Problem Note
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProblems.map((problem) => (
            <Card
              key={problem.id}
              className="border-zinc-800 bg-[#161b22] p-5 hover:border-emerald-500/50 hover:bg-zinc-900/80 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="text-[11px] font-mono">
                    {problem.pattern}
                  </Badge>
                  <span
                    className={`text-[11px] font-semibold ${
                      problem.difficulty === "Easy"
                        ? "text-emerald-400"
                        : problem.difficulty === "Hard"
                        ? "text-red-400"
                        : "text-amber-400"
                    }`}
                  >
                    {problem.difficulty}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mb-2">
                  {problem.problem_number ? `${problem.problem_number}. ` : ""}
                  {problem.problem_name}
                </h3>
              </div>

              <div className="pt-4 border-t border-zinc-800/80 mt-3 flex items-center justify-between">
                <span className="text-[11px] text-zinc-400 font-mono">
                  {new Date(problem.updated_at).toLocaleDateString()}
                </span>
                <Link
                  href={`/knowledge/${problem.file_path}`}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  <span>View Note</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add Problem Modal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogHeader>
          <DialogTitle>Add LeetCode Problem Note</DialogTitle>
          <DialogDescription>
            Creates a structured Markdown file inside <code>vault/LeetCode/</code> and indexes it in your database.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-zinc-300 block mb-1">Problem Name</label>
              <Input
                required
                placeholder="e.g. 3Sum"
                value={problemName}
                onChange={(e) => setProblemName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Number (#)</label>
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
              <label className="text-xs font-medium text-zinc-300 block mb-1">Pattern</label>
              <Input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="Two-Pointers"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full h-9 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-xs text-white"
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Key Insight</label>
            <Input
              placeholder="Sort first, fix one element, use two pointers for remaining sum"
              value={keyInsight}
              onChange={(e) => setKeyInsight(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Approach & Logic</label>
            <Textarea
              rows={3}
              placeholder="Detailed approach steps and complexity..."
              value={approach}
              onChange={(e) => setApproach(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Common Pitfalls & Mistakes</label>
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
            <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Save Problem Note
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}

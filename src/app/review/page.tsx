"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  RotateCcw,
  CheckCircle,
  XCircle,
  Sparkles,
  ArrowRight,
  BookOpen,
  Star,
  ChevronRight,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ReviewItem {
  id: string;
  title: string;
  filePath: string;
  topic: string;
  subcategory: string;
  knowledgeType: string;
  importance: number;
  content: string;
  forgettingScore: number;
}

export default function ReviewPage() {
  const [mode, setMode] = useState<"quick" | "weak_areas" | "interview" | "random">("quick");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionId, setSessionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [stats, setStats] = useState({ remembered: 0, forgotten: 0 });

  const startSession = async (chosenMode = mode) => {
    setIsLoading(true);
    setSessionCompleted(false);
    setCurrentIndex(0);
    setStats({ remembered: 0, forgotten: 0 });

    try {
      const res = await fetch(`/api/review?mode=${chosenMode}&limit=8`);
      const data = await res.json();
      setSessionId(data.sessionId);
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    startSession(mode);
  }, [mode]);

  const handleOutcome = async (remembered: boolean) => {
    const currentItem = items[currentIndex];
    if (!currentItem) return;

    if (remembered) {
      setStats((prev) => ({ ...prev, remembered: prev.remembered + 1 }));
    } else {
      setStats((prev) => ({ ...prev, forgotten: prev.forgotten + 1 }));
    }

    try {
      fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          memoryId: currentItem.id,
          remembered,
        }),
      });
    } catch {
      // ignore
    }

    if (currentIndex + 1 < items.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setSessionCompleted(true);
    }
  };

  const currentItem = items[currentIndex];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <RotateCcw className="h-6 w-6 text-emerald-400" />
            <span>Personalized Knowledge Revision</span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Strengthen your memory on high-impact concepts and frequently forgotten pitfalls.
          </p>
        </div>

        {/* Mode Selector */}
        <div className="flex bg-zinc-900/90 p-1 rounded-lg border border-zinc-800 text-xs">
          <button
            onClick={() => setMode("quick")}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === "quick" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
            }`}
          >
            Quick 5-10
          </button>
          <button
            onClick={() => setMode("weak_areas")}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === "weak_areas" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
            }`}
          >
            Weak Areas
          </button>
          <button
            onClick={() => setMode("interview")}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === "interview" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
            }`}
          >
            Interview Prep
          </button>
          <button
            onClick={() => setMode("random")}
            className={`px-3 py-1.5 rounded-md font-medium transition-all ${
              mode === "random" ? "bg-zinc-800 text-white shadow-xs" : "text-zinc-400 hover:text-white"
            }`}
          >
            Random
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-zinc-400 text-sm">
          Preparing personalized review cards...
        </div>
      ) : items.length === 0 ? (
        <Card className="border-zinc-800 bg-[#161b22] text-center p-12">
          <BookOpen className="h-10 w-10 mx-auto mb-3 text-zinc-600" />
          <h3 className="text-lg font-semibold text-zinc-200">No Knowledge Notes Available</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto mt-1">
            Save some technical knowledge in the AI Chat first to unlock tailored revision sessions!
          </p>
          <Link href="/chat">
            <Button size="sm" className="mt-4 text-xs bg-blue-600 hover:bg-blue-700">
              Start Chatting
            </Button>
          </Link>
        </Card>
      ) : sessionCompleted ? (
        /* Completion Summary */
        <Card className="border-zinc-800 bg-[#161b22] p-8 text-center animate-in zoom-in-95">
          <div className="h-14 w-14 rounded-full bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto mb-4">
            <CheckCircle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-white">Review Session Complete!</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Great job! You reviewed {items.length} items from your vault.
          </p>

          <div className="flex justify-center gap-8 my-6">
            <div className="flex flex-col">
              <span className="text-3xl font-extrabold text-emerald-400">{stats.remembered}</span>
              <span className="text-xs text-zinc-400">Retained Well</span>
            </div>
            <div className="flex flex-col">
              <span className="text-3xl font-extrabold text-amber-400">{stats.forgotten}</span>
              <span className="text-xs text-zinc-400">Needs Revision</span>
            </div>
          </div>

          <div className="flex justify-center gap-3 mt-6">
            <Button onClick={() => startSession(mode)} className="bg-blue-600 hover:bg-blue-700 text-xs">
              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Practice Again
            </Button>
            <Link href="/quiz">
              <Button variant="outline" className="text-xs">
                <Sparkles className="h-3.5 w-3.5 mr-1" /> Test in AI Quiz
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        /* Active Review Card */
        <div className="space-y-6">
          {/* Progress Indicator */}
          <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
            <span>
              Card {currentIndex + 1} of {items.length}
            </span>
            <span>
              {Math.round(((currentIndex + 1) / items.length) * 100)}% Completed
            </span>
          </div>

          <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / items.length) * 100}%` }}
            />
          </div>

          <Card className="border-zinc-800 bg-[#161b22] shadow-xl overflow-hidden">
            {/* Card Header */}
            <div className="p-6 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono text-xs">
                  {currentItem.topic}
                </Badge>
                {currentItem.subcategory && (
                  <Badge variant="outline" className="text-xs">
                    {currentItem.subcategory}
                  </Badge>
                )}
                <Badge variant="purple" className="text-[10px]">
                  {currentItem.knowledgeType.replace("_", " ")}
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-amber-400 text-xs">
                <Star className="h-3.5 w-3.5 fill-amber-400" />
                <span>★ {currentItem.importance}</span>
              </div>
            </div>

            {/* Note Content */}
            <div className="p-8 max-h-[500px] overflow-y-auto">
              <h2 className="text-xl font-bold text-white mb-4">{currentItem.title}</h2>
              <article className="prose prose-invert max-w-none prose-sm prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {currentItem.content}
                </ReactMarkdown>
              </article>
            </div>

            {/* Outcome Actions Bar */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-4">
              <Button
                variant="destructive"
                onClick={() => handleOutcome(false)}
                className="flex-1 h-11 text-xs gap-2 bg-red-600/20 text-red-300 border border-red-500/40 hover:bg-red-600/30"
              >
                <XCircle className="h-4 w-4" /> Still Confused / Forgot
              </Button>
              <Button
                onClick={() => handleOutcome(true)}
                className="flex-1 h-11 text-xs gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle className="h-4 w-4" /> Got It Down Solid
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

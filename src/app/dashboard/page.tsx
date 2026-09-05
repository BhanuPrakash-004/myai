"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  Brain,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  BookOpen,
  ArrowRight,
  Star,
  CheckCircle2,
  TrendingDown,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/insights/dashboard")
      .then((r) => r.json())
      .then((res) => {
        setData(res);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="p-8 text-sm text-zinc-400 max-w-6xl mx-auto">
        Loading personal knowledge insights...
      </div>
    );
  }

  const stats = data?.stats || { totalKnowledge: 0, totalReviews: 0, totalQuizzes: 0, totalMistakes: 0 };
  const forgotten = data?.forgotten || [];
  const weakAreas = data?.weakAreas || [];
  const recent = data?.recent || [];
  const important = data?.important || [];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 lg:p-10 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6 text-blue-400" />
            <span>Memory Dashboard & Retention Insights</span>
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time analytics of what you know, what you forget, and what to revise today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/review?mode=weak_areas">
            <Button size="sm" className="h-9 gap-2 bg-amber-600 hover:bg-amber-700 text-white">
              <RotateCcw className="h-4 w-4" /> Revise Weak Areas
            </Button>
          </Link>
          <Link href="/quiz">
            <Button size="sm" className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white">
              <Sparkles className="h-4 w-4" /> Start AI Quiz
            </Button>
          </Link>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="pb-2 p-4">
            <CardTitle className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Total Knowledge Notes</span>
              <BookOpen className="h-4 w-4 text-blue-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-white">{stats.totalKnowledge}</div>
            <p className="text-[11px] text-zinc-400 mt-1">Stored in Markdown vault</p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="pb-2 p-4">
            <CardTitle className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Identified Mistakes</span>
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-amber-400">{stats.totalMistakes}</div>
            <p className="text-[11px] text-zinc-400 mt-1">Common traps cataloged</p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="pb-2 p-4">
            <CardTitle className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Review Sessions</span>
              <RotateCcw className="h-4 w-4 text-emerald-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-emerald-400">{stats.totalReviews}</div>
            <p className="text-[11px] text-zinc-400 mt-1">Completed revision rounds</p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="pb-2 p-4">
            <CardTitle className="text-xs font-medium text-zinc-400 flex items-center justify-between">
              <span>Quizzes Taken</span>
              <Brain className="h-4 w-4 text-purple-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold text-purple-400">{stats.totalQuizzes}</div>
            <p className="text-[11px] text-zinc-400 mt-1">AI evaluations</p>
          </CardContent>
        </Card>
      </div>

      {/* Center Row: Frequently Forgotten & Weak Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Frequently Forgotten Widget */}
        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="border-b border-zinc-800/80 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <CardTitle className="text-sm font-semibold text-white">
                  Frequently Forgotten Items
                </CardTitle>
              </div>
              <Badge variant="destructive" className="text-[10px]">
                High Priority
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Details you repeatedly ask about or get wrong in quizzes.
            </p>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {forgotten.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                No forgetting trends detected yet. As you chat and quiz, items will appear here.
              </div>
            ) : (
              forgotten.map((item: any) => (
                <Link
                  key={item.id}
                  href={`/knowledge/${item.file_path}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/60 hover:border-zinc-700 transition-all group"
                >
                  <div className="flex flex-col pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-200 group-hover:text-blue-400">
                        {item.title}
                      </span>
                      <span className="text-[10px] text-zinc-400">({item.subcategory})</span>
                    </div>
                    <span className="text-[11px] text-zinc-400 truncate max-w-sm mt-0.5">
                      {item.content_preview || item.topic}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-red-400">
                      score {item.forgetting_score}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-zinc-500 group-hover:text-white" />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Weak Areas Widget */}
        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="border-b border-zinc-800/80 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <CardTitle className="text-sm font-semibold text-white">
                  Knowledge Gaps & Weak Areas
                </CardTitle>
              </div>
              <Badge variant="warning" className="text-[10px]">
                Focus Topics
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Aggregated topics with the highest retention difficulty.
            </p>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {weakAreas.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                All topics are in solid shape!
              </div>
            ) : (
              weakAreas.map((area: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900/50"
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-200">
                        {area.topic}
                      </span>
                      {area.subcategory && (
                        <span className="text-xs text-zinc-400">→ {area.subcategory}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-400 mt-0.5">
                      {area.totalNotes} saved notes • {area.unresolvedMistakes} common mistake logs
                    </span>
                  </div>
                  <Link href={`/review?mode=topic&topic=${encodeURIComponent(area.topic)}`}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                      Revise
                    </Button>
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row: Recent & High-Importance Memories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Memories */}
        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="p-5 border-b border-zinc-800/80">
            <CardTitle className="text-sm font-semibold text-white">
              Recently Captured Knowledge
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-2">
            {recent.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-400">
                No memories saved yet. Start by chatting with the AI!
              </div>
            ) : (
              recent.map((item: any) => (
                <Link
                  key={item.id}
                  href={`/knowledge/${item.file_path}`}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-800/50 text-xs transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span className="text-zinc-200 font-medium truncate max-w-xs">{item.title}</span>
                  </div>
                  <span className="text-zinc-400 font-mono text-[11px]">
                    {new Date(item.updated_at).toLocaleDateString()}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* High Importance Knowledge */}
        <Card className="border-zinc-800 bg-[#161b22]">
          <CardHeader className="p-5 border-b border-zinc-800/80">
            <CardTitle className="text-sm font-semibold text-white">
              Key Concepts & Essential Traps (★ 4-5)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-2">
            {important.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-400">
                High-importance notes will be listed here.
              </div>
            ) : (
              important.map((item: any) => (
                <Link
                  key={item.id}
                  href={`/knowledge/${item.file_path}`}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-800/50 text-xs transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 shrink-0" />
                    <span className="text-zinc-200 font-medium truncate max-w-xs">{item.title}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {item.topic}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

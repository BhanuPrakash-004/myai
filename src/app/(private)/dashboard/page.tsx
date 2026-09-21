"use client";
import { apiFetch } from "@/lib/client-api";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  RotateCcw,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Star,
  CheckCircle2,
  TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import type { MemoryRecord } from "@/lib/memory/types";
import type { WeakArea } from "@/lib/storage/study";

interface DashboardData {
  stats: { totalKnowledge: number; totalReviews: number; totalQuizzes: number; totalMistakes: number };
  forgotten: MemoryRecord[]; recent: MemoryRecord[]; important: MemoryRecord[]; weakAreas: WeakArea[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/insights/dashboard")
      .then((r) => r.json())
      .then((res) => {
        setData(res);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] bg-ink-0">
        <div className="max-w-6xl mx-auto p-8 meta-mono">
          Loading personal knowledge insights...
        </div>
      </div>
    );
  }

  const stats = data?.stats || { totalKnowledge: 0, totalReviews: 0, totalQuizzes: 0, totalMistakes: 0 };
  const forgotten = data?.forgotten || [];
  const weakAreas = data?.weakAreas || [];
  const recent = data?.recent || [];
  const important = data?.important || [];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-ink-0">
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 space-y-8">
        {/* Masthead */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="eyebrow">04 / System — Overview</p>
            <h1 className="font-display text-[26px] tracking-tight text-paper mt-2">
              Where you stand.
            </h1>
            <p className="text-[13px] leading-relaxed text-paper-dim mt-1.5">
              Real-time analytics of what you know, what you forget, and what to revise today.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/review?mode=weak_areas">
              <Button size="sm">
                <RotateCcw className="h-[15px] w-[15px]" strokeWidth={1.75} /> Revise Weak Areas
              </Button>
            </Link>
            <Link href="/quiz">
              <Button size="sm" variant="outline">
                <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.75} /> Start AI Quiz
              </Button>
            </Link>
          </div>
        </div>

        {/* Ledger stat strip */}
        <div className="rounded-[10px] border border-line bg-line grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden">
          <div className="bg-ink-1 px-5 py-5">
            <p className="eyebrow">Total notes</p>
            <div className="font-display text-[30px] leading-none text-paper mt-2">
              {stats.totalKnowledge}
            </div>
            <p className="meta-mono mt-2">Stored in Markdown vault</p>
          </div>
          <div className="bg-ink-1 px-5 py-5">
            <p className="eyebrow">Mistakes</p>
            <div className="font-display text-[30px] leading-none text-signal mt-2">
              {stats.totalMistakes}
            </div>
            <p className="meta-mono mt-2">Common traps cataloged</p>
          </div>
          <div className="bg-ink-1 px-5 py-5">
            <p className="eyebrow">Reviews</p>
            <div className="font-display text-[30px] leading-none text-paper mt-2">
              {stats.totalReviews}
            </div>
            <p className="meta-mono mt-2">Completed revision rounds</p>
          </div>
          <div className="bg-ink-1 px-5 py-5">
            <p className="eyebrow">Quizzes</p>
            <div className="font-display text-[30px] leading-none text-paper mt-2">
              {stats.totalQuizzes}
            </div>
            <p className="meta-mono mt-2">AI evaluations</p>
          </div>
        </div>

        {/* Center row: Frequently Forgotten & Weak Areas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Frequently Forgotten */}
          <section className="panel overflow-hidden">
            <div className="px-5 pt-5 pb-4 hairline-b">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[17px] tracking-tight text-paper flex items-center gap-2">
                  <TrendingDown className="h-[15px] w-[15px] text-mist" strokeWidth={1.75} />
                  Frequently forgotten
                </h2>
                <span className="stamp stamp-signal">High priority</span>
              </div>
              <p className="text-[13px] text-paper-dim mt-1">
                Details you repeatedly ask about or get wrong in quizzes.
              </p>
            </div>
            <div className="divide-y divide-line">
              {forgotten.length === 0 ? (
                <div className="px-5 py-8 text-center text-[13px] text-paper-dim">
                  No forgetting trends detected yet. As you chat and quiz, items will appear here.
                </div>
              ) : (
                forgotten.map((item, idx: number) => (
                  <Link
                    key={item.id}
                    href={`/knowledge/${item.file_path}`}
                    className="group flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-ink-2/60 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="font-mono text-[12px] text-mist pt-0.5 shrink-0">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="font-display text-[15px] tracking-tight text-paper truncate">
                          {item.title}
                        </div>
                        <div className="meta-mono mt-0.5 truncate">
                          {item.subcategory ? `${item.subcategory} — ` : ""}
                          {item.content_preview || item.topic}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-[12px] text-clay">
                        score {item.forgetting_score}
                      </span>
                      <ArrowRight
                        className="h-[15px] w-[15px] text-mist group-hover:text-signal transition-colors"
                        strokeWidth={1.75}
                      />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* Weak Areas */}
          <section className="panel overflow-hidden">
            <div className="px-5 pt-5 pb-4 hairline-b">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-[17px] tracking-tight text-paper flex items-center gap-2">
                  <AlertTriangle className="h-[15px] w-[15px] text-mist" strokeWidth={1.75} />
                  Weak areas
                </h2>
                <span className="stamp">Focus topics</span>
              </div>
              <p className="text-[13px] text-paper-dim mt-1">
                Aggregated topics with the highest retention difficulty.
              </p>
            </div>
            <div className="divide-y divide-line">
              {weakAreas.length === 0 ? (
                <div className="px-5 py-8 text-center text-[13px] text-paper-dim">
                  All topics are in solid shape!
                </div>
              ) : (
                weakAreas.map((area, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <div className="font-display text-[15px] tracking-tight text-paper">
                        {area.topic}{" "}
                        
                      </div>
                      <div className="meta-mono mt-0.5">
                        {area.totalMemories} saved notes • {area.weakCount} notes marked forgotten
                      </div>
                    </div>
                    <Link
                      href={`/review?mode=topic&topic=${encodeURIComponent(area.topic)}`}
                      className="shrink-0"
                    >
                      <Button size="sm" variant="outline" className="h-7">
                        Revise
                      </Button>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Bottom row: Recent & Essential */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent */}
          <section className="panel overflow-hidden">
            <div className="px-5 py-4 hairline-b">
              <h2 className="font-display text-[17px] tracking-tight text-paper">Recent</h2>
              <p className="text-[13px] text-paper-dim mt-0.5">
                Recently captured knowledge.
              </p>
            </div>
            <div className="p-2">
              {recent.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-paper-dim">
                  No memories saved yet. Start by chatting with the AI!
                </div>
              ) : (
                recent.map((item) => (
                  <Link
                    key={item.id}
                    href={`/knowledge/${item.file_path}`}
                    className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-md hover:bg-ink-2/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2
                        className="h-[15px] w-[15px] text-moss shrink-0"
                        strokeWidth={1.75}
                      />
                      <span className="text-[13px] text-paper-dim truncate">{item.title}</span>
                    </div>
                    <span className="meta-mono shrink-0">
                      {new Date(item.updated_at).toLocaleDateString()}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* Essential */}
          <section className="panel overflow-hidden">
            <div className="px-5 py-4 hairline-b">
              <h2 className="font-display text-[17px] tracking-tight text-paper">Essential</h2>
              <p className="text-[13px] text-paper-dim mt-0.5">
                Key concepts &amp; essential traps (★ 4–5).
              </p>
            </div>
            <div className="p-2">
              {important.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-paper-dim">
                  High-importance notes will be listed here.
                </div>
              ) : (
                important.map((item) => (
                  <Link
                    key={item.id}
                    href={`/knowledge/${item.file_path}`}
                    className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-md hover:bg-ink-2/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Star
                        className="h-[15px] w-[15px] text-signal shrink-0"
                        strokeWidth={1.75}
                      />
                      <span className="text-[13px] text-paper-dim truncate">{item.title}</span>
                    </div>
                    <span className="stamp shrink-0">{item.topic}</span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Search as SearchIcon, FileText, Star, ArrowRight, CornerDownRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SearchResult {
  id?: string;
  title: string;
  filePath: string;
  topic: string;
  subcategory: string;
  snippet: string;
  score: number;
  importance?: number;
}

const POPULAR_SEARCHES = [
  "BFS queue size",
  "Map.Entry",
  "Two Pointers",
  "Common mistakes",
  "Sliding window",
  "Dynamic programming",
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
        setHasSearched(true);
      } catch {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#0d1117] p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
          <SearchIcon className="h-6 w-6 text-blue-400" />
          <span>Intelligent Knowledge Search</span>
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Search across all your Markdown files and metadata via SQLite FTS5 full-text indexing.
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative mb-6">
        <SearchIcon className="absolute left-3.5 top-3.5 h-4 w-4 text-zinc-400" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by syntax, concept, function, bug, or problem name..."
          className="h-11 pl-10 pr-4 text-base bg-[#161b22] border-zinc-700"
          autoFocus
        />
      </div>

      {/* Quick query chips */}
      {!hasSearched && (
        <div className="mb-8">
          <span className="text-xs text-zinc-400 mr-2">Try searching:</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {POPULAR_SEARCHES.map((term) => (
              <button
                key={term}
                onClick={() => setQuery(term)}
                className="text-xs rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-zinc-300 hover:bg-zinc-800 hover:border-zinc-700 transition-colors"
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">
          Searching knowledge vault...
        </div>
      ) : hasSearched ? (
        <div className="space-y-4">
          <div className="text-xs text-zinc-400 pb-2 border-b border-zinc-800/80">
            Found {results.length} matching {results.length === 1 ? "note" : "notes"}
          </div>

          {results.length === 0 ? (
            <div className="py-16 text-center text-zinc-400 rounded-xl border border-zinc-800 bg-[#161b22]/50 p-6">
              <FileText className="h-8 w-8 mx-auto mb-2 text-zinc-600" />
              <p className="font-medium text-zinc-300">No knowledge notes matched your query.</p>
              <p className="text-xs text-zinc-400 mt-1">
                You can capture it right now by telling the AI in chat!
              </p>
              <Link href="/chat">
                <Button size="sm" className="mt-4 text-xs bg-blue-600 hover:bg-blue-700">
                  Open Chat to Save Note
                </Button>
              </Link>
            </div>
          ) : (
            results.map((item) => (
              <Link
                key={item.filePath}
                href={`/knowledge/${item.filePath}`}
                className="group block rounded-xl border border-zinc-800 bg-[#161b22] p-5 shadow-xs hover:border-blue-500/50 hover:bg-zinc-900/80 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Badge variant="secondary" className="text-[11px] font-mono">
                        {item.topic}
                      </Badge>
                      {item.subcategory && (
                        <span className="text-xs text-zinc-400 flex items-center gap-1">
                          <CornerDownRight className="h-3 w-3 text-zinc-600" />
                          {item.subcategory}
                        </span>
                      )}
                      {item.importance && (
                        <span className="flex items-center gap-0.5 text-[11px] text-amber-400 ml-2">
                          <Star className="h-3 w-3 fill-amber-400" />
                          {item.importance}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-semibold text-zinc-100 group-hover:text-blue-400 transition-colors">
                      {item.title}
                    </h3>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-500 group-hover:text-blue-400 transition-transform group-hover:translate-x-1" />
                </div>

                <div
                  className="mt-3 text-xs text-zinc-400 leading-relaxed font-mono line-clamp-3 bg-zinc-950/60 p-3 rounded-md border border-zinc-800/80"
                  dangerouslySetInnerHTML={{ __html: item.snippet }}
                />

                <div className="mt-2 text-[11px] text-zinc-400 font-mono">
                  vault/{item.filePath}
                </div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

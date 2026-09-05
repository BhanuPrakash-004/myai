"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Menu, X, PlusCircle, Search, BrainCircuit } from "lucide-react";
import { Button } from "@/lib/../components/ui/button";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-zinc-800/80 bg-[#0d1117]/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-md bg-zinc-800/80 px-2 py-1 font-mono text-[11px] text-zinc-300 border border-zinc-700/60">
            Markdown Vault
          </span>
          <span>•</span>
          <span className="text-zinc-400">Natural conversation to structured knowledge</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href="/search">
          <Button variant="outline" size="sm" className="h-8 gap-2 text-xs text-zinc-400 hover:text-white">
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search memories...</span>
          </Button>
        </Link>
        <Link href="/chat">
          <Button size="sm" className="h-8 gap-1.5 text-xs bg-blue-600 hover:bg-blue-700">
            <PlusCircle className="h-3.5 w-3.5" />
            <span>New Chat</span>
          </Button>
        </Link>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 top-14 z-50 bg-[#0d1117]/95 p-4 md:hidden border-t border-zinc-800 flex flex-col space-y-2">
          <Link
            href="/chat"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            <BrainCircuit className="h-4 w-4 text-blue-400" /> AI Chat
          </Link>
          <Link
            href="/knowledge"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Knowledge Browser
          </Link>
          <Link
            href="/search"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Search
          </Link>
          <Link
            href="/review"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Study & Review
          </Link>
          <Link
            href="/quiz"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            AI Quiz
          </Link>
          <Link
            href="/leetcode"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            LeetCode Notes
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Dashboard
          </Link>
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 p-3 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Settings
          </Link>
        </div>
      )}
    </header>
  );
}

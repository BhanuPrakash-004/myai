"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Search, PenLine } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SessionControls } from "./session-controls";

const CRUMBS: Record<string, [string, string]> = {
  "/chat": ["Capture", "AI Chat"],
  "/knowledge": ["Library", "Knowledge"],
  "/search": ["Library", "Search"],
  "/graph": ["Library", "Graph"],
  "/evidence": ["Library", "Evidence"],
  "/leetcode": ["Library", "LeetCode"],
  "/review": ["Practice", "Review"],
  "/quiz": ["Practice", "Quiz"],
  "/dashboard": ["System", "Dashboard"],
  "/settings": ["System", "Settings"],
};

const MOBILE_LINKS = [
  ["AI Chat", "/chat"],
  ["Knowledge", "/knowledge"],
  ["Search", "/search"],
  ["Graph", "/graph"],
  ["Review", "/review"],
  ["Quiz", "/quiz"],
  ["LeetCode", "/leetcode"],
  ["Dashboard", "/dashboard"],
  ["Settings", "/settings"],
] as const;

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const base = "/" + (pathname.split("/")[1] || "chat");
  const [section, page] = CRUMBS[base] || ["MyAI", base.replace("/", "")];

  return (
    <header className="sticky top-0 z-20 flex h-[57px] items-center justify-between border-b border-line bg-ink-0/90 px-4 sm:px-6 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-paper-dim"
          aria-label="Menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
        {/* mobile wordmark */}
        <Link href="/chat" className="md:hidden flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-signal font-display text-[13px] font-semibold text-signal-ink">
            M
          </span>
          <span className="font-display text-[15px] text-paper">MyAI</span>
        </Link>
        {/* desktop breadcrumb */}
        <nav className="hidden md:flex items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.12em] min-w-0">
          <span className="text-mist">{section}</span>
          <span className="text-line-strong">/</span>
          <span className="text-paper truncate">{page}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <SessionControls />
        <Link href="/search" aria-label="Search" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline rounded border border-line-strong px-1 font-mono text-[10px] text-mist">
              /
            </kbd>
        </Link>
        <Link href="/knowledge?capture=1" className={buttonVariants({ size: "sm" })} onClick={() => window.dispatchEvent(new Event("myai:new-note"))}>
            <PenLine className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span>New entry</span>
        </Link>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <Dialog open onOpenChange={setMobileOpen}><DialogHeader><DialogTitle>Navigation</DialogTitle></DialogHeader>
          <nav aria-label="Mobile navigation" className="panel p-2">
            {MOBILE_LINKS.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm text-paper-dim hover:bg-ink-2 hover:text-paper"
              >
                <span>{label}</span>
                <span className="font-mono text-[11px] text-mist">{href}</span>
              </Link>
            ))}
          </nav><button className="mt-3 p-2" onClick={() => setMobileOpen(false)}>Close menu</button>
        </Dialog>
      )}
    </header>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  BookOpen,
  Network,
  Search,
  RotateCcw,
  Sparkles,
  Code2,
  LayoutDashboard,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Explorer } from "@/components/knowledge/explorer";

const SECTIONS = [
  {
    index: "01",
    label: "Capture",
    items: [{ label: "AI Chat", href: "/chat", icon: MessageSquare }],
  },
  {
    index: "02",
    label: "Library",
    items: [
      { label: "Knowledge", href: "/knowledge", icon: BookOpen },
      { label: "Search", href: "/search", icon: Search },
      { label: "Graph", href: "/graph", icon: Network },
      { label: "LeetCode", href: "/leetcode", icon: Code2 },
    ],
  },
  {
    index: "03",
    label: "Practice",
    items: [
      { label: "Review", href: "/review", icon: RotateCcw },
      { label: "Quiz", href: "/quiz", icon: Sparkles },
    ],
  },
  {
    index: "04",
    label: "System",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((data) => {
        if (data.totalFiles !== undefined) setTotal(data.totalFiles);
      })
      .catch(() => {});
  }, [pathname]);

  return (
    <aside
      className={cn(
        "relative hidden md:flex flex-col border-r border-line bg-ink-1 transition-all duration-200 z-30",
        collapsed ? "w-[68px]" : "w-[248px]",
        className
      )}
    >
      {/* Wordmark */}
      <div className="flex h-[57px] items-center justify-between px-4 hairline-b shrink-0">
        <Link href="/chat" className="flex items-center gap-2.5 overflow-hidden">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-signal font-display text-[15px] font-semibold text-signal-ink leading-none">
            M
          </span>
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="font-display text-[16px] font-medium tracking-tight text-paper">
                MyAI
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-mist mt-1">
                Field notes
              </span>
            </span>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-mist hover:text-paper hover:bg-ink-2 transition-colors"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Index */}
      <nav className="space-y-2 overflow-y-auto px-3 py-3 max-h-[42dvh] shrink-0">
        {SECTIONS.map((sec) => (
          <div key={sec.index}>
            {!collapsed && (
              <div className="flex items-baseline gap-2 px-2 mb-1.5">
                <span className="font-mono text-[10px] text-mist">{sec.index}</span>
                <span className="eyebrow">{sec.label}</span>
              </div>
            )}
            <div className="space-y-0.5">
              {sec.items.map((item) => {
                const isActive =
                  pathname === item.href || (item.href !== "/chat" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors",
                      isActive
                        ? "bg-signal/[0.07] text-paper"
                        : "text-fog hover:text-paper hover:bg-ink-2"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal transition-opacity",
                        isActive ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <Icon
                      className={cn("h-[15px] w-[15px] shrink-0", isActive ? "text-signal" : "text-mist")}
                      strokeWidth={1.75}
                    />
                    {!collapsed && <span className="flex-1 truncate font-medium">{item.label}</span>}
                    {!collapsed && item.href === "/knowledge" && total !== null && (
                      <span className="font-mono text-[11px] text-mist tabular-nums">{total}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {!collapsed ? <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-3 py-3"><Explorer /></div> : null}

      {/* Colophon */}
      <div className="border-t border-line p-3 shrink-0">
        {!collapsed ? (
          <div className="rounded-md border border-line bg-ink-0 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-moss" />
              <span className="font-mono text-[11px] text-paper-dim">Local vault</span>
              <span className="ml-auto font-mono text-[11px] text-mist tabular-nums">
                {total ?? "—"} notes
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mist">
              Private PostgreSQL storage. Portable Markdown exports.
            </p>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-moss" title="Local vault" />
          </div>
        )}
      </div>
    </aside>
  );
}

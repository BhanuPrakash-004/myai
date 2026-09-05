"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageSquare,
  BookOpen,
  Search,
  RotateCcw,
  Sparkles,
  Code2,
  LayoutDashboard,
  Settings,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "AI Chat", href: "/chat", icon: MessageSquare, badge: "AI" },
  { label: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { label: "Smart Search", href: "/search", icon: Search },
  { label: "Study & Review", href: "/review", icon: RotateCcw },
  { label: "AI Quiz", href: "/quiz", icon: Sparkles },
  { label: "LeetCode Notes", href: "/leetcode", icon: Code2 },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState<{ total: number } | null>(null);

  useEffect(() => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((data) => {
        if (data.totalFiles !== undefined) {
          setStats({ total: data.totalFiles });
        }
      })
      .catch(() => {});
  }, [pathname]);

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-zinc-800 bg-[#0d1117] transition-all duration-300 z-30",
        collapsed ? "w-16" : "w-64",
        className
      )}
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-zinc-800/80">
        <Link href="/chat" className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
            <BrainCircuit className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="font-semibold text-white tracking-tight text-sm">
                MyAI Knowledge
              </span>
              <span className="text-[11px] text-zinc-400">Personal Dev Vault</span>
            </div>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700/60 text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav List */}
      <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/chat" && pathname.startsWith(item.href));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-xs"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isActive ? "text-blue-400" : "text-zinc-400 group-hover:text-zinc-100"
                )}
              />
              {!collapsed && (
                <span className="flex-1 truncate">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300 border border-blue-500/30">
                  {item.badge}
                </span>
              )}
              {!collapsed && item.href === "/knowledge" && stats && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 border border-zinc-700">
                  {stats.total}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="border-t border-zinc-800/80 p-3">
        {!collapsed ? (
          <div className="flex items-center justify-between rounded-lg bg-zinc-900/90 px-3 py-2 border border-zinc-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-zinc-300">Engine Active</span>
            </div>
            <span className="text-[11px] text-zinc-500 font-mono">v1.0</span>
          </div>
        ) : (
          <div className="flex justify-center py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" title="Engine Active" />
          </div>
        )}
      </div>
    </aside>
  );
}

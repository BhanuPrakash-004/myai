"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Edit3,
  Trash2,
  Save,
  X,
  Star,
  Clock,
  ExternalLink,
  MoveRight,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  sizeBytes?: number;
  updatedAt?: string;
}

export default function KnowledgeBrowserPage() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"tree" | "recent" | "important">("tree");
  const [recentItems, setRecentItems] = useState<any[]>([]);
  const [importantItems, setImportantItems] = useState<any[]>([]);

  // Selected note details
  const [content, setContent] = useState<string>("");
  const [metadata, setMetadata] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ vault: true });

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [newPathInput, setNewPathInput] = useState("");
  const [filterText, setFilterText] = useState("");

  const loadTree = async () => {
    try {
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      if (data.tree) {
        setTree(data.tree);
        // Expand root by default
        setExpandedFolders((prev) => ({ ...prev, [data.tree.name]: true }));
      }
    } catch {
      // ignore
    }
  };

  const loadRecent = async () => {
    try {
      const res = await fetch("/api/knowledge?view=recent");
      const data = await res.json();
      setRecentItems(data.items || []);
    } catch {
      // ignore
    }
  };

  const loadImportant = async () => {
    try {
      const res = await fetch("/api/knowledge?view=important");
      const data = await res.json();
      setImportantItems(data.items || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadTree();
    loadRecent();
    loadImportant();
  }, []);

  const selectNote = async (path: string) => {
    setSelectedPath(path);
    setIsEditing(false);
    setIsLoading(true);

    try {
      const res = await fetch(`/api/knowledge/${path}`);
      if (!res.ok) throw new Error("Could not load note");
      const data = await res.json();
      setContent(data.content);
      setEditContent(data.content);
      setMetadata(data.metadata);
    } catch {
      setContent("# Error\nCould not load knowledge note.");
      setMetadata(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedPath) return;
    try {
      const res = await fetch(`/api/knowledge/${selectedPath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        setContent(editContent);
        setIsEditing(false);
        loadTree();
      }
    } catch {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!selectedPath) return;
    try {
      const res = await fetch(`/api/knowledge/${selectedPath}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSelectedPath(null);
        setContent("");
        setMetadata(null);
        setDeleteDialogOpen(false);
        loadTree();
        loadRecent();
        loadImportant();
      }
    } catch {
      // ignore
    }
  };

  const handleMove = async () => {
    if (!selectedPath || !newPathInput.trim()) return;
    try {
      const res = await fetch(`/api/knowledge/${selectedPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPath: newPathInput.trim() }),
      });
      if (res.ok) {
        const movedPath = newPathInput.trim();
        setMoveDialogOpen(false);
        setSelectedPath(movedPath);
        loadTree();
      }
    } catch {
      // ignore
    }
  };

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  // Render file tree recursively
  const renderNode = (node: TreeNode, depth = 0) => {
    const isDir = node.type === "directory";
    const isExpanded = expandedFolders[node.name] || false;

    if (filterText && !isDir && !node.name.toLowerCase().includes(filterText.toLowerCase())) {
      return null;
    }

    return (
      <div key={node.path || node.name} style={{ paddingLeft: `${depth * 14}px` }}>
        {isDir ? (
          <div>
            <button
              onClick={() => toggleFolder(node.name)}
              className="flex w-full items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-800/60 text-zinc-300 text-xs font-medium cursor-pointer transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              )}
              <Folder className="h-3.5 w-3.5 text-amber-400/90 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
            {isExpanded && node.children && (
              <div className="space-y-0.5">
                {node.children.map((child) => renderNode(child, depth + 1))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => selectNote(node.path)}
            className={`flex w-full items-center gap-2 py-1.5 px-2 rounded-md text-xs cursor-pointer transition-all ${
              selectedPath === node.path
                ? "bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
            <span className="truncate">{node.name.replace(/\.md$/, "")}</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[#0d1117]">
      {/* Left Sidebar: Tree / Recent / Important */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-[#161b22]/50 shrink-0">
        {/* Tab switch */}
        <div className="flex border-b border-zinc-800 p-2 gap-1 bg-zinc-950/40">
          <button
            onClick={() => setActiveTab("tree")}
            className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${
              activeTab === "tree"
                ? "bg-zinc-800 text-white shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Vault Tree
          </button>
          <button
            onClick={() => setActiveTab("recent")}
            className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${
              activeTab === "recent"
                ? "bg-zinc-800 text-white shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Recent
          </button>
          <button
            onClick={() => setActiveTab("important")}
            className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${
              activeTab === "important"
                ? "bg-zinc-800 text-white shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Important
          </button>
        </div>

        {/* Tree view with search filter */}
        {activeTab === "tree" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="p-2 border-b border-zinc-800/60">
              <Input
                placeholder="Filter files..."
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="h-8 text-xs bg-zinc-900/90"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {tree ? (
                tree.children && tree.children.length > 0 ? (
                  tree.children.map((child) => renderNode(child, 0))
                ) : (
                  <div className="text-center py-10 text-xs text-zinc-400">
                    <p>Vault is empty.</p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Chat with AI to save your first memory!
                    </p>
                    <Link href="/chat">
                      <Button size="sm" variant="outline" className="mt-4 text-xs">
                        Go to Chat
                      </Button>
                    </Link>
                  </div>
                )
              ) : (
                <div className="p-4 text-xs text-zinc-400">Loading vault...</div>
              )}
            </div>
          </div>
        )}

        {/* Recent view */}
        {activeTab === "recent" && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {recentItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectNote(item.file_path)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${
                  selectedPath === item.file_path
                    ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-800/60"
                }`}
              >
                <div className="font-semibold truncate">{item.title}</div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400">
                  <span>{item.topic}</span>
                  <span>•</span>
                  <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Important view */}
        {activeTab === "important" && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {importantItems.map((item) => (
              <button
                key={item.id}
                onClick={() => selectNote(item.file_path)}
                className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${
                  selectedPath === item.file_path
                    ? "bg-blue-600/20 border-blue-500/40 text-blue-300"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:bg-zinc-800/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold truncate">{item.title}</span>
                  <span className="text-amber-400 text-xs">★ {item.importance}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-400">
                  <span>{item.topic}</span>
                  <span>•</span>
                  <span>{item.knowledge_type}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Footer actions */}
        <div className="border-t border-zinc-800 p-2 flex justify-between items-center text-xs text-zinc-400">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              loadTree();
              loadRecent();
              loadImportant();
            }}
            className="h-7 text-xs gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
          <Link href="/chat">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> New Note
            </Button>
          </Link>
        </div>
      </div>

      {/* Right Main Panel: Note Viewer / Editor */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#0d1117]">
        {selectedPath ? (
          <>
            {/* Toolbar Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 bg-[#161b22]/70 backdrop-blur-xs">
              <div className="flex flex-col">
                <span className="text-xs text-zinc-400 font-mono flex items-center gap-1.5">
                  <span>vault</span>
                  <ChevronRight className="h-3 w-3 text-zinc-600" />
                  <span>{selectedPath}</span>
                </span>
                <h1 className="text-base font-semibold text-white tracking-tight mt-0.5">
                  {metadata?.title || selectedPath.split("/").pop()?.replace(/\.md$/, "")}
                </h1>
              </div>

              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(false)}
                      className="h-8 gap-1.5 text-xs text-zinc-300"
                    >
                      <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Save className="h-3.5 w-3.5" /> Save Changes
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNewPathInput(selectedPath);
                        setMoveDialogOpen(true);
                      }}
                      className="h-8 gap-1.5 text-xs text-zinc-400 hover:text-white"
                    >
                      <MoveRight className="h-3.5 w-3.5" /> Move
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(true)}
                      className="h-8 gap-1.5 text-xs text-zinc-300 hover:text-white"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Edit Note
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Note Metadata Strip */}
            {metadata && (
              <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/80 px-6 py-2 bg-zinc-950/30 text-xs text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {metadata.topic}
                  </Badge>
                  {metadata.subcategory && (
                    <Badge variant="outline" className="text-[11px]">
                      {metadata.subcategory}
                    </Badge>
                  )}
                  <Badge variant="purple" className="text-[10px]">
                    {metadata.knowledge_type?.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-amber-400 text-[11px]">
                  <Star className="h-3 w-3 fill-amber-400" />
                  <span>Importance: {metadata.importance}/5</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <Clock className="h-3 w-3" />
                  <span>Updated: {new Date(metadata.updated_at).toLocaleDateString()}</span>
                </div>
                {metadata.query_count > 0 && (
                  <span className="text-blue-400 text-[11px]">
                    Queried: {metadata.query_count} times
                  </span>
                )}
              </div>
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8 max-w-4xl w-full">
              {isLoading ? (
                <div className="text-zinc-400 text-sm">Loading note content...</div>
              ) : isEditing ? (
                <div className="space-y-4">
                  <Textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={26}
                    className="w-full font-mono text-sm leading-relaxed p-4 bg-zinc-950 border-zinc-700"
                  />
                  <div className="text-xs text-zinc-400">
                    Use GitHub Flavored Markdown. Heading 1 (# Title), code blocks (```java), bullet points.
                  </div>
                </div>
              ) : (
                <article className="prose prose-invert max-w-none prose-headings:text-white prose-a:text-blue-400 prose-pre:bg-[#161b22] prose-pre:border prose-pre:border-zinc-800">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {content}
                  </ReactMarkdown>
                </article>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center p-8 text-zinc-400">
            <div className="h-12 w-12 rounded-xl bg-zinc-900 flex items-center justify-center text-zinc-400 mb-4 border border-zinc-800">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="text-base font-medium text-zinc-200">No Knowledge Note Selected</h3>
            <p className="mt-1 text-xs text-zinc-400 max-w-sm">
              Select a Markdown file from the left sidebar to read, edit, or test your memory, or talk to the AI to capture new insights.
            </p>
            <Link href="/chat">
              <Button size="sm" className="mt-4 text-xs bg-blue-600 hover:bg-blue-700">
                Open AI Chat
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Delete Modal */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogHeader>
          <DialogTitle>Delete Knowledge Note?</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong className="text-white">{selectedPath}</strong>? This will remove the Markdown file from your vault and delete its metadata records.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Yes, Delete Permanently
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Move / Rename Modal */}
      <Dialog open={moveDialogOpen} onOpenChange={setMoveDialogOpen}>
        <DialogHeader>
          <DialogTitle>Move or Recategorize Knowledge</DialogTitle>
          <DialogDescription>
            Enter the new relative path inside your vault (e.g. <code>DSA/Graph/BFS.md</code>).
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input
            value={newPathInput}
            onChange={(e) => setNewPathInput(e.target.value)}
            className="text-sm font-mono"
            placeholder="Topic/Subcategory/Note.md"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setMoveDialogOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleMove} className="bg-blue-600 hover:bg-blue-700">
            Move Note
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

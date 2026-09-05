import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readKnowledge, knowledgeExists } from "@/lib/vault";
import { getDb } from "@/lib/db";
import { recordInteraction } from "@/lib/memory/tracker";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ArrowLeft, Edit3, Star, Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PageProps {
  params: Promise<{ path: string[] }>;
}

export default async function KnowledgeDetailPage({ params }: PageProps) {
  const { path: pathSegments } = await params;
  const filePath = pathSegments.join("/");

  if (!knowledgeExists(filePath)) {
    notFound();
  }

  const content = readKnowledge(filePath);
  const db = getDb();
  const meta = db.prepare("SELECT * FROM memories WHERE file_path = ?").get(filePath) as any;

  if (meta && meta.id) {
    recordInteraction(meta.id, "viewed");
  }

  const title = meta?.title || pathSegments[pathSegments.length - 1].replace(/\.md$/, "");

  return (
    <div className="min-h-screen bg-[#0d1117] p-6 lg:p-10 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/knowledge">
          <Button variant="outline" size="sm" className="gap-2 text-xs text-zinc-300 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Knowledge Browser
          </Button>
        </Link>
        <Link href={`/knowledge`}>
          <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
            <Edit3 className="h-3.5 w-3.5" /> Open in Editor
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#161b22] p-8 shadow-md">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="secondary" className="font-mono text-xs">
            {meta?.topic || "Knowledge"}
          </Badge>
          {meta?.subcategory && (
            <Badge variant="outline" className="text-xs">
              {meta.subcategory}
            </Badge>
          )}
          {meta?.knowledge_type && (
            <Badge variant="purple" className="text-xs">
              {meta.knowledge_type.replace("_", " ")}
            </Badge>
          )}
          {meta?.importance && (
            <span className="flex items-center gap-1 text-amber-400 text-xs ml-auto">
              <Star className="h-3.5 w-3.5 fill-amber-400" /> {meta.importance}/5
            </span>
          )}
        </div>

        <div className="text-xs text-zinc-400 font-mono mb-6 pb-4 border-b border-zinc-800 flex items-center justify-between">
          <span>vault/{filePath}</span>
          {meta?.updated_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {new Date(meta.updated_at).toLocaleDateString()}
            </span>
          )}
        </div>

        <article className="prose prose-invert max-w-none prose-headings:text-white prose-a:text-blue-400 prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}

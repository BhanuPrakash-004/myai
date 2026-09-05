"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Send,
  Sparkles,
  BookmarkCheck,
  RotateCcw,
  FileText,
  HelpCircle,
  Copy,
  Check,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  memorySaved?: {
    action: string;
    filePath?: string;
    topic?: string;
    subcategory?: string;
    importance?: number;
    message?: string;
  };
  sources?: string[];
}

const STARTER_PROMPTS = [
  "I always forget that in BFS I need to capture q.size() before the for loop.",
  "Remember this syntax: for (Map.Entry<Integer,Integer> entry : map.entrySet())",
  "Explain everything important I have stored about BFS.",
  "What coding things do I usually forget?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your **AI Knowledge Base Companion**.\n\nYou don't need to choose folders or manually organize notes. Just chat naturally — tell me syntax you keep forgetting, LeetCode approaches, DSA edge cases, or common mistakes. I will automatically extract, classify, and save them into your Markdown vault.\n\nYou can also ask questions about what you've saved anytime!",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate fresh session ID on mount
    setSessionId(`sess_${Date.now()}`);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: text,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const assistantMsgId = `asst_${Date.now()}`;
    // Add placeholder assistant message
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          sessionId,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Failed to send message: ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";
      let memoryData: any = null;
      let sourcesData: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const raw = trimmed.slice(6);
          if (raw === "[DONE]") break;

          try {
            const parsed = JSON.parse(raw);
            if (parsed.type === "meta") {
              if (parsed.memory && parsed.memory.saved) {
                memoryData = parsed.memory;
              }
              if (parsed.sources) {
                sourcesData = parsed.sources;
              }
            } else if (parsed.type === "chunk") {
              accumulatedContent += parsed.content;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: accumulatedContent,
                        memorySaved: memoryData,
                        sources: sourcesData,
                      }
                    : msg
                )
              );
            }
          } catch {
            // ignore malformed SSE
          }
        }
      }

      // Final update
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: accumulatedContent || "Processed.",
                memorySaved: memoryData,
                sources: sourcesData,
              }
            : msg
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: `Error: ${err.message || "Could not complete request"}. Please check your connection or AI provider in Settings.`,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const startNewChat = () => {
    setSessionId(`sess_${Date.now()}`);
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Started a fresh conversation. What would you like to save or review today?",
      },
    ]);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-[#0d1117]">
      {/* Top Banner with Quick Actions */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2 bg-zinc-950/40 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-blue-400" />
          <span>Zero-friction capture active — Talk naturally to save notes</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={startNewChat}
          className="h-7 text-xs text-zinc-400 hover:text-white"
        >
          <RotateCcw className="h-3 w-3 mr-1" /> Clear Chat
        </Button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl w-full mx-auto">
        {messages.map((msg) => {
          const isUser = msg.role === "user";

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"} space-y-2`}
            >
              <div className="flex items-center gap-2 text-xs text-zinc-400 px-1">
                {isUser ? (
                  <span className="font-semibold text-zinc-300">You</span>
                ) : (
                  <div className="flex items-center gap-1.5 font-semibold text-blue-400">
                    <Terminal className="h-3 w-3" />
                    <span>MyAI Assistant</span>
                  </div>
                )}
              </div>

              <div
                className={`relative rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-2xl break-words shadow-sm ${
                  isUser
                    ? "bg-blue-600 text-white rounded-tr-none"
                    : "bg-[#161b22] text-zinc-100 border border-zinc-800 rounded-tl-none"
                }`}
              >
                {!isUser ? (
                  <div className="prose prose-invert prose-sm max-w-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}

                {/* Copy button */}
                {!isUser && msg.content && (
                  <button
                    onClick={() => handleCopy(msg.content, msg.id)}
                    className="absolute top-2 right-2 text-zinc-400 hover:text-white p-1 rounded opacity-0 hover:opacity-100 transition-opacity"
                    title="Copy message"
                  >
                    {copiedId === msg.id ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                )}
              </div>

              {/* Memory Capture Notification Badge */}
              {msg.memorySaved && msg.memorySaved.filePath && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-800/40 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300 animate-in fade-in-50">
                  <BookmarkCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>
                    {msg.memorySaved.action === "CREATE"
                      ? "Saved new knowledge:"
                      : "Updated existing note:"}{" "}
                    <Link
                      href={`/knowledge/${msg.memorySaved.filePath}`}
                      className="font-mono underline hover:text-emerald-100 font-semibold"
                    >
                      vault/{msg.memorySaved.filePath}
                    </Link>
                  </span>
                  <Badge variant="success" className="ml-1 text-[10px] py-0 px-1.5">
                    {msg.memorySaved.action}
                  </Badge>
                </div>
              )}

              {/* Sources Cited */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-zinc-400 px-1">
                  <FileText className="h-3 w-3 text-zinc-400" />
                  <span>Sources:</span>
                  {msg.sources.map((src) => (
                    <Link
                      key={src}
                      href={`/knowledge/${src}`}
                      className="text-blue-400 hover:underline font-mono text-[11px]"
                    >
                      {src}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-zinc-400 pl-2">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="animate-pulse">Thinking, checking knowledge, and responding...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Starter Prompts (shown when only initial message) */}
      {messages.length === 1 && (
        <div className="px-4 py-2 max-w-4xl w-full mx-auto">
          <div className="text-xs text-zinc-400 mb-2 flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Try asking or saving one of these:</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STARTER_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(prompt)}
                className="text-left text-xs p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-700 transition-all truncate"
              >
                &ldquo;{prompt}&rdquo;
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-zinc-800 bg-[#161b22] p-4">
        <div className="max-w-4xl mx-auto flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tell me what you keep forgetting, ask about saved knowledge, or say 'Quiz me'..."
              rows={2}
              className="resize-none pr-10 text-sm font-sans"
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="h-14 px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-md shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-w-4xl mx-auto flex justify-between items-center text-[11px] text-zinc-400 mt-2 px-1">
          <span>Press Enter to send, Shift+Enter for new line</span>
          <span>Knowledge is stored locally in standard Markdown files</span>
        </div>
      </div>
    </div>
  );
}

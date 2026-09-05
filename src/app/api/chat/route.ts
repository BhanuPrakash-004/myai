import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { processMessageMemory } from "@/lib/memory/engine";
import { buildSearchContext } from "@/lib/ai/tools/search";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages = [], sessionId } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages array is required" }, { status: 400 });
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.content) {
      return NextResponse.json({ error: "Last message must have content" }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();

    // 1. Resolve or create chat session
    const activeSessionId = sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const existingSession = db.prepare("SELECT id FROM chat_sessions WHERE id = ?").get(activeSessionId);
    if (!existingSession) {
      const title = lastMessage.content.slice(0, 40) + (lastMessage.content.length > 40 ? "..." : "");
      db.prepare("INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
        activeSessionId,
        title,
        now,
        now
      );
    } else {
      db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(now, activeSessionId);
    }

    // 2. Persist user message
    const userMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(
      "INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)"
    ).run(userMsgId, activeSessionId, lastMessage.content, now);

    // 3. AI provider
    const ai = await getAIProvider();

    // 4. Memory Engine analysis
    const history = messages.slice(-5).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    const { decision, result } = await processMessageMemory(lastMessage.content, history, ai);

    // 5. If it's a query or explanation, retrieve relevant saved knowledge
    let knowledgeContext = "";
    let sources: string[] = [];
    if (decision.action === "QUERY" || decision.action === "EXPLAIN" || !result.saved) {
      const searchRes = buildSearchContext(lastMessage.content, 3);
      knowledgeContext = searchRes.contextText;
      sources = searchRes.sources;
    }

    // 6. Build system prompt
    let systemInstruction = `You are a personalized developer knowledge companion.
Your goal is to help the user retain small, critical programming details (syntax, API nuances, logic, DSA patterns, common mistakes, LeetCode approaches).
`;

    if (result.saved) {
      systemInstruction += `\nNOTE: You have just automatically preserved the technical knowledge from their message in: "${result.filePath}".
Acknowledge this naturally and concisely (e.g. "I've saved this under ${result.topic} → ${result.subcategory}"), then provide any helpful extra tips or code patterns if applicable.`;
    }

    if (knowledgeContext) {
      systemInstruction += `\n${knowledgeContext}\nAnswer the user's question using their saved personal knowledge above. When referring to their notes, cite the file name. If they haven't saved information about this topic yet, mention that and provide a clear, accurate explanation.`;
    }

    const aiMessages = [
      { role: "system" as const, content: systemInstruction },
      ...messages.slice(-8).map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content as string,
      })),
    ];

    // 7. Create SSE response stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send initial metadata
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "meta",
              sessionId: activeSessionId,
              provider: ai.name,
              memory: result,
              sources,
            })}\n\n`
          )
        );

        let assistantReply = "";

        try {
          for await (const chunk of ai.chatStream(aiMessages)) {
            assistantReply += chunk;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "chunk",
                  content: chunk,
                })}\n\n`
              )
            );
          }
        } catch (err: any) {
          const fallback = ` (Note: Local model response: ${err.message || "stream error"})`;
          assistantReply += fallback;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "chunk",
                content: fallback,
              })}\n\n`
            )
          );
        }

        // Persist assistant reply
        const botMsgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        db.prepare(
          "INSERT INTO chat_messages (id, session_id, role, content, memory_saved, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)"
        ).run(
          botMsgId,
          activeSessionId,
          assistantReply || "Processed.",
          result.saved ? JSON.stringify(result) : null,
          now
        );

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const db = getDb();

    if (sessionId) {
      const messages = db
        .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC")
        .all(sessionId);
      return NextResponse.json({ messages });
    }

    const sessions = db
      .prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 30")
      .all();
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

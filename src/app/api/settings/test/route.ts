import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, baseUrl, model } = body;

    const cleanBaseUrl = (baseUrl || "").trim().replace(/\/$/, "");
    const cleanApiKey = (apiKey || "").trim();
    const cleanModel = (model || "").trim();

    const startTime = Date.now();

    if (provider === "ollama") {
      const targetUrl = cleanBaseUrl || "http://localhost:11434";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      try {
        const res = await fetch(`${targetUrl}/api/tags`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
          return NextResponse.json({
            success: false,
            error: `Ollama returned status ${res.status}: ${res.statusText}`,
          });
        }

        const data = await res.json();
        const availableModels = (data.models || []).map((m: any) => m.name);

        return NextResponse.json({
          success: true,
          message: `Connected to local Ollama (${latencyMs}ms)!`,
          models: availableModels,
          latencyMs,
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        return NextResponse.json({
          success: false,
          error: `Could not reach Ollama at ${targetUrl}: ${err.message || "Connection refused"}`,
        });
      }
    }

    // BYOK / OpenAI / Google AI Studio / OpenRouter / Groq
    if (!cleanApiKey) {
      return NextResponse.json({
        success: false,
        error: "API key is required to test cloud provider connection.",
      });
    }

    const targetUrl = cleanBaseUrl || "https://api.openai.com/v1";
    const targetModel = cleanModel || (targetUrl.includes("googleapis.com") ? "gemini-2.0-flash" : "gpt-4o-mini");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(`${targetUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanApiKey}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "MyAI Knowledge Base",
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: "Say hello in one word." }],
          max_tokens: 10,
        }),
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      if (!res.ok) {
        let errText = await res.text().catch(() => "Unknown error");
        try {
          const parsed = JSON.parse(errText);
          errText = parsed.error?.message || parsed.message || errText;
        } catch {
          // keep text
        }
        return NextResponse.json({
          success: false,
          error: `Provider returned HTTP ${res.status}: ${errText}`,
        });
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || "OK";

      return NextResponse.json({
        success: true,
        message: `Verified! Model "${targetModel}" responded: "${reply}" (${latencyMs}ms)`,
        model: targetModel,
        latencyMs,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      return NextResponse.json({
        success: false,
        error: `Connection failed: ${err.message || "Request timed out"}`,
      });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

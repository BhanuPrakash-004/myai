import { AIProvider, ChatMessage, AIOptions } from "./provider";
import { config } from "../config";

export class OllamaProvider implements AIProvider {
  id = "ollama";
  name = "Ollama (Local)";
  private customConfig?: { baseUrl?: string; model?: string };

  constructor(customConfig?: { baseUrl?: string; model?: string }) {
    this.customConfig = customConfig;
  }

  private get baseUrl(): string {
    return (this.customConfig?.baseUrl || config.ollamaBaseUrl).replace(/\/$/, "");
  }

  private get model(): string {
    return this.customConfig?.model || config.ollamaModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], options?: AIOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Ollama chat error (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    return data.message?.content || "";
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: AIOptions
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens,
        },
      }),
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => "Unknown error");
      throw new Error(`Ollama stream error (${res.status}): ${errorText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) {
              yield parsed.message.content;
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch {
          // ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatStructured<T>(
    messages: ChatMessage[],
    schemaDescription: string
  ): Promise<T> {
    const systemPrompt = `You must return ONLY a valid JSON object matching this specification:
${schemaDescription}
DO NOT wrap the output in markdown fences (like \`\`\`json). Output pure JSON only.`;

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: fullMessages.map((m) => ({ role: m.role, content: m.content })),
        format: "json",
        stream: false,
        options: { temperature: 0.1 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama structured response error: ${res.status}`);
    }

    const data = await res.json();
    const content = data.message?.content || "{}";
    try {
      return JSON.parse(content) as T;
    } catch {
      // Clean potential fences if model included them
      const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
      return JSON.parse(cleaned) as T;
    }
  }
}

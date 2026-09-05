import { AIProvider, ChatMessage, AIOptions } from "./provider";
import { config } from "../config";

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI / Compatible";

  private get apiKey(): string {
    return config.openaiApiKey;
  }

  private get baseUrl(): string {
    return config.openaiBaseUrl.replace(/\/$/, "");
  }

  private get model(): string {
    return config.openaiModel;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async chat(messages: ChatMessage[], options?: AIOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown error");
      throw new Error(`OpenAI API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async *chatStream(
    messages: ChatMessage[],
    options?: AIOptions
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`OpenAI stream error: ${res.status}`);
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
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") return;
          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // ignore malformed SSE
            }
          }
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
Output pure raw JSON. Do not wrap in markdown quotes.`;

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    const content = await this.chat(fullMessages, { temperature: 0.1 });
    const cleaned = content.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
    return JSON.parse(cleaned) as T;
  }
}

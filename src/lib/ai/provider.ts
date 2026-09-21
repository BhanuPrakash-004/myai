import type { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  operationId?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  chat(messages: ChatMessage[], options?: AIOptions): Promise<string>;
  chatStream(messages: ChatMessage[], options?: AIOptions): AsyncGenerator<string>;
  chatStructured<T>(messages: ChatMessage[], schema: z.ZodType<T>, options?: AIOptions): Promise<T>;
  isAvailable(task?: "chat" | "structured"): Promise<boolean>;
}

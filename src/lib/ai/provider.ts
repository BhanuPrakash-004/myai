export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  chat(messages: ChatMessage[], options?: AIOptions): Promise<string>;
  chatStream(messages: ChatMessage[], options?: AIOptions): AsyncGenerator<string>;
  chatStructured<T>(messages: ChatMessage[], schemaDescription: string): Promise<T>;
  isAvailable(): Promise<boolean>;
}

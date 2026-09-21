import type { AIProvider } from "./provider";

export class UnavailableProvider implements AIProvider {
  readonly id = "unavailable";
  readonly name = "AI unavailable";
  constructor(private readonly reason = "AI is not configured. Add an OpenRouter key and model in Settings. Saved notes remain available.") {}
  async isAvailable() { return false; }
  async chat(): Promise<string> { throw new Error(this.reason); }
  async *chatStream(): AsyncGenerator<string> { yield await this.chat(); }
  async chatStructured<T>(): Promise<T> { throw new Error(this.reason); }
}

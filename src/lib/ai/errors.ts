import { DomainError } from "../storage/access";
export type AIErrorCode = "AI_BUSY" | "AI_UNAVAILABLE" | "AI_AUTH" | "AI_CREDITS" | "AI_RATE_LIMIT" | "AI_PROVIDER" | "AI_INVALID_REQUEST" | "AI_TIMEOUT" | "AI_CANCELLED" | "AI_MALFORMED" | "AI_INCOMPLETE" | "AI_BUDGET" | "AI_PROFILE";
const messages: Record<AIErrorCode, string> = {
  AI_BUSY: "Four AI requests are already running. Retry after one finishes.",
  AI_UNAVAILABLE: "Configure the server OpenRouter key and the model for this task.",
  AI_AUTH: "OpenRouter rejected the API key. Check the server configuration.",
  AI_CREDITS: "OpenRouter credits are exhausted.",
  AI_RATE_LIMIT: "OpenRouter is rate limited. Retry later.",
  AI_PROVIDER: "The AI provider is temporarily unavailable.",
  AI_INVALID_REQUEST: "This model or provider does not support the requested task or parameters.",
  AI_TIMEOUT: "The AI request timed out. Incomplete output was not saved.",
  AI_CANCELLED: "The AI request was cancelled.",
  AI_MALFORMED: "The AI response did not pass validation.",
  AI_INCOMPLETE: "The AI response ended before a complete answer was received.",
  AI_BUDGET: "The installation's daily AI request or token allowance has been reached.",
  AI_PROFILE: "The embedding response does not match the selected profile.",
};
export class AIError extends DomainError {
  constructor(public readonly aiCode: AIErrorCode, public readonly retryable = false, public readonly retryAfterMs = 0) {
    super(aiCode, messages[aiCode], aiCode === "AI_BUDGET" || aiCode === "AI_RATE_LIMIT" ? 429 : aiCode === "AI_CANCELLED" ? 499 : 503);
  }
}
export function providerError(status: number, retryAfterMs = 0) {
  return new AIError(status === 401 || status === 403 ? "AI_AUTH" : status === 402 ? "AI_CREDITS" : status === 429 ? "AI_RATE_LIMIT" : status >= 500 ? "AI_PROVIDER" : "AI_INVALID_REQUEST", status === 429 || status >= 500, retryAfterMs);
}
export function safeAIError(error: unknown, signal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  if (signal?.aborted) return new AIError(signal.reason?.name === "TimeoutError" ? "AI_TIMEOUT" : "AI_CANCELLED");
  return new AIError("AI_MALFORMED");
}

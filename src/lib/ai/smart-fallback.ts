import { AIProvider, ChatMessage, AIOptions } from "./provider";

export class SmartFallbackProvider implements AIProvider {
  id = "smart-fallback";
  name = "Built-in Knowledge Engine (Offline Mode)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const lastMsg = messages[messages.length - 1]?.content || "";
    return this.generateResponse(lastMsg);
  }

  async *chatStream(
    messages: ChatMessage[],
    _options?: AIOptions
  ): AsyncGenerator<string> {
    const response = await this.chat(messages);
    const words = response.split(" ");
    for (let i = 0; i < words.length; i++) {
      yield (i === 0 ? "" : " ") + words[i];
      await new Promise((r) => setTimeout(r, 15));
    }
  }

  async chatStructured<T>(
    messages: ChatMessage[],
    _schemaDescription: string
  ): Promise<T> {
    const lastMsg = messages[messages.length - 1]?.content || "";
    const lower = lastMsg.toLowerCase();

    // Determine if it is a query or a save request
    const isQuery =
      lower.startsWith("what ") ||
      lower.startsWith("how ") ||
      lower.startsWith("show ") ||
      lower.startsWith("tell ") ||
      lower.startsWith("explain ") ||
      lower.startsWith("search ") ||
      lower.includes("quiz me") ||
      lower.includes("review ");

    if (isQuery) {
      if (lower.includes("quiz")) {
        return {
          action: "QUIZ",
          topic: this.detectTopic(lower),
          subcategory: this.detectSubcategory(lower),
          knowledgeType: "general",
          importance: 3,
          content: lastMsg,
          reasoning: "User wants a quiz session.",
        } as unknown as T;
      }
      if (lower.includes("review")) {
        return {
          action: "REVIEW",
          topic: this.detectTopic(lower),
          subcategory: this.detectSubcategory(lower),
          knowledgeType: "general",
          importance: 3,
          content: lastMsg,
          reasoning: "User asked for a review.",
        } as unknown as T;
      }
      return {
        action: "QUERY",
        topic: this.detectTopic(lower),
        subcategory: this.detectSubcategory(lower),
        knowledgeType: "concept",
        importance: 3,
        content: lastMsg,
        reasoning: "User is querying existing knowledge.",
      } as unknown as T;
    }

    // Determine topic & subcategory
    const topic = this.detectTopic(lower);
    const subcategory = this.detectSubcategory(lower);
    const knowledgeType = this.detectKnowledgeType(lower);
    const importance = lower.includes("always forget") || lower.includes("mistake") || lower.includes("important") ? 5 : 4;

    return {
      action: "CREATE",
      topic,
      subcategory,
      knowledgeType,
      importance,
      content: lastMsg.replace(/^(remember|save|note down|i always forget that|note that)\s*/i, "").trim(),
      reasoning: "Extracted developer knowledge to store.",
    } as unknown as T;
  }

  private detectTopic(text: string): string {
    if (text.includes("java ") || text.includes("hashmap") || text.includes("map.entry") || text.includes("stream")) return "Java";
    if (text.includes("python") || text.includes("dict") || text.includes("list comp")) return "Python";
    if (text.includes("bfs") || text.includes("dfs") || text.includes("graph") || text.includes("dp") || text.includes("tree") || text.includes("sliding window") || text.includes("two pointer") || text.includes("binary search") || text.includes("dsa")) return "DSA";
    if (text.includes("leetcode") || text.includes("3sum") || text.includes("two sum") || text.includes("trap rain")) return "LeetCode";
    if (text.includes("sql") || text.includes("postgres") || text.includes("index") || text.includes("database")) return "Database";
    if (text.includes("react") || text.includes("next.js") || text.includes("hook") || text.includes("state")) return "Frontend";
    return "General";
  }

  private detectSubcategory(text: string): string {
    if (text.includes("bfs")) return "Graph/BFS";
    if (text.includes("dfs")) return "Graph/DFS";
    if (text.includes("graph")) return "Graph";
    if (text.includes("dp") || text.includes("dynamic programming")) return "Dynamic-Programming";
    if (text.includes("binary search")) return "Binary-Search";
    if (text.includes("sliding window")) return "Sliding-Window";
    if (text.includes("two pointer")) return "Two-Pointers";
    if (text.includes("hashmap") || text.includes("map")) return "Collections/Map";
    if (text.includes("stream")) return "Streams";
    if (text.includes("3sum")) return "3Sum";
    if (text.includes("two sum")) return "Two-Sum";
    return "General";
  }

  private detectKnowledgeType(text: string): string {
    if (text.includes("mistake") || text.includes("forget") || text.includes("wrong") || text.includes("bug")) return "common_mistake";
    if (text.includes("entry :") || text.includes("->") || text.includes("()")) return "syntax";
    if (text.includes("method") || text.includes("function") || text.includes("api")) return "api_function";
    if (text.includes("pattern")) return "dsa_pattern";
    if (text.includes("approach")) return "leetcode_approach";
    return "concept";
  }

  private generateResponse(text: string): string {
    const topic = this.detectTopic(text.toLowerCase());
    const sub = this.detectSubcategory(text.toLowerCase());
    return `I've processed your message and organized it under **${topic} → ${sub}**. It is preserved in your Markdown vault and indexed for smart retrieval, revision, and quizzes.`;
  }
}

import "dotenv/config";
import type { DataSource } from "./data/datasource";
import { MockDataSource } from "./data/mock-datasource";

export function getDataSource(): DataSource {
  const source = process.env.DATA_SOURCE || "mock";
  if (source === "fhir") {
    throw new Error("FHIR datasource not yet implemented - use DATA_SOURCE=mock");
  }
  return new MockDataSource();
}

function isPlaceholderKey(key: string): boolean {
  return key.includes("...");
}

export function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || isPlaceholderKey(key)) {
    throw new Error("ANTHROPIC_API_KEY is required — replace the placeholder in .env");
  }
  return key;
}

export const PORT = parseInt(process.env.PORT || "3000", 10);

export function getLangfuseCallbacks(sessionId?: string): unknown[] {
  try {
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;

    if (!secretKey || !publicKey) {
      return [];
    }

    if (isPlaceholderKey(secretKey) || isPlaceholderKey(publicKey)) {
      console.warn("Langfuse keys contain placeholders — observability disabled. Add real keys to .env");
      return [];
    }

    const { CallbackHandler } = require("@langfuse/langchain");
    return [
      new CallbackHandler({
        sessionId: sessionId || "default",
        tags: ["agentforge"],
        baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
      }),
    ];
  } catch {
    // @langfuse/langchain not installed or init failed
  }
  return [];
}

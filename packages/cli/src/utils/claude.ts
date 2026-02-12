import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./ollama.js";

const CLAUDE_MODELS = [
  { name: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5" },
  { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5" },
];

const DEFAULT_MODEL = CLAUDE_MODELS[0].name;

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Check if Claude API is available (API key set and valid)
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  const client = getClient();
  if (!client) return false;

  try {
    // Quick validation — list models endpoint
    await client.models.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * List available Claude models
 */
export function listClaudeModels(): Array<{ name: string; displayName: string }> {
  return CLAUDE_MODELS;
}

/**
 * Select the default Claude model
 */
export function selectClaudeModel(): string {
  return DEFAULT_MODEL;
}

/**
 * Convert our ChatMessage format to Anthropic format.
 * Anthropic requires system message as a separate parameter.
 */
function convertMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  return {
    system: systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join("\n\n")
      : undefined,
    messages: conversationMessages,
  };
}

/**
 * Send a chat completion request to Claude (non-streaming)
 */
export async function claudeChat(
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = getClient();
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const { system, messages: anthropicMessages } = convertMessages(messages);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system,
    messages: anthropicMessages,
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}

/**
 * Stream a chat completion request to Claude
 */
export async function* claudeChatStream(
  model: string,
  messages: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
  const client = getClient();
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const { system, messages: anthropicMessages } = convertMessages(messages);

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system,
    messages: anthropicMessages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

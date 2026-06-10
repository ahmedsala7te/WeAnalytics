import type { OllamaModelInfo } from "@/lib/types";

/* ------------------------------------------------------------------------
 * Minimal Ollama client (native API, no SDK).
 * Works directly from the browser: Ollama allows localhost origins by
 * default. Streaming uses NDJSON over fetch ReadableStream.
 * ---------------------------------------------------------------------- */

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaTagsResponse {
  models?: {
    name: string;
    size: number;
    details?: { family?: string; parameter_size?: string };
  }[];
}

export async function pingOllama(baseUrl: string, timeoutMs = 3500): Promise<OllamaModelInfo[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Ollama responded with HTTP ${res.status}`);
    const data = (await res.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeGb: Math.round((m.size / 1024 ** 3) * 100) / 100,
      paramSize: m.details?.parameter_size,
      family: m.details?.family,
    }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rank installed models for this workload (general chat/narrative on CPU).
 * Prefers general instruct models in the 2–8B band; penalizes huge models
 * (CPU-only machines) and task-specialized ones.
 */
export function pickDefaultModel(models: OllamaModelInfo[]): string | null {
  if (models.length === 0) return null;
  const score = (m: OllamaModelInfo): number => {
    const n = m.name.toLowerCase();
    let s = 0;
    const params = parseFloat(m.paramSize ?? "") || m.sizeGb * 1.8;
    if (params >= 2 && params <= 8.5) s += 40;
    else if (params < 2) s += 22;
    else if (params <= 15) s += 8; // big = slow on CPU
    if (/instruct|chat/.test(n)) s += 10;
    if (/coder|code|sql|embed|vision|reasoning-only/.test(n)) s -= 12;
    if (/llama3|qwen2\.5|qwen3|phi3|phi4|gemma2|gemma3|mistral/.test(n)) s += 8;
    s -= Math.abs(params - 3.5); // sweet spot ~3-4B
    return s;
  };
  return [...models].sort((a, b) => score(b) - score(a))[0].name;
}

export interface ChatStreamOptions {
  baseUrl: string;
  model: string;
  messages: LlmChatMessage[];
  onToken?: (full: string, delta: string) => void;
  signal?: AbortSignal;
  temperature?: number;
  json?: boolean;
  maxTokens?: number;
}

/** Streaming chat completion. Resolves with the full response text. */
export async function streamChat(opts: ChatStreamOptions): Promise<string> {
  const { baseUrl, model, messages, onToken, signal, temperature = 0.5, json, maxTokens } = opts;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: "15m",
      ...(json ? { format: "json" } : {}),
      options: {
        temperature,
        num_ctx: 8192,
        ...(maxTokens ? { num_predict: maxTokens } : {}),
      },
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama chat failed (HTTP ${res.status}) ${detail.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean; error?: string };
        if (evt.error) throw new Error(evt.error);
        const delta = evt.message?.content ?? "";
        if (delta) {
          full += delta;
          onToken?.(full, delta);
        }
      } catch (e) {
        if (e instanceof Error && !trimmed.startsWith("{")) continue; // partial line noise
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  return full;
}

/** Non-streaming completion (used for narrative enhancement). */
export async function chatOnce(opts: Omit<ChatStreamOptions, "onToken">): Promise<string> {
  return streamChat({ ...opts });
}

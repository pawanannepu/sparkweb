import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { db, getDecryptedApiKey } from "@spark/db";
import type { AiProvider, ProjectFile } from "@spark/shared";
import type { LanguageModel } from "ai";

const LOCAL_DEV_FALLBACK_ENCRYPTION_KEY =
  "sparkweb-local-development-encryption-key-do-not-use-in-prod";

export function resolveAppMasterEncryptionKey(): string | undefined {
  const configured = process.env.SPARK_ENCRYPTION_KEY?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV !== "production") {
    return LOCAL_DEV_FALLBACK_ENCRYPTION_KEY;
  }
  return undefined;
}

export function getEnvProviderApiKey(provider: AiProvider): string | null {
  switch (provider) {
    case "openrouter":
      return process.env.OPENROUTER_API_KEY?.trim() || null;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim() || null;
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() || null;
    case "gemini":
      return process.env.GEMINI_API_KEY?.trim() || null;
  }
}

export async function resolveProviderApiKey(params: {
  userId: string;
  provider: AiProvider;
}): Promise<string | null> {
  try {
    const dbKey = await getDecryptedApiKey(
      db,
      { userId: params.userId, provider: params.provider },
      resolveAppMasterEncryptionKey()
    );
    if (dbKey) {
      return dbKey;
    }
  } catch {
    // Fall back to environment key below
  }
  return getEnvProviderApiKey(params.provider);
}

export function createAiLanguageModel(
  provider: AiProvider,
  modelId: string,
  apiKey: string
): LanguageModel {
  switch (provider) {
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
        headers: {
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "sparkweb",
        },
      });
      // OpenRouter implements the Chat Completions API rather than OpenAI's Responses API.
      return openrouter.chat(modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(modelId);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
  }
}

export interface ParsedGeneratedFilesResult {
  summary?: string;
  files: ProjectFile[];
}

function sanitizeGeneratedPath(rawPath: string): string | null {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }
  const normalized = trimmed.replace(/^(?:\.\/)+/, "");
  const segments = normalized.split("/");
  if (segments.some((seg) => !seg || seg === "." || seg === "..")) {
    return null;
  }
  return normalized;
}

function tryParseJsonFiles(candidate: string): ParsedGeneratedFilesResult | null {
  try {
    const parsed = JSON.parse(candidate) as {
      summary?: unknown;
      files?: Array<{ path?: unknown; content?: unknown }>;
    };
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }

    const byPath = new Map<string, string>();
    for (const entry of parsed.files) {
      if (typeof entry?.path === "string" && typeof entry?.content === "string") {
        const safePath = sanitizeGeneratedPath(entry.path);
        if (safePath) {
          byPath.set(safePath, entry.content);
        }
      }
    }

    if (byPath.size === 0) {
      return null;
    }

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      files: Array.from(byPath.entries()).map(([path, content]) => ({ path, content })),
    };
  } catch {
    return null;
  }
}

export function parseGeneratedFilesPayload(rawText: string): ParsedGeneratedFilesResult | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Direct JSON payload
  const direct = tryParseJsonFiles(trimmed);
  if (direct) {
    return direct;
  }

  // 2. JSON inside markdown code fence
  const jsonFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonFenceMatch?.[1]) {
    const fromFence = tryParseJsonFiles(jsonFenceMatch[1].trim());
    if (fromFence) {
      return fromFence;
    }
  }

  // 3. First outermost JSON object in prose
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const sliced = tryParseJsonFiles(trimmed.slice(firstBrace, lastBrace + 1));
    if (sliced) {
      return sliced;
    }
  }

  // 4. Fallback: fenced code blocks with path/file attributes (e.g. ```tsx file="src/App.tsx")
  const blockRegex = /```[a-zA-Z0-9_-]*\s+(?:file|path)=["']([^"']+)["'][^\n]*\n([\s\S]*?)```/g;
  const byPath = new Map<string, string>();
  let match = blockRegex.exec(trimmed);
  while (match !== null) {
    const rawPath = match[1];
    const content = match[2];
    if (rawPath && typeof content === "string") {
      const safePath = sanitizeGeneratedPath(rawPath);
      if (safePath) {
        byPath.set(safePath, content);
      }
    }
    match = blockRegex.exec(trimmed);
  }

  if (byPath.size > 0) {
    return {
      files: Array.from(byPath.entries()).map(([path, content]) => ({ path, content })),
    };
  }

  return null;
}

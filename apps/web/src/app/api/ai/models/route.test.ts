import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateProviderModelsCache } from "@/lib/openrouter-cache";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/ai-provider", () => ({
  resolveProviderApiKey: vi.fn(),
  getEnvProviderApiKey: vi.fn(),
}));

import { getEnvProviderApiKey, resolveProviderApiKey } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import { GET } from "./route";

describe("/api/ai/models route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateProviderModelsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches live models for configured Anthropic, OpenAI, and Gemini keys while filtering non-chat models", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
    });
    vi.mocked(getEnvProviderApiKey).mockReturnValue(null);
    vi.mocked(resolveProviderApiKey).mockImplementation(async ({ provider }) => {
      if (provider === "anthropic") return "sk-ant-test";
      if (provider === "openai") return "sk-proj-test";
      if (provider === "gemini") return "AIza-test";
      return null;
    });

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.anthropic.com/v1/models")) {
        expect(init?.headers).toMatchObject({ "x-api-key": "sk-ant-test" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "claude-sonnet-4-20250514",
                  display_name: "Claude Sonnet 4",
                  created_at: "2025-05-14T00:00:00Z",
                },
              ],
            }),
            { status: 200 }
          )
        );
      }

      if (url === "https://api.openai.com/v1/models") {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-proj-test" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                { id: "gpt-4.1", created: 1744000000 },
                { id: "whisper-1", created: 1700000000 },
                { id: "gpt-4o-realtime-preview", created: 1740000000 },
              ],
            }),
            { status: 200 }
          )
        );
      }

      if (url.startsWith("https://generativelanguage.googleapis.com/v1beta/models")) {
        expect(init?.headers).toMatchObject({ "x-goog-api-key": "AIza-test" });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-2.5-flash",
                  displayName: "Gemini 2.5 Flash",
                  inputTokenLimit: 1048576,
                  supportedGenerationMethods: ["generateContent", "countTokens"],
                },
                {
                  name: "models/text-embedding-004",
                  displayName: "Embedding 004",
                  supportedGenerationMethods: ["embedContent"],
                },
              ],
            }),
            { status: 200 }
          )
        );
      }

      if (url === "https://openrouter.ai/api/v1/models") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "openrouter/free",
                  name: "Free Models Router",
                  architecture: { output_modalities: ["text"] },
                  pricing: { prompt: "0", completion: "0" },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new NextRequest("http://localhost:3000/api/ai/models"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.configuredProviders).toEqual(["anthropic", "openai", "gemini"]);
    expect(body.sources).toEqual({
      openrouter: "live",
      anthropic: "live",
      openai: "live",
      gemini: "live",
    });
    expect(body.providerModels.anthropic.map((m: { id: string }) => m.id)).toEqual([
      "claude-sonnet-4-20250514",
    ]);
    expect(body.providerModels.openai.map((m: { id: string }) => m.id)).toEqual(["gpt-4.1"]);
    expect(body.providerModels.gemini.map((m: { id: string }) => m.id)).toEqual([
      "gemini-2.5-flash",
    ]);
  });

  it("leaves unconfigured direct providers empty instead of returning hardcoded models", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
    });
    vi.mocked(getEnvProviderApiKey).mockReturnValue(null);
    vi.mocked(resolveProviderApiKey).mockImplementation(async ({ provider }) => {
      if (provider === "openrouter") return "sk-or-v1-zero";
      return null;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/api/v1/key")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ data: { limit: 0, limit_remaining: 0, is_free_tier: false } }),
              { status: 200 }
            )
          );
        }
        if (url.endsWith("/api/v1/models/user")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: "openrouter/free",
                    name: "Free Models Router",
                    architecture: { output_modalities: ["text"] },
                    pricing: { prompt: "0", completion: "0" },
                  },
                ],
              }),
              { status: 200 }
            )
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const res = await GET(new NextRequest("http://localhost:3000/api/ai/models"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.configuredProviders).toEqual(["openrouter"]);
    expect(body.providerModels.anthropic).toEqual([]);
    expect(body.providerModels.openai).toEqual([]);
    expect(body.providerModels.gemini).toEqual([]);
    expect(body.providerModels.openrouter.map((m: { id: string }) => m.id)).toEqual([
      "openrouter/free",
    ]);
  });
});

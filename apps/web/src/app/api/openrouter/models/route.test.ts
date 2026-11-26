import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateOpenRouterModelsCache } from "@/lib/openrouter-cache";

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

describe("/api/openrouter/models route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateOpenRouterModelsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches key-scoped live free models only when the OpenRouter key has a $0 budget", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
    });
    vi.mocked(resolveProviderApiKey).mockResolvedValue("sk-or-v1-zero-budget");

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer sk-or-v1-zero-budget",
      });

      if (url.endsWith("/api/v1/key")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                limit: 0,
                limit_remaining: 0,
                is_free_tier: false,
                effective_budget: { limit_usd: 0, remaining_usd: 0 },
              },
            }),
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
                  id: "google/gemma-4-31b-it:free",
                  name: "Google Gemma 4 31B",
                  context_length: 131072,
                  architecture: { output_modalities: ["text"] },
                  pricing: { prompt: "0", completion: "0" },
                },
                {
                  id: "openrouter/free",
                  name: "Free Models Router",
                  context_length: 200000,
                  architecture: { output_modalities: ["text"] },
                  pricing: { prompt: "0", completion: "0" },
                },
                {
                  id: "anthropic/claude-sonnet-4",
                  name: "Claude Sonnet 4",
                  context_length: 200000,
                  architecture: { output_modalities: ["text"] },
                  pricing: { prompt: "0.000003", completion: "0.000015" },
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

    const res = await GET(new NextRequest("http://localhost:3000/api/openrouter/models"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("live");
    expect(body.keyBudget).toEqual({
      hasKey: true,
      freeOnly: true,
      limitUsd: 0,
      remainingUsd: 0,
      isFreeTier: false,
    });
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "openrouter/free",
      "google/gemma-4-31b-it:free",
    ]);
    // Must not inject stale hardcoded default models
    expect(
      body.models.some((m: { id: string }) => m.id === "qwen/qwen-2.5-coder-32b-instruct:free")
    ).toBe(false);
  });

  it("includes both live free and paid models when the OpenRouter key has positive budget", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
    });
    vi.mocked(resolveProviderApiKey).mockResolvedValue("sk-or-v1-funded-key");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/api/v1/key")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                limit: 25,
                limit_remaining: 20,
                is_free_tier: false,
                effective_budget: { limit_usd: 25, remaining_usd: 20 },
              },
            }),
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
                {
                  id: "anthropic/claude-sonnet-4",
                  name: "Claude Sonnet 4",
                  architecture: { output_modalities: ["text"] },
                  pricing: { prompt: "0.000003", completion: "0.000015" },
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

    const res = await GET(new NextRequest("http://localhost:3000/api/openrouter/models"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.keyBudget.freeOnly).toBe(false);
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "openrouter/free",
      "anthropic/claude-sonnet-4",
    ]);
  });

  it("fetches public live catalog when no OpenRouter key is configured", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
    });
    vi.mocked(resolveProviderApiKey).mockResolvedValue(null);
    vi.mocked(getEnvProviderApiKey).mockReturnValue(null);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "google/gemma-4-26b-a4b-it:free",
              name: "Google Gemma 4 26B",
              architecture: { output_modalities: ["text"] },
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(new NextRequest("http://localhost:3000/api/openrouter/models"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keyBudget.hasKey).toBe(false);
    expect(body.models.map((m: { id: string }) => m.id)).toEqual([
      "google/gemma-4-26b-a4b-it:free",
    ]);
  });
});

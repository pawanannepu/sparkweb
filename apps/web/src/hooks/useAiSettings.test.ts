import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSettings } from "./useAiSettings";

describe("useAiSettings hook", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-selects a live working model from the user's configured provider instead of defaulting to an unconfigured one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url === "/api/keys") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                keys: [
                  {
                    provider: "gemini",
                    keyHint: "AIza...9999",
                    updatedAt: "2026-11-26T00:00:00.000Z",
                  },
                ],
                envProviders: [],
              }),
              { status: 200 }
            )
          );
        }

        if (url.startsWith("/api/ai/models")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                configuredProviders: ["gemini"],
                openRouterKeyBudget: {
                  hasKey: false,
                  freeOnly: false,
                  limitUsd: null,
                  remainingUsd: null,
                  isFreeTier: null,
                },
                providerModels: {
                  openrouter: [],
                  anthropic: [],
                  openai: [],
                  gemini: [
                    {
                      id: "gemini-2.5-flash",
                      name: "Gemini 2.5 Flash",
                      provider: "gemini",
                      tier: "paid",
                    },
                  ],
                },
              }),
              { status: 200 }
            )
          );
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
      })
    );

    const { result } = renderHook(() => useAiSettings());

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gemini-2.5-flash");
      expect(result.current.selectedProvider).toBe("gemini");
    });
  });

  it("refreshes live models and switches to the newly saved provider model", async () => {
    let savedOpenAi = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "/api/keys" && init?.method === "POST") {
          savedOpenAi = true;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                provider: "openai",
                keyHint: "sk-p...1234",
                updatedAt: "2026-11-26T00:00:00.000Z",
              }),
              { status: 200 }
            )
          );
        }

        if (url === "/api/keys") {
          return Promise.resolve(
            new Response(JSON.stringify({ keys: [], envProviders: [] }), { status: 200 })
          );
        }

        if (url.startsWith("/api/ai/models")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                configuredProviders: savedOpenAi ? ["openai"] : [],
                openRouterKeyBudget: {
                  hasKey: false,
                  freeOnly: false,
                  limitUsd: null,
                  remainingUsd: null,
                  isFreeTier: null,
                },
                providerModels: {
                  openrouter: [],
                  anthropic: [],
                  openai: savedOpenAi
                    ? [
                        {
                          id: "gpt-4.1",
                          name: "gpt-4.1",
                          provider: "openai",
                          tier: "paid",
                        },
                      ]
                    : [],
                  gemini: [],
                },
              }),
              { status: 200 }
            )
          );
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
      })
    );

    const { result } = renderHook(() => useAiSettings());

    await waitFor(() => {
      expect(result.current.isLoadingModels).toBe(false);
    });

    await act(async () => {
      await result.current.saveApiKey("openai", "sk-proj-test-key-1234");
    });

    expect(result.current.selectedModel).toBe("gpt-4.1");
    expect(result.current.selectedProvider).toBe("openai");
    expect(result.current.directModels.map((m) => m.id)).toEqual(["gpt-4.1"]);
  });
});

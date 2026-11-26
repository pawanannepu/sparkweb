import { describe, expect, it } from "vitest";
import {
  formatAnthropicModel,
  formatGeminiModel,
  formatOpenAiModel,
  formatOpenRouterModel,
  isGeminiTextModel,
  isOpenAiChatModel,
  isOpenRouterModelId,
  resolveModelProvider,
} from "./ai-models";

describe("ai-models shared helpers", () => {
  it("resolves direct model IDs and live provider model families to their native providers", () => {
    expect(resolveModelProvider("claude-3-7-sonnet")).toBe("anthropic");
    expect(resolveModelProvider("claude-sonnet-4-20250514")).toBe("anthropic");
    expect(resolveModelProvider("gpt-4o")).toBe("openai");
    expect(resolveModelProvider("gpt-4.1-mini")).toBe("openai");
    expect(resolveModelProvider("o4-mini")).toBe("openai");
    expect(resolveModelProvider("gemini-2.0-flash")).toBe("gemini");
    expect(resolveModelProvider("gemini-2.5-pro")).toBe("gemini");
  });

  it("resolves slash-namespaced and :free model IDs to openrouter", () => {
    expect(resolveModelProvider("anthropic/claude-sonnet-4")).toBe("openrouter");
    expect(resolveModelProvider("deepseek/deepseek-chat-v3-0324:free")).toBe("openrouter");
    expect(resolveModelProvider("custom-model:free")).toBe("openrouter");
    expect(isOpenRouterModelId("openai/gpt-4o")).toBe(true);
    expect(isOpenRouterModelId("claude-3-7-sonnet")).toBe(false);
  });

  it("respects explicit provider override", () => {
    expect(resolveModelProvider("gpt-4o", "openrouter")).toBe("openrouter");
  });

  it("classifies free and paid OpenRouter models from pricing and suffix", () => {
    const freeByPricing = formatOpenRouterModel({
      id: "google/gemini-2.0-flash-exp:free",
      name: "Gemini 2.0 Flash Exp",
      context_length: 1000000,
      pricing: { prompt: "0", completion: "0" },
    });
    expect(freeByPricing.tier).toBe("free");
    expect(freeByPricing.pricingLabel).toBe("Free");

    const paidModel = formatOpenRouterModel({
      id: "anthropic/claude-sonnet-4",
      name: "Claude Sonnet 4",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
    });
    expect(paidModel.tier).toBe("paid");
    expect(paidModel.pricingLabel).toBe("$3/1M in · $15/1M out");
  });

  it("filters and formats live Anthropic, OpenAI, and Gemini models", () => {
    expect(
      formatAnthropicModel({
        id: "claude-sonnet-4-20250514",
        display_name: "Claude Sonnet 4",
      })
    ).toMatchObject({
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      provider: "anthropic",
    });

    expect(isOpenAiChatModel({ id: "gpt-4.1" })).toBe(true);
    expect(isOpenAiChatModel({ id: "o3-mini" })).toBe(true);
    expect(isOpenAiChatModel({ id: "whisper-1" })).toBe(false);
    expect(isOpenAiChatModel({ id: "gpt-4o-realtime-preview" })).toBe(false);
    expect(formatOpenAiModel({ id: "gpt-4.1" })).toMatchObject({
      id: "gpt-4.1",
      provider: "openai",
    });

    expect(
      isGeminiTextModel({
        name: "models/gemini-2.5-flash",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      })
    ).toBe(true);
    expect(
      isGeminiTextModel({
        name: "models/text-embedding-004",
        supportedGenerationMethods: ["embedContent"],
      })
    ).toBe(false);
    expect(
      formatGeminiModel({
        name: "models/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        inputTokenLimit: 1048576,
      })
    ).toMatchObject({
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "gemini",
      contextLength: 1048576,
    });
  });
});

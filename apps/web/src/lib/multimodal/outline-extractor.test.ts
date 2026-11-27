// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  createAiLanguageModel: vi.fn().mockReturnValue({ modelId: "mock-model" }),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("@/lib/ai-provider", () => ({
  createAiLanguageModel: mocks.createAiLanguageModel,
}));

import { DesignOutlinePayloadSchema } from "@spark/shared";
import { extractDesignOutline } from "./outline-extractor";

describe("outline-extractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-6
  it("builds a deterministic schema valid outline in mock mode seeded with URL tokens and images", async () => {
    const result = await extractDesignOutline({
      provider: "anthropic",
      modelId: "claude-3-7-sonnet",
      apiKey: null,
      isMockMode: true,
      promptText: "Create a SaaS landing page",
      images: [{ fileName: "shot.png", mimeType: "image/png", buffer: Buffer.from("png") }],
      urlSnapshot: {
        title: "Linear",
        headings: ["Plan", "Build", "Ship"],
        colors: ["#5E6AD2", "#26B5CE"],
        fonts: ["Inter", "JetBrains Mono"],
        landmarkCount: 4,
      },
    });

    expect(DesignOutlinePayloadSchema.safeParse(result).success).toBe(true);
    expect(result.appSummary).toContain("Create a SaaS landing page");
    expect(result.appSummary).toContain("Linear");
    expect(result.palette[0]?.hex).toBe("#5E6AD2");
    expect(result.typography.headingFont).toBe("Inter");
    expect(result.layoutSections[0]?.name).toBe("Plan");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  // covers: AC-5, AC-6
  it("sends multimodal parts and untrusted XML wrapper to generateText and parses fenced JSON", async () => {
    const validPayload = {
      appSummary: "Extracted fintech dashboard",
      palette: [{ id: "pal-1", role: "Primary", hex: "#2563EB", usage: "Buttons" }],
      typography: {
        headingFont: "Plus Jakarta Sans",
        bodyFont: "Inter",
        scaleNotes: "Tight display",
      },
      layoutSections: [{ id: "sec-1", name: "Header", description: "Nav", enabled: true }],
      componentHierarchy: [{ id: "comp-1", name: "AppShell", role: "Shell", enabled: true }],
      additionalNotes: "Use crisp borders",
    };

    mocks.generateText.mockResolvedValueOnce({
      text: `Here is the outline:\n\`\`\`json\n${JSON.stringify(validPayload)}\n\`\`\``,
    });

    const imageBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const outline = await extractDesignOutline({
      provider: "openai",
      modelId: "gpt-4o",
      apiKey: "sk-test",
      isMockMode: false,
      promptText: "Match this screenshot",
      images: [{ fileName: "ui.png", mimeType: "image/png", buffer: imageBuf }],
      sanitizedUrlContextXml:
        '<untrusted-website-reference url="https://example.com/"></untrusted-website-reference>',
    });

    expect(outline).toEqual(validPayload);
    expect(mocks.createAiLanguageModel).toHaveBeenCalledWith("openai", "gpt-4o", "sk-test");
    const callArg = mocks.generateText.mock.calls[0]?.[0];
    expect(callArg.messages[0].content).toHaveLength(2);
    expect(callArg.messages[0].content[0].text).toContain("<untrusted-website-reference");
    expect(callArg.messages[0].content[1]).toMatchObject({
      type: "image",
      image: imageBuf,
      mediaType: "image/png",
    });
  });

  // covers: AC-6
  it("throws when model output is not valid JSON or fails DesignOutlinePayloadSchema", async () => {
    mocks.generateText.mockResolvedValueOnce({ text: "Not JSON at all" });

    await expect(
      extractDesignOutline({
        provider: "anthropic",
        modelId: "claude-3-7-sonnet",
        apiKey: "sk-ant-test",
        isMockMode: false,
        promptText: "Build app",
        images: [],
      })
    ).rejects.toThrow("Model did not return valid JSON");

    mocks.generateText.mockResolvedValueOnce({
      text: JSON.stringify({ appSummary: "Missing fields" }),
    });

    await expect(
      extractDesignOutline({
        provider: "anthropic",
        modelId: "claude-3-7-sonnet",
        apiKey: "sk-ant-test",
        isMockMode: false,
        promptText: "Build app",
        images: [],
      })
    ).rejects.toThrow("Model returned an invalid design outline structure");
  });
});

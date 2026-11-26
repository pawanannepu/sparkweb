import { describe, expect, it } from "vitest";
import { createAiLanguageModel, parseGeneratedFilesPayload } from "./ai-provider";

describe("ai-provider helpers", () => {
  it("parses direct JSON payload with files", () => {
    const raw = JSON.stringify({
      summary: "Built app",
      files: [{ path: "src/App.tsx", content: "export default function App() { return null; }" }],
    });

    const parsed = parseGeneratedFilesPayload(raw);
    expect(parsed?.summary).toBe("Built app");
    expect(parsed?.files).toEqual([
      { path: "src/App.tsx", content: "export default function App() { return null; }" },
    ]);
  });

  it("parses fenced JSON inside prose and rejects path traversal", () => {
    const raw = `Here is the generated code:
\`\`\`json
{
  "summary": "Updated view",
  "files": [
    { "path": "./src/App.tsx", "content": "const x = 1;" },
    { "path": "../secrets.txt", "content": "bad" }
  ]
}
\`\`\``;

    const parsed = parseGeneratedFilesPayload(raw);
    expect(parsed?.files).toEqual([{ path: "src/App.tsx", content: "const x = 1;" }]);
  });

  it("creates an OpenRouter language model using OpenAI-compatible chat endpoint", () => {
    const model = createAiLanguageModel(
      "openrouter",
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "sk-or-v1-test"
    );
    expect(model).toBeDefined();
    expect(typeof model).toBe("object");
    expect((model as { modelId?: string }).modelId).toBe("qwen/qwen-2.5-coder-32b-instruct:free");
  });
});

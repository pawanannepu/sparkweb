import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSiblingImports, useGenerationLoop } from "./useGenerationLoop";

describe("useGenerationLoop Hook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with idle streaming state and empty telemetry", () => {
    const { result } = renderHook(() => useGenerationLoop({ projectId: "proj_123" }));

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.planSteps).toEqual([]);
    expect(result.current.fileOperations).toEqual([]);
    expect(result.current.healingTelemetry.status).toBe("none");
    expect(result.current.error).toBeNull();
  });

  it("resolves sibling import files accurately", () => {
    const sourceContent = `import React from 'react';
import { Button } from './Button';
import Card from './components/Card';
export default function App() {}`;

    const allFiles = {
      "src/Button.tsx": "export const Button = () => null;",
      "src/components/Card.tsx": "export default () => null;",
      "src/other.ts": "export const x = 1;",
    };

    const siblings = resolveSiblingImports("src/App.tsx", sourceContent, allFiles);
    expect(siblings).toHaveLength(2);
    expect(siblings.map((s) => s.path)).toContain("src/Button.tsx");
    expect(siblings.map((s) => s.path)).toContain("src/components/Card.tsx");
  });

  it("handles prompt submission, verifies preview health, and commits snapshot", async () => {
    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_123","steps":[{"id":"step-1","title":"Plan","status":"completed"},{"id":"step-2","title":"Code","status":"completed"},{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() {}"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_123"}\n\n'));
        controller.close();
      },
    });

    const mockGenerateResponse = {
      ok: true,
      body: generateStream,
    };

    const mockSnapshotResponse = {
      ok: true,
      json: async () => ({ id: "snap_123", treeHash: "hash_abc" }),
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockGenerateResponse as unknown as Response)
      .mockResolvedValueOnce(mockSnapshotResponse as unknown as Response);

    const onFileChange = vi.fn();
    const onFinish = vi.fn();
    const requestHealthCheck = vi.fn().mockResolvedValue({ healthy: true });

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onFileChange,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.submitPrompt("Build a counter app");
    });

    expect(result.current.isStreaming).toBe(false);
    expect(onFileChange).toHaveBeenCalledWith({
      path: "src/App.tsx",
      content: "export default function App() {}",
    });
    expect(requestHealthCheck).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalledWith("snap_123", "hash_abc");
  });

  // covers: AC-1, AC-6
  it("stops self healing loop immediately when duplicate error fingerprint is detected", async () => {
    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_123","steps":[{"id":"step-1","title":"Plan","status":"completed"},{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <broken>"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_123"}\n\n'));
        controller.close();
      },
    });

    const repairStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <broken>"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('event: finish\ndata: {"patchFiles":["src/App.tsx"]}\n\n')
        );
        controller.close();
      },
    });

    // 1st fetch: generate
    // 2nd fetch: repair attempt 1
    // 3rd fetch: snapshot commit marked exhausted
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: generateStream } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, body: repairStream } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "snap_exhausted", treeHash: "hash_exhausted" }),
      } as unknown as Response);

    // Both health checks return the same syntax error (with line number shift)
    const requestHealthCheck = vi
      .fn()
      .mockResolvedValueOnce({
        healthy: false,
        error: {
          category: "syntax",
          message: "src/App.tsx:10:2: error: Unexpected token",
          filename: "src/App.tsx",
        },
      })
      .mockResolvedValueOnce({
        healthy: false,
        error: {
          category: "syntax",
          message: "src/App.tsx:18:2: error: Unexpected token", // Shifted line number produces identical fingerprint
          filename: "src/App.tsx",
        },
      });

    const onError = vi.fn();
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onError,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.submitPrompt("Build broken component");
    });

    expect(result.current.healingTelemetry.status).toBe("exhausted");
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate error fingerprint detected")
    );
    expect(onFinish).toHaveBeenCalledWith("snap_exhausted", "hash_exhausted");
  });

  it("cancels active generation stream cleanly", async () => {
    let _streamController: ReadableStreamDefaultController | null = null;
    const stream = new ReadableStream({
      start(controller) {
        _streamController = controller;
      },
    });

    const mockResponse = {
      ok: true,
      body: stream,
    };

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as unknown as Response);

    const { result } = renderHook(() => useGenerationLoop({ projectId: "proj_123" }));

    act(() => {
      result.current.submitPrompt("Build a dashboard");
    });

    expect(result.current.isStreaming).toBe(true);

    act(() => {
      result.current.cancelGeneration();
    });

    expect(result.current.isStreaming).toBe(false);
  });

  // covers: AC-8
  it("triggerRepair omits unpersisted messageId and captures server created messageId", async () => {
    const encoder = new TextEncoder();
    const repairStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: healing_status\ndata: {"status":"patching","messageId":"db-repair-msg-1"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <div>Fixed</div>; }"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: finish\ndata: {"messageId":"db-repair-msg-1","patchFiles":["src/App.tsx"]}\n\n'
          )
        );
        controller.close();
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: repairStream } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "snap_repaired", treeHash: "hash_repaired" }),
      } as unknown as Response);

    const requestHealthCheck = vi.fn().mockResolvedValue({ healthy: true });
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.triggerRepair({
        category: "syntax",
        message: "Unexpected token",
        filename: "src/App.tsx",
      });
    });

    const repairCall = vi.mocked(fetch).mock.calls[0];
    expect(repairCall?.[0]).toBe("/api/projects/proj_123/repair");
    const repairBody = JSON.parse((repairCall?.[1]?.body as string) || "{}");
    expect(repairBody.messageId).toBeUndefined();

    const snapCall = vi.mocked(fetch).mock.calls[1];
    expect(snapCall?.[0]).toBe("/api/projects/proj_123/snapshots");
    const snapBody = JSON.parse((snapCall?.[1]?.body as string) || "{}");
    expect(snapBody.messageId).toBe("db-repair-msg-1");
    expect(onFinish).toHaveBeenCalledWith("snap_repaired", "hash_repaired");
  });

  // covers: Key Invariant (cancellation during self-healing loop)
  it("aborts active self healing verification loop when cancelGeneration is called", async () => {
    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_123","steps":[{"id":"step-1","title":"Plan","status":"completed"},{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"broken"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_123"}\n\n'));
        controller.close();
      },
    });

    let resolveRepairPromise: ((val: Response) => void) | null = null;
    let capturedSignal: AbortSignal | undefined;

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: generateStream } as unknown as Response)
      .mockImplementationOnce((_url, init) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          resolveRepairPromise = resolve;
        });
      });

    const requestHealthCheck = vi.fn().mockResolvedValue({
      healthy: false,
      error: {
        category: "syntax",
        message: "Unexpected token",
        filename: "src/App.tsx",
      },
    });
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onFinish,
      })
    );

    let submitPromise: Promise<void> | undefined;
    act(() => {
      submitPromise = result.current.submitPrompt("Build app");
    });

    // Wait for repair fetch to be initiated
    await vi.waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    act(() => {
      result.current.cancelGeneration();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);

    // Resolve the pending fetch if cancellation didn't reject it directly
    await act(async () => {
      resolveRepairPromise?.({
        ok: true,
        body: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      } as unknown as Response);
      await submitPromise;
    });

    // Must not commit a snapshot after cancellation
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(onFinish).not.toHaveBeenCalled();
  });

  // covers: AC-3, AC-4, AC-7
  it("recovers from failing preview via targeted repair with sibling imports and commits healed snapshot", async () => {
    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_heal","steps":[{"id":"step-1","title":"Plan","status":"completed"},{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/Button.tsx","op":"write","content":"export const Button = () => null;"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"import { Missing } from \'./Button\';\\nexport default function App() { return <Missing />; }"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_heal"}\n\n'));
        controller.close();
      },
    });

    const repairStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/Button.tsx","op":"write","content":"export const Missing = () => null;"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: finish\ndata: {"messageId":"msg_heal","patchFiles":["src/Button.tsx"]}\n\n'
          )
        );
        controller.close();
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: generateStream } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, body: repairStream } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "snap_healed", treeHash: "hash_healed" }),
      } as unknown as Response);

    const requestHealthCheck = vi
      .fn()
      .mockResolvedValueOnce({
        healthy: false,
        error: {
          category: "import",
          message: "The requested module './Button' does not provide an export named 'Missing'",
          filename: "src/App.tsx",
        },
      })
      .mockResolvedValueOnce({ healthy: true });

    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.submitPrompt("Build button app");
    });

    expect(result.current.healingTelemetry.status).toBe("healed");
    expect(result.current.healingTelemetry.totalRepairs).toBe(1);
    expect(result.current.healingTelemetry.attempts[0]?.patchFiles).toContain("src/Button.tsx");

    const repairBody = JSON.parse((vi.mocked(fetch).mock.calls[1]?.[1]?.body as string) || "{}");
    expect(repairBody.importedSiblingFiles).toEqual([
      {
        path: "src/Button.tsx",
        content: "export const Button = () => null;",
      },
    ]);

    const snapBody = JSON.parse((vi.mocked(fetch).mock.calls[2]?.[1]?.body as string) || "{}");
    expect(snapBody.status).toBe("healed");
    expect(onFinish).toHaveBeenCalledWith("snap_healed", "hash_healed");
  });

  // covers: AC-6, AC-7
  it("halts at three distinct failed repair attempts and commits an exhausted snapshot", async () => {
    const encoder = new TextEncoder();
    const makeRepairStream = (n: number) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"attempt ${n}"}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              'event: finish\ndata: {"messageId":"msg_max","patchFiles":["src/App.tsx"]}\n\n'
            )
          );
          controller.close();
        },
      });

    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_max","steps":[{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"broken"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_max"}\n\n'));
        controller.close();
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: generateStream } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, body: makeRepairStream(1) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, body: makeRepairStream(2) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, body: makeRepairStream(3) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "snap_ex_3", treeHash: "hash_ex_3" }),
      } as unknown as Response);

    const requestHealthCheck = vi
      .fn()
      .mockResolvedValueOnce({
        healthy: false,
        error: { category: "syntax", message: "Error one", filename: "src/App.tsx" },
      })
      .mockResolvedValueOnce({
        healthy: false,
        error: { category: "import", message: "Error two", filename: "src/App.tsx" },
      })
      .mockResolvedValueOnce({
        healthy: false,
        error: { category: "runtime", message: "Error three", filename: "src/App.tsx" },
      })
      .mockResolvedValueOnce({
        healthy: false,
        error: { category: "compiler", message: "Error four", filename: "src/App.tsx" },
      });

    const onError = vi.fn();
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onError,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.submitPrompt("Build app");
    });

    expect(result.current.healingTelemetry.status).toBe("exhausted");
    expect(result.current.healingTelemetry.totalRepairs).toBe(3);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Maximum three repair attempts"));
    expect(onFinish).toHaveBeenCalledWith("snap_ex_3", "hash_ex_3");

    const snapBody = JSON.parse((vi.mocked(fetch).mock.calls[4]?.[1]?.body as string) || "{}");
    expect(snapBody.status).toBe("exhausted");
  });

  // covers: AC-3
  it("reports error and clears streaming state when repair endpoint returns non ok status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
    } as unknown as Response);

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        onError,
      })
    );

    await act(async () => {
      await result.current.triggerRepair({
        category: "runtime",
        message: "Uncaught error",
        filename: "src/App.tsx",
      });
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toContain("429");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("429"));
  });

  it("ignores external packages and resolves index barrel files in resolveSiblingImports", () => {
    const sourceContent = `import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from './ui';`;

    const allFiles = {
      "src/ui/index.tsx": "export const Card = () => null;",
    };

    const siblings = resolveSiblingImports("src/App.tsx", sourceContent, allFiles);
    expect(siblings).toEqual([
      { path: "src/ui/index.tsx", content: "export const Card = () => null;" },
    ]);
  });

  // covers: AC-3, AC-7
  it("extracts design outline, handles structured extraction error, and clears error state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        error: "Empty JS shell",
        code: "URL_JS_SHELL",
        suggestion: "Paste a screenshot instead.",
      }),
    } as unknown as Response);

    const onProviderKeyMissing = vi.fn();
    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        threadId: "thread_123",
        onProviderKeyMissing,
      })
    );

    let outlineTurn: unknown;
    await act(async () => {
      outlineTurn = await result.current.extractOutline({
        prompt: "",
        model: "claude-3-7-sonnet",
        attachmentIds: [],
        sourceUrl: "https://spa.example.com",
      });
    });

    expect(outlineTurn).toBeNull();
    expect(result.current.isExtractingOutline).toBe(false);
    expect(result.current.extractionError).toEqual({
      message: "Empty JS shell",
      code: "URL_JS_SHELL",
      suggestion: "Paste a screenshot instead.",
    });

    act(() => {
      result.current.clearExtractionError();
    });
    expect(result.current.extractionError).toBeNull();

    // PROVIDER_KEY_MISSING triggers callback
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: "PROVIDER_KEY_MISSING",
        provider: "openai",
        message: "Missing key",
      }),
    } as unknown as Response);

    await act(async () => {
      await result.current.extractOutline({
        prompt: "Design app",
        model: "gpt-4o",
        attachmentIds: ["att-1"],
      });
    });
    expect(onProviderKeyMissing).toHaveBeenCalledWith("openai");

    // Successful extraction
    const mockTurn = {
      outline: { id: "out-1", status: "ready" },
      userMessage: { id: "u-1" },
      outlineMessage: { id: "a-1" },
      attachments: [],
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockTurn,
    } as unknown as Response);

    await act(async () => {
      outlineTurn = await result.current.extractOutline({
        prompt: "Design app",
        model: "gpt-4o",
        attachmentIds: ["att-1"],
        visionOverride: true,
      });
    });
    expect(outlineTurn).toEqual(mockTurn);
  });

  // covers: AC-9
  it("submits Stage 2 build from confirmed outline and commits verified snapshot", async () => {
    const encoder = new TextEncoder();
    const generateStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"messageId":"msg_build_1","steps":[{"id":"step-3","title":"Verify","status":"pending"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() { return <h1>Outline App</h1>; }"}\n\n'
          )
        );
        controller.enqueue(encoder.encode('event: finish\ndata: {"messageId":"msg_build_1"}\n\n'));
        controller.close();
      },
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, body: generateStream } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "snap_outline_1", treeHash: "hash_outline_1" }),
      } as unknown as Response);

    const requestHealthCheck = vi.fn().mockResolvedValue({ healthy: true });
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        requestHealthCheck,
        onFinish,
      })
    );

    const editedOutline = {
      appSummary: "Edited App",
      palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "CTA" }],
      typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
      layoutSections: [{ id: "s1", name: "Header", description: "Top", enabled: true }],
      componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root", enabled: true }],
      additionalNotes: "",
    };

    let ok = false;
    await act(async () => {
      ok = await result.current.submitBuildFromOutline({
        outlineId: "out-123",
        editedOutline,
        model: "claude-3-7-sonnet",
        promptSummary: "Edited App",
      });
    });

    expect(ok).toBe(true);
    const generateCall = vi.mocked(fetch).mock.calls[0];
    expect(generateCall?.[0]).toBe("/api/projects/proj_123/generate");
    expect(JSON.parse((generateCall?.[1]?.body as string) || "{}")).toEqual({
      outlineId: "out-123",
      editedOutline,
      model: "claude-3-7-sonnet",
      provider: "anthropic",
    });
    expect(onFinish).toHaveBeenCalledWith("snap_outline_1", "hash_outline_1");
  });
});

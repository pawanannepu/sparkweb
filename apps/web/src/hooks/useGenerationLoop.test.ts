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
});

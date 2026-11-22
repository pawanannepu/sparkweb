import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenerationLoop } from "./useGenerationLoop";

describe("useGenerationLoop Hook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with idle streaming state", () => {
    const { result } = renderHook(() => useGenerationLoop({ projectId: "proj_123" }));

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.planSteps).toEqual([]);
    expect(result.current.fileOperations).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("handles prompt submission and parses SSE stream chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: plan\ndata: {"steps":[{"id":"1","title":"Plan task","status":"completed"}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'event: file_op\ndata: {"path":"src/App.tsx","op":"write","content":"export default function App() {}"}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode('event: finish\ndata: {"snapshotId":"snap_123","treeHash":"hash_abc"}\n\n')
        );
        controller.close();
      },
    });

    const mockResponse = {
      ok: true,
      body: stream,
    };

    vi.mocked(fetch).mockResolvedValueOnce(mockResponse as unknown as Response);

    const onFileChange = vi.fn();
    const onFinish = vi.fn();

    const { result } = renderHook(() =>
      useGenerationLoop({
        projectId: "proj_123",
        onFileChange,
        onFinish,
      })
    );

    await act(async () => {
      await result.current.submitPrompt("Build a counter app");
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.planSteps).toHaveLength(1);
    expect(result.current.fileOperations).toHaveLength(1);
    expect(onFileChange).toHaveBeenCalledWith({
      path: "src/App.tsx",
      content: "export default function App() {}",
    });
    expect(onFinish).toHaveBeenCalledWith("snap_123", "hash_abc");
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

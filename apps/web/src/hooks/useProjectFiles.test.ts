import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectFiles } from "./useProjectFiles";

describe("useProjectFiles Hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleAppCode = `import React from "react";
export default function App() {
  return (
    <div className="p-4 bg-slate-900 text-white">
      <h1 className="text-xl font-bold">Hello Spark</h1>
    </div>
  );
}`;

  it("initializes with provided files and state", () => {
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
      })
    );

    expect(result.current.files["src/App.tsx"]?.content).toBe(sampleAppCode);
    expect(result.current.isInspectMode).toBe(false);
    expect(result.current.selectedElement).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("toggles inspect mode and transmits bridge message", () => {
    const onSendBridge = vi.fn();
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        onSendBridgeMessage: onSendBridge,
      })
    );

    act(() => {
      result.current.setIsInspectMode(true);
    });

    expect(result.current.isInspectMode).toBe(true);
    expect(onSendBridge).toHaveBeenCalledWith("PREVIEW_INSPECT_MODE", { enabled: true });

    act(() => {
      result.current.setIsInspectMode(false);
    });

    expect(result.current.isInspectMode).toBe(false);
    expect(onSendBridge).toHaveBeenCalledWith("PREVIEW_INSPECT_MODE", { enabled: false });
  });

  it("locks inspector and cancels inspect mode during active streaming", () => {
    const onSendBridge = vi.fn();
    const { result, rerender } = renderHook(
      ({ isStreaming }) =>
        useProjectFiles({
          projectId: "test-proj",
          isStreaming,
          onSendBridgeMessage: onSendBridge,
        }),
      { initialProps: { isStreaming: false } }
    );

    act(() => {
      result.current.setIsInspectMode(true);
    });
    expect(result.current.isInspectMode).toBe(true);

    // AI stream starts
    rerender({ isStreaming: true });

    expect(result.current.isInspectMode).toBe(false);
    expect(result.current.selectedElement).toBeNull();
    expect(onSendBridge).toHaveBeenCalledWith("PREVIEW_INSPECT_MODE", { enabled: false });
  });

  it("applies style updates using AST modifier and debounces virtual filesystem writes", () => {
    const onWriteFiles = vi.fn();
    const onSendBridge = vi.fn();
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
        onWriteFiles,
        onSendBridgeMessage: onSendBridge,
      })
    );

    act(() => {
      result.current.setSelectedElement({
        selector: "[data-source-loc='src/App.tsx:4:5']",
        tagName: "div",
        source: { file: "src/App.tsx", line: 4, column: 5 },
        classes: ["p-4", "bg-slate-900", "text-white"],
        styles: {},
        textContent: "Hello Spark",
        rect: { top: 0, left: 0, width: 100, height: 100 },
        isEditable: true,
        isLeafTextOnly: false,
      });
    });

    let success = false;
    act(() => {
      success = result.current.applyStyleUpdate({
        newClasses: ["p-8", "bg-indigo-600"],
        instantStyles: { padding: "32px", backgroundColor: "rgb(79, 70, 229)" },
      });
    });

    expect(success).toBe(true);
    expect(onSendBridge).toHaveBeenCalledWith("PREVIEW_INJECT_STYLES", {
      selector: "[data-source-loc='src/App.tsx:4:5']",
      styles: { padding: "32px", backgroundColor: "rgb(79, 70, 229)" },
    });

    // Advance 300ms for debounced write
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onWriteFiles).toHaveBeenCalled();
    const writtenFiles = onWriteFiles.mock.calls[0][0];
    expect(writtenFiles[0].path).toBe("src/App.tsx");
    const content = writtenFiles[0].content;
    expect(content).toContain("p-8");
    expect(content).toContain("bg-indigo-600");
    expect(content).toContain("text-white");
    expect(content).not.toContain("p-4");
    expect(content).not.toContain("bg-slate-900");
  });

  it("rejects style updates on external non-workspace files (AC-7)", () => {
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "node_modules/some-pkg/index.js": { content: "module.exports = {}" } },
      })
    );

    act(() => {
      result.current.setSelectedElement({
        selector: "div",
        tagName: "div",
        source: { file: "node_modules/some-pkg/index.js", line: 1, column: 1 },
        classes: ["btn"],
        styles: {},
        textContent: "External",
        rect: { top: 0, left: 0, width: 50, height: 20 },
        isEditable: false,
        isLeafTextOnly: true,
      });
    });

    let success = true;
    act(() => {
      success = result.current.applyStyleUpdate({ newClasses: ["bg-red-500"] });
    });

    expect(success).toBe(false);
  });

  it("supports undo and redo transitions", () => {
    const onWriteFiles = vi.fn();
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
        onWriteFiles,
      })
    );

    act(() => {
      result.current.updateFileContent("src/App.tsx", "updated version 1");
    });
    expect(result.current.files["src/App.tsx"]?.content).toBe("updated version 1");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    // Undo
    act(() => {
      result.current.undo();
    });
    expect(result.current.files["src/App.tsx"]?.content).toBe(sampleAppCode);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // Redo
    act(() => {
      result.current.redo();
    });
    expect(result.current.files["src/App.tsx"]?.content).toBe("updated version 1");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  // covers: AC-6
  it("applies text update to static leaf text node and transmits bridge message", () => {
    const onSendBridge = vi.fn();
    const onWriteFiles = vi.fn();
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
        onWriteFiles,
        onSendBridgeMessage: onSendBridge,
      })
    );

    act(() => {
      result.current.setSelectedElement({
        selector: "[data-source-loc='src/App.tsx:5:7']",
        tagName: "h1",
        source: { file: "src/App.tsx", line: 5, column: 7 },
        classes: ["text-xl", "font-bold"],
        styles: {},
        textContent: "Hello Spark",
        rect: { top: 0, left: 0, width: 100, height: 24 },
        isEditable: true,
        isLeafTextOnly: true,
      });
    });

    let success = false;
    act(() => {
      success = result.current.applyTextUpdate("Sparkweb Live Canvas");
    });

    expect(success).toBe(true);
    expect(onSendBridge).toHaveBeenCalledWith("PREVIEW_UPDATE_TEXT", {
      selector: "[data-source-loc='src/App.tsx:5:7']",
      text: "Sparkweb Live Canvas",
    });

    // Advance 350ms for debounced write
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onWriteFiles).toHaveBeenCalled();
    const writtenFile = onWriteFiles.mock.calls[0][0][0];
    expect(writtenFile.path).toBe("src/App.tsx");
    expect(writtenFile.content).toContain("Sparkweb Live Canvas");
  });

  // covers: AC-8
  it("schedules auto save snapshot to PostgreSQL after three seconds of user inactivity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "snap-auto-001" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "auto-save-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
      })
    );

    act(() => {
      result.current.updateFileContent("src/App.tsx", "updated content for auto save");
    });

    expect(fetchMock).not.toHaveBeenCalled();

    // Advance by 3000ms
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/auto-save-proj/snapshots",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    vi.unstubAllGlobals();
  });

  // covers: AC-5
  it("coalesces multiple rapid style changes into a single debounced write", () => {
    const onWriteFiles = vi.fn();
    const { result } = renderHook(() =>
      useProjectFiles({
        projectId: "test-proj",
        initialFiles: { "src/App.tsx": { content: sampleAppCode } },
        onWriteFiles,
      })
    );

    act(() => {
      result.current.setSelectedElement({
        selector: "[data-source-loc='src/App.tsx:4:5']",
        tagName: "div",
        source: { file: "src/App.tsx", line: 4, column: 5 },
        classes: ["p-4", "bg-slate-900", "text-white"],
        styles: {},
        textContent: "Hello Spark",
        rect: { top: 0, left: 0, width: 100, height: 100 },
        isEditable: true,
        isLeafTextOnly: false,
      });
    });

    // Rapid edits within 100ms
    act(() => {
      result.current.applyStyleUpdate({ newClasses: ["p-6"] });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.applyStyleUpdate({ newClasses: ["p-8"] });
    });
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.applyStyleUpdate({ newClasses: ["p-10", "bg-indigo-600"] });
    });

    expect(onWriteFiles).not.toHaveBeenCalled();

    // Advance past remaining debounce time
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onWriteFiles).toHaveBeenCalledTimes(1);
    const finalContent = onWriteFiles.mock.calls[0][0][0].content;
    expect(finalContent).toContain("p-10");
    expect(finalContent).toContain("bg-indigo-600");
  });
});

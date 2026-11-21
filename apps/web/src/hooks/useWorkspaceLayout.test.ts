import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUT_STATE,
  normalizeLayoutSizes,
  readStoredLayout,
  useWorkspaceLayout,
} from "./useWorkspaceLayout";

describe("useWorkspaceLayout Hook", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("normalizes panel sizes to keep chat between 15% and 50%", () => {
    expect(normalizeLayoutSizes(10, 90)).toEqual({ chat: 15, preview: 85 });
    expect(normalizeLayoutSizes(65, 35)).toEqual({ chat: 50, preview: 50 });
    expect(normalizeLayoutSizes(35, 65)).toEqual({ chat: 35, preview: 65 });
  });

  it("falls back safely to default state on corrupted localStorage JSON", () => {
    localStorage.setItem("sparkweb:layout:v1", "INVALID_JSON_CORRUPTED{");
    const result = readStoredLayout();
    expect(result).toEqual(DEFAULT_LAYOUT_STATE);
  });

  it("falls back safely if localStorage data fails Zod validation", () => {
    localStorage.setItem(
      "sparkweb:layout:v1",
      JSON.stringify({ version: 2, chatPanelSize: "not a number" })
    );
    const result = readStoredLayout();
    expect(result).toEqual(DEFAULT_LAYOUT_STATE);
  });

  it("collapses chat to 0% and restores previous size on uncollapse", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceLayout());

    // Initially uncollapsed
    expect(result.current.layout.isChatCollapsed).toBe(false);
    expect(result.current.layout.chatPanelSize).toBe(30);

    // Update size to 40%
    act(() => {
      result.current.updateSizes(40, 60);
    });
    expect(result.current.layout.chatPanelSize).toBe(40);
    expect(result.current.layout.lastExpandedChatSize).toBe(40);

    // Collapse
    act(() => {
      result.current.toggleChatCollapse();
    });
    expect(result.current.layout.isChatCollapsed).toBe(true);
    expect(result.current.layout.chatPanelSize).toBe(0);
    expect(result.current.layout.previewPanelSize).toBe(100);

    // Uncollapse: should restore to 40%
    act(() => {
      result.current.toggleChatCollapse();
    });
    expect(result.current.layout.isChatCollapsed).toBe(false);
    expect(result.current.layout.chatPanelSize).toBe(40);
    expect(result.current.layout.previewPanelSize).toBe(60);

    vi.useRealTimers();
  });

  it("updates preview device mode and persists to storage", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceLayout());

    act(() => {
      result.current.setPreviewDevice("tablet");
    });
    expect(result.current.layout.previewDevice).toBe("tablet");

    act(() => {
      vi.advanceTimersByTime(300);
    });

    const stored = JSON.parse(localStorage.getItem("sparkweb:layout:v1") || "{}");
    expect(stored.previewDevice).toBe("tablet");

    vi.useRealTimers();
  });

  it("resets preferences to default state", () => {
    const { result } = renderHook(() => useWorkspaceLayout());

    act(() => {
      result.current.setPreviewDevice("mobile");
      result.current.resetPreferences();
    });

    expect(result.current.layout.previewDevice).toBe("desktop");
    expect(result.current.layout.chatPanelSize).toBe(30);
  });
});

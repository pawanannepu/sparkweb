import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVersionHistory } from "./useVersionHistory";

describe("useVersionHistory hook", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useVersionHistory({ projectId: "proj-123" }));

    expect(result.current.isDrawerOpen).toBe(false);
    expect(result.current.snapshots).toEqual([]);
    expect(result.current.branches).toEqual([]);
    expect(result.current.isInspectMode).toBe(false);
    expect(result.current.isRollingBack).toBe(false);
  });

  it("opens and closes drawer", () => {
    const { result } = renderHook(() => useVersionHistory({ projectId: "proj-123" }));

    act(() => {
      result.current.openDrawer();
    });
    expect(result.current.isDrawerOpen).toBe(true);

    act(() => {
      result.current.closeDrawer();
    });
    expect(result.current.isDrawerOpen).toBe(false);
  });

  it("loads branches and snapshots on drawer open", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          branches: [{ id: "b1", name: "main", isMain: true, isActive: true }],
          activeBranchId: "b1",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "s1",
              projectId: "proj-123",
              fileCount: 3,
              trigger: "generation",
              message: "Initial build",
              createdAt: new Date().toISOString(),
            },
          ],
          nextCursor: null,
        }),
      });

    const { result } = renderHook(() => useVersionHistory({ projectId: "proj-123" }));

    await act(async () => {
      result.current.openDrawer();
    });

    expect(result.current.branches).toHaveLength(1);
    expect(result.current.branches[0]?.name).toBe("main");
    expect(result.current.snapshots).toHaveLength(1);
    expect(result.current.snapshots[0]?.message).toBe("Initial build");
  });

  it("enters inspect mode and fetches snapshot details and diff (AC-6)", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "s2",
          files: { "src/App.tsx": { content: "historical" } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          targetSnapshotId: "s2",
          baseSnapshotId: "s1",
          summary: { totalFiles: 1, modifiedFiles: 1 },
          fileDiffs: [],
        }),
      });

    const onInspectFiles = vi.fn();
    const { result } = renderHook(() =>
      useVersionHistory({ projectId: "proj-123", onInspectFiles })
    );

    await act(async () => {
      await result.current.enterInspectMode("s2");
    });

    expect(result.current.isInspectMode).toBe(true);
    expect(result.current.inspectSnapshotId).toBe("s2");
    expect(result.current.inspectFiles).toEqual({
      "src/App.tsx": { content: "historical" },
    });
    expect(onInspectFiles).toHaveBeenCalledWith({
      "src/App.tsx": { content: "historical" },
    });

    // Exit inspect mode
    act(() => {
      result.current.exitInspectMode();
    });
    expect(result.current.isInspectMode).toBe(false);
    expect(result.current.inspectSnapshotId).toBeNull();
  });

  it("filters snapshots by trigger and search query (AC-5)", () => {
    const { result } = renderHook(() => useVersionHistory({ projectId: "proj-123" }));

    const testSnapshots = [
      {
        id: "snap-1",
        projectId: "proj-123",
        parentId: null,
        branchId: "b1",
        branchName: "main",
        treeHash: "h1",
        fileCount: 2,
        message: "Add landing page hero",
        trigger: "generation" as const,
        tag: "v1.0",
        restoredFromSnapshotId: null,
        createdAt: "2026-11-24T10:00:00Z",
      },
      {
        id: "snap-2",
        projectId: "proj-123",
        parentId: "snap-1",
        branchId: "b1",
        branchName: "main",
        treeHash: "h2",
        fileCount: 2,
        message: "Button color adjustment",
        trigger: "canvas" as const,
        tag: null,
        restoredFromSnapshotId: null,
        createdAt: "2026-11-24T11:00:00Z",
      },
      {
        id: "snap-3",
        projectId: "proj-123",
        parentId: "snap-2",
        branchId: "b1",
        branchName: "main",
        treeHash: "h3",
        fileCount: 2,
        message: "Self healing compiler fix",
        trigger: "repair" as const,
        tag: null,
        restoredFromSnapshotId: null,
        createdAt: "2026-11-24T12:00:00Z",
      },
    ];

    // Mock internal snapshots state
    act(() => {
      result.current.snapshots.push(...testSnapshots);
      result.current.setSearchQuery("hero");
    });

    expect(result.current.filteredSnapshots).toHaveLength(1);
    expect(result.current.filteredSnapshots[0]?.message).toContain("hero");

    act(() => {
      result.current.setSearchQuery("");
      result.current.setSelectedTriggerFilter("canvas");
    });
    expect(result.current.filteredSnapshots).toHaveLength(1);
    expect(result.current.filteredSnapshots[0]?.trigger).toBe("canvas");
  });

  it("blocks rollback when streaming is active (AC-8)", async () => {
    const { result } = renderHook(() =>
      useVersionHistory({ projectId: "proj-123", isStreaming: true })
    );

    let success = false;
    await act(async () => {
      success = await result.current.executeRollback("s1");
    });

    expect(success).toBe(false);
    expect(result.current.error).toContain("actively running");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

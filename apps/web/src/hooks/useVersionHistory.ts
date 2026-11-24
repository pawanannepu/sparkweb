"use client";

import type {
  BranchSummary,
  SnapshotDiffResult,
  SnapshotFilesMap,
  SnapshotSummary,
  SnapshotTrigger,
} from "@spark/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UseVersionHistoryOptions {
  projectId: string;
  isStreaming?: boolean;
  hasUnsavedCanvasChanges?: boolean;
  onInspectFiles?: (files: SnapshotFilesMap) => void;
  onExitInspect?: () => void;
  onRollbackComplete?: (restoredFiles: SnapshotFilesMap, snapshot: SnapshotSummary) => void;
  onBranchSwitched?: (files: SnapshotFilesMap, branch: BranchSummary) => void;
}

export function useVersionHistory({
  projectId,
  isStreaming = false,
  hasUnsavedCanvasChanges = false,
  onInspectFiles,
  onExitInspect,
  onRollbackComplete,
  onBranchSwitched,
}: UseVersionHistoryOptions) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  // Inspection mode state
  const [inspectSnapshotId, setInspectSnapshotId] = useState<string | null>(null);
  const [inspectFiles, setInspectFiles] = useState<SnapshotFilesMap | null>(null);
  const [inspectDiff, setInspectDiff] = useState<SnapshotDiffResult | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);

  // Rollback in flight state
  const [isRollingBack, setIsRollingBack] = useState(false);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTriggerFilter, setSelectedTriggerFilter] = useState<SnapshotTrigger | "all">(
    "all"
  );

  const [error, setError] = useState<string | null>(null);

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  // 1. Fetch branches list
  const fetchBranches = useCallback(async () => {
    setIsLoadingBranches(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/branches`);
      if (!res.ok) throw new Error("Failed to load branches");
      const data = await res.json();
      setBranches(data.branches || []);
      setActiveBranchId(data.activeBranchId || null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error fetching branches";
      setError(msg);
    } finally {
      setIsLoadingBranches(false);
    }
  }, [projectId]);

  // 2. Fetch paginated snapshots
  const fetchSnapshots = useCallback(
    async (branchId?: string, cursor?: string, append = false) => {
      setIsLoadingSnapshots(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams();
        if (branchId) queryParams.set("branchId", branchId);
        if (cursor) queryParams.set("cursor", cursor);
        queryParams.set("limit", "25");

        const res = await fetch(`/api/projects/${projectId}/snapshots?${queryParams.toString()}`);
        if (!res.ok) throw new Error("Failed to load snapshots");
        const data = await res.json();

        setSnapshots((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
        setNextCursor(data.nextCursor || null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error fetching snapshots";
        setError(msg);
      } finally {
        setIsLoadingSnapshots(false);
      }
    },
    [projectId]
  );

  const loadMoreSnapshots = useCallback(() => {
    if (!nextCursor || isLoadingSnapshots) return;
    fetchSnapshots(activeBranchId || undefined, nextCursor, true);
  }, [nextCursor, isLoadingSnapshots, activeBranchId, fetchSnapshots]);

  const refreshSnapshots = useCallback(() => {
    fetchSnapshots(activeBranchId || undefined, undefined, false);
  }, [activeBranchId, fetchSnapshots]);

  // Initial load when drawer opens
  useEffect(() => {
    if (isDrawerOpen) {
      fetchBranches();
      fetchSnapshots(activeBranchId || undefined);
    }
  }, [isDrawerOpen, activeBranchId, fetchBranches, fetchSnapshots]);

  // 3. Switch active branch
  const switchBranch = useCallback(
    async (branchId: string): Promise<boolean> => {
      if (hasUnsavedCanvasChanges) {
        // Calling component should check hasUnsavedCanvasChanges or prompt user
      }

      setIsLoadingBranches(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/branches/${branchId}/switch`, {
          method: "POST",
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to switch branch");
        }
        const data = await res.json();
        setActiveBranchId(data.activeBranch.id);

        // Update branch list active flags
        setBranches((prev) =>
          prev.map((b) => ({
            ...b,
            isActive: b.id === data.activeBranch.id,
          }))
        );

        // If inspecting, exit inspect mode
        if (inspectSnapshotId) {
          setInspectSnapshotId(null);
          setInspectFiles(null);
          setInspectDiff(null);
        }

        onBranchSwitched?.(data.files, data.activeBranch);
        fetchSnapshots(data.activeBranch.id);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error switching branch";
        setError(msg);
        return false;
      } finally {
        setIsLoadingBranches(false);
      }
    },
    [hasUnsavedCanvasChanges, projectId, inspectSnapshotId, onBranchSwitched, fetchSnapshots]
  );

  // 4. Create new branch
  const createNewBranch = useCallback(
    async (
      name: string,
      fromSnapshotId?: string,
      switchActive = true
    ): Promise<BranchSummary | null> => {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/branches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, fromSnapshotId, switchActive }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to create branch");
        }
        const data = await res.json();
        await fetchBranches();
        if (switchActive) {
          fetchSnapshots(data.branch.id);
        }
        return data.branch;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error creating branch";
        setError(msg);
        return null;
      }
    },
    [projectId, fetchBranches, fetchSnapshots]
  );

  // 5. Delete branch
  const deleteExistingBranch = useCallback(
    async (branchId: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/branches/${branchId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to delete branch");
        }
        await fetchBranches();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error deleting branch";
        setError(msg);
        return false;
      }
    },
    [projectId, fetchBranches]
  );

  // 6. Enter temporary inspect mode
  const enterInspectMode = useCallback(
    async (snapshotId: string) => {
      if (isStreamingRef.current) return;
      setIsLoadingDiff(true);
      setError(null);
      try {
        const [snapRes, diffRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/snapshots/${snapshotId}`),
          fetch(`/api/projects/${projectId}/snapshots/${snapshotId}/diff`),
        ]);

        if (!snapRes.ok) throw new Error("Failed to load snapshot details");
        if (!diffRes.ok) throw new Error("Failed to load snapshot diff");

        const snapData = await snapRes.json();
        const diffData: SnapshotDiffResult = await diffRes.json();

        setInspectSnapshotId(snapshotId);
        setInspectFiles(snapData.files || {});
        setInspectDiff(diffData);

        onInspectFiles?.(snapData.files || {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error entering inspect mode";
        setError(msg);
      } finally {
        setIsLoadingDiff(false);
      }
    },
    [projectId, onInspectFiles]
  );

  // 7. Exit inspect mode
  const exitInspectMode = useCallback(() => {
    setInspectSnapshotId(null);
    setInspectFiles(null);
    setInspectDiff(null);
    onExitInspect?.();
  }, [onExitInspect]);

  // 8. Rollback snapshot (non destructive forward commit)
  const executeRollback = useCallback(
    async (snapshotId: string, message?: string): Promise<boolean> => {
      if (isStreamingRef.current) {
        setError("Cannot roll back while AI generation is actively running");
        return false;
      }

      setIsRollingBack(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/snapshots/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId, message }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to execute rollback");
        }

        const data = await res.json();

        // Exit inspect mode
        exitInspectMode();

        // Refresh snapshots and notify parent
        refreshSnapshots();
        fetchBranches();
        onRollbackComplete?.(data.files, data.snapshot);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error executing rollback";
        setError(msg);
        return false;
      } finally {
        setIsRollingBack(false);
      }
    },
    [projectId, exitInspectMode, refreshSnapshots, fetchBranches, onRollbackComplete]
  );

  // 9. Create manual checkpoint
  const createManualCheckpoint = useCallback(
    async (files: SnapshotFilesMap, message: string, tag?: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files,
            message,
            tag,
            trigger: "manual",
            branchId: activeBranchId || undefined,
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to create checkpoint");
        }
        refreshSnapshots();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error creating checkpoint";
        setError(msg);
        return false;
      }
    },
    [projectId, activeBranchId, refreshSnapshots]
  );

  // 10. Filtered snapshots calculation
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((snap) => {
      // Trigger filter
      if (selectedTriggerFilter !== "all" && snap.trigger !== selectedTriggerFilter) {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchMessage = snap.message?.toLowerCase().includes(q) ?? false;
      const matchTag = snap.tag?.toLowerCase().includes(q) ?? false;
      const matchBranch = snap.branchName?.toLowerCase().includes(q) ?? false;
      const matchId = snap.id.toLowerCase().includes(q);
      return matchMessage || matchTag || matchBranch || matchId;
    });
  }, [snapshots, selectedTriggerFilter, searchQuery]);

  return {
    // Drawer visibility
    isDrawerOpen,
    openDrawer: () => setIsDrawerOpen(true),
    closeDrawer: () => setIsDrawerOpen(false),
    toggleDrawer: () => setIsDrawerOpen((prev) => !prev),

    // Snapshots list & pagination
    snapshots,
    filteredSnapshots,
    isLoadingSnapshots,
    nextCursor,
    loadMoreSnapshots,
    refreshSnapshots,

    // Branches
    branches,
    activeBranchId,
    isLoadingBranches,
    fetchBranches,
    switchBranch,
    createBranch: createNewBranch,
    deleteBranch: deleteExistingBranch,

    // Inspection mode
    inspectSnapshotId,
    inspectFiles,
    inspectDiff,
    isLoadingDiff,
    isInspectMode: inspectSnapshotId !== null,
    enterInspectMode,
    exitInspectMode,

    // Rollback
    isRollingBack,
    executeRollback,

    // Manual checkpoint
    createManualCheckpoint,

    // Search and filters
    searchQuery,
    setSearchQuery,
    selectedTriggerFilter,
    setSelectedTriggerFilter,

    // Error
    error,
    clearError: () => setError(null),
  };
}

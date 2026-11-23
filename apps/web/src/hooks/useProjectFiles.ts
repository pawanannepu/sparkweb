"use client";

import type {
  CanvasHistoryEntry,
  CanvasHistoryStack,
  ProjectFile,
  SelectedElementState,
  SnapshotFilesMap,
} from "@spark/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { isWorkspaceFilePath, updateElementClasses, updateElementText } from "@/lib/ast-modifier";

export interface UseProjectFilesOptions {
  projectId: string;
  initialFiles?: SnapshotFilesMap;
  isStreaming?: boolean;
  onWriteFiles?: (files: ProjectFile[]) => void;
  onSendBridgeMessage?: (type: string, payload: Record<string, unknown>) => void;
}

export function useProjectFiles({
  projectId,
  initialFiles = {},
  isStreaming = false,
  onWriteFiles,
  onSendBridgeMessage,
}: UseProjectFilesOptions) {
  const [files, setFilesState] = useState<SnapshotFilesMap>(initialFiles);
  const [selectedElement, setSelectedElement] = useState<SelectedElementState | null>(null);
  const [isInspectMode, setIsInspectModeState] = useState(false);

  // Undo / Redo history stack
  const [history, setHistory] = useState<CanvasHistoryStack>({
    past: [],
    present: Object.fromEntries(Object.entries(initialFiles).map(([k, v]) => [k, v.content])),
    future: [],
  });

  const filesRef = useRef(files);
  filesRef.current = files;

  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  const debouncedWriteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize incoming files from generation stream
  const setFiles = useCallback((newFiles: SnapshotFilesMap) => {
    setFilesState(newFiles);
    setHistory((prev) => ({
      past: prev.present
        ? [
            ...prev.past.slice(-30),
            {
              id: String(Date.now()),
              timestamp: Date.now(),
              files: prev.present,
              description: "Generation sync",
            },
          ]
        : prev.past,
      present: Object.fromEntries(Object.entries(newFiles).map(([k, v]) => [k, v.content])),
      future: [],
    }));
  }, []);

  const setIsInspectMode = useCallback(
    (enabled: boolean) => {
      // Disabled during active AI generation streaming
      if (isStreamingRef.current && enabled) return;
      setIsInspectModeState(enabled);
      onSendBridgeMessage?.("PREVIEW_INSPECT_MODE", { enabled });
      if (!enabled) {
        setSelectedElement(null);
      }
    },
    [onSendBridgeMessage]
  );

  // Lock inspector during active streaming
  useEffect(() => {
    if (isStreaming) {
      if (isInspectMode) {
        setIsInspectModeState(false);
        onSendBridgeMessage?.("PREVIEW_INSPECT_MODE", { enabled: false });
      }
      setSelectedElement(null);
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    }
  }, [isStreaming, isInspectMode, onSendBridgeMessage]);

  // Schedule 3s idle auto save snapshot
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    if (isStreamingRef.current) return;

    autoSaveTimeoutRef.current = setTimeout(async () => {
      if (isStreamingRef.current) return;
      try {
        await fetch(`/api/projects/${projectId}/snapshots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: filesRef.current,
            message: "Visual canvas direct styling update",
          }),
        });
      } catch (err) {
        console.warn("Auto save snapshot error:", err);
      }
    }, 3000);
  }, [projectId]);

  // Record an updated file and handle debounced file write
  const updateFileContent = useCallback(
    (filePath: string, newContent: string, description = "Visual style update") => {
      setFilesState((prev) => {
        const next = { ...prev, [filePath]: { content: newContent } };
        return next;
      });

      setHistory((prev) => ({
        past: [
          ...prev.past.slice(-30),
          {
            id: String(Date.now()),
            timestamp: Date.now(),
            files: prev.present,
            description,
          },
        ],
        present: { ...prev.present, [filePath]: newContent },
        future: [],
      }));

      // Debounce 300ms write to virtual filesystem
      if (debouncedWriteTimeoutRef.current) {
        clearTimeout(debouncedWriteTimeoutRef.current);
      }
      debouncedWriteTimeoutRef.current = setTimeout(() => {
        onWriteFiles?.([{ path: filePath, content: newContent }]);
      }, 300);

      // Trigger 3s auto save snapshot timer
      scheduleAutoSave();
    },
    [onWriteFiles, scheduleAutoSave]
  );

  // Apply styling adjustments (instant injection + AST update)
  const applyStyleUpdate = useCallback(
    ({
      newClasses,
      removeClasses,
      replaceAllClasses,
      instantStyles,
    }: {
      newClasses?: string[];
      removeClasses?: string[];
      replaceAllClasses?: string[];
      instantStyles?: Record<string, string>;
    }) => {
      if (!selectedElement) return false;

      // 1. Instant zero latency CSS injection into preview DOM
      if (instantStyles) {
        onSendBridgeMessage?.("PREVIEW_INJECT_STYLES", {
          selector: selectedElement.selector,
          styles: instantStyles,
        });
      }

      // 2. Verify file safety
      const source = selectedElement.source;
      if (!source?.file || !isWorkspaceFilePath(source.file)) {
        return false;
      }

      const fileEntry = filesRef.current[source.file];
      if (!fileEntry) return false;

      // 3. In-browser AST transformation via recast & tailwind-merge
      const res = updateElementClasses(fileEntry.content, {
        source,
        newClasses,
        removeClasses,
        replaceAllClasses,
      });

      if (!res.success) return false;

      // 4. Update file store & debounced write
      updateFileContent(source.file, res.code, "Adjusted element Tailwind styles");

      // 5. Update selected element state
      setSelectedElement((prev) => (prev ? { ...prev, classes: res.modifiedClasses } : null));

      return true;
    },
    [selectedElement, onSendBridgeMessage, updateFileContent]
  );

  // Apply direct text adjustment (inline or inspector)
  const applyTextUpdate = useCallback(
    (newText: string) => {
      if (!selectedElement) return false;

      // Instant preview text injection
      onSendBridgeMessage?.("PREVIEW_UPDATE_TEXT", {
        selector: selectedElement.selector,
        text: newText,
      });

      const source = selectedElement.source;
      if (!source?.file || !isWorkspaceFilePath(source.file)) {
        return false;
      }

      const fileEntry = filesRef.current[source.file];
      if (!fileEntry) return false;

      const res = updateElementText(fileEntry.content, {
        source,
        text: newText,
      });

      if (!res.success) return false;

      updateFileContent(source.file, res.code, "Updated element text");
      setSelectedElement((prev) => (prev ? { ...prev, textContent: newText } : null));

      return true;
    },
    [selectedElement, onSendBridgeMessage, updateFileContent]
  );

  // Undo action
  const undo = useCallback(() => {
    if (history.past.length === 0) return;
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    const newPast = history.past.slice(0, -1);
    const newFuture: CanvasHistoryEntry = {
      id: String(Date.now()),
      timestamp: Date.now(),
      files: history.present,
      description: "Undo step",
    };

    setHistory({
      past: newPast,
      present: previous.files,
      future: [newFuture, ...history.future],
    });

    const newSnapshotMap: SnapshotFilesMap = {};
    const changedFiles: ProjectFile[] = [];
    for (const [path, content] of Object.entries(previous.files)) {
      newSnapshotMap[path] = { content };
      if (filesRef.current[path]?.content !== content) {
        changedFiles.push({ path, content });
      }
    }

    setFilesState(newSnapshotMap);
    if (changedFiles.length > 0) {
      onWriteFiles?.(changedFiles);
    }
    scheduleAutoSave();
  }, [history, onWriteFiles, scheduleAutoSave]);

  // Redo action
  const redo = useCallback(() => {
    if (history.future.length === 0) return;
    const next = history.future[0];
    if (!next) return;
    const newFuture = history.future.slice(1);
    const newPastEntry: CanvasHistoryEntry = {
      id: String(Date.now()),
      timestamp: Date.now(),
      files: history.present,
      description: "Redo step",
    };

    setHistory({
      past: [...history.past, newPastEntry],
      present: next.files,
      future: newFuture,
    });

    const newSnapshotMap: SnapshotFilesMap = {};
    const changedFiles: ProjectFile[] = [];
    for (const [path, content] of Object.entries(next.files)) {
      newSnapshotMap[path] = { content };
      if (filesRef.current[path]?.content !== content) {
        changedFiles.push({ path, content });
      }
    }

    setFilesState(newSnapshotMap);
    if (changedFiles.length > 0) {
      onWriteFiles?.(changedFiles);
    }
    scheduleAutoSave();
  }, [history, onWriteFiles, scheduleAutoSave]);

  return {
    files,
    setFiles,
    selectedElement,
    setSelectedElement,
    isInspectMode,
    setIsInspectMode,
    applyStyleUpdate,
    applyTextUpdate,
    updateFileContent,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

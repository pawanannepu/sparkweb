"use client";

import type { FileOperation, PlanStep, ProjectFile } from "@spark/shared";
import { useCallback, useRef, useState } from "react";

export interface UseGenerationLoopOptions {
  projectId: string;
  threadId?: string;
  onFileChange?: (file: ProjectFile) => void;
  onFinish?: (snapshotId: string, treeHash: string) => void;
  onError?: (error: string) => void;
}

export interface UseGenerationLoopReturn {
  isStreaming: boolean;
  planSteps: PlanStep[];
  fileOperations: FileOperation[];
  activeFiles: ProjectFile[];
  error: string | null;
  submitPrompt: (prompt: string, model?: string) => Promise<void>;
  cancelGeneration: () => void;
  reset: () => void;
}

export function useGenerationLoop({
  projectId,
  threadId,
  onFileChange,
  onFinish,
  onError,
}: UseGenerationLoopOptions): UseGenerationLoopReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [fileOperations, setFileOperations] = useState<FileOperation[]>([]);
  const [activeFiles, setActiveFiles] = useState<ProjectFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setPlanSteps([]);
    setFileOperations([]);
    setActiveFiles([]);
    setError(null);
  }, []);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setPlanSteps((prev) =>
      prev.map((step) => (step.status === "running" ? { ...step, status: "failed" } : step))
    );
  }, []);

  const submitPrompt = useCallback(
    async (prompt: string, model?: string) => {
      if (!prompt.trim() || isStreaming) return;

      setIsStreaming(true);
      setError(null);
      setPlanSteps([]);
      setFileOperations([]);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch(`/api/projects/${projectId}/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            threadId,
            model,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errorMessage = `Generation failed (${response.status})`;
          try {
            const errData = await response.json();
            if (errData?.message) errorMessage = errData.message;
            else if (errData?.error) errorMessage = errData.error;
          } catch {
            // Keep status fallback
          }
          throw new Error(errorMessage);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Unable to read generation stream response");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const rawMessage of lines) {
            if (!rawMessage.trim()) continue;

            const eventMatch = rawMessage.match(/^event:\s*(\w+)/m);
            const dataMatch = rawMessage.match(/^data:\s*(.+)$/m);

            const eventType = eventMatch ? eventMatch[1] : "message";
            const dataStr = dataMatch ? dataMatch[1] : "";

            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);

              if (eventType === "plan") {
                if (data.steps && Array.isArray(data.steps)) {
                  setPlanSteps(data.steps);
                }
              } else if (eventType === "file_op") {
                const file: ProjectFile = {
                  path: data.path,
                  content: data.content,
                };

                setActiveFiles((prev) => {
                  const filtered = prev.filter((f) => f.path !== file.path);
                  return [...filtered, file];
                });

                setFileOperations((prev) => {
                  const filtered = prev.filter((op) => op.path !== data.path);
                  return [
                    ...filtered,
                    {
                      path: data.path,
                      op: data.op || "write",
                      status: "completed",
                      diff: data.diff,
                    },
                  ];
                });

                onFileChange?.(file);
              } else if (eventType === "finish") {
                onFinish?.(data.snapshotId, data.treeHash);
              } else if (eventType === "error") {
                const errText = data.message || "Generation error occurred";
                setError(errText);
                onError?.(errText);
              }
            } catch (parseErr) {
              console.warn("Failed to parse SSE payload", parseErr, dataStr);
            }
          }
        }
      } catch (err: unknown) {
        const errorObj = err as Error;
        if (errorObj.name === "AbortError") {
          // Normal cancellation
          return;
        }
        const message = errorObj?.message || "Failed to complete generation";
        setError(message);
        onError?.(message);
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [isStreaming, onError, onFileChange, onFinish, projectId, threadId]
  );

  return {
    isStreaming,
    planSteps,
    fileOperations,
    activeFiles,
    error,
    submitPrompt,
    cancelGeneration,
    reset,
  };
}

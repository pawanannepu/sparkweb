"use client";

import { computeErrorFingerprint } from "@spark/sandbox";
import {
  type AiProvider,
  type FileOperation,
  type HealingAttempt,
  type HealingCategory,
  type HealingTelemetry,
  isAiProvider,
  type PlanStep,
  type PreviewErrorPayload,
  type PreviewHealthStatusPayload,
  type ProjectFile,
  resolveModelProvider,
} from "@spark/shared";
import { useCallback, useRef, useState } from "react";

export interface UseGenerationLoopOptions {
  projectId: string;
  threadId?: string;
  getCurrentFiles?: () => Record<string, string>;
  requestHealthCheck?: (timeoutMs?: number) => Promise<PreviewHealthStatusPayload>;
  onFileChange?: (file: ProjectFile) => void;
  onFinish?: (snapshotId: string, treeHash: string) => void;
  onError?: (error: string) => void;
  onProviderKeyMissing?: (provider: AiProvider) => void;
  onHealingTelemetryChange?: (telemetry: HealingTelemetry) => void;
}

export interface UseGenerationLoopReturn {
  isStreaming: boolean;
  planSteps: PlanStep[];
  fileOperations: FileOperation[];
  activeFiles: ProjectFile[];
  error: string | null;
  healingTelemetry: HealingTelemetry;
  submitPrompt: (prompt: string, model?: string) => Promise<void>;
  triggerRepair: (error: PreviewErrorPayload, model?: string) => Promise<void>;
  cancelGeneration: () => void;
  reset: () => void;
}

const INITIAL_TELEMETRY: HealingTelemetry = {
  status: "none",
  totalRepairs: 0,
  attempts: [],
};

// Helper: resolve relative imported sibling files from source file
export function resolveSiblingImports(
  sourcePath: string,
  sourceContent: string,
  allFiles: Record<string, string>
): ProjectFile[] {
  const siblings: ProjectFile[] = [];
  const importRegex = /(?:import|export)\s+.*?from\s+["'](\.[^"']+)["']/g;

  const sourceDir = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
    : "";

  let match = importRegex.exec(sourceContent);
  while (match !== null) {
    const importPath = match[1];
    if (importPath) {
      const candidateBases = [sourceDir ? `${sourceDir}/${importPath}` : importPath].map((p) =>
        p.replace(/\/\.\//g, "/").replace(/^\.\//, "")
      );

      const extensions = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];

      for (const base of candidateBases) {
        for (const ext of extensions) {
          const fullPath = (base + ext).replace(/^[./]+/, "");
          if (allFiles[fullPath] && !siblings.some((s) => s.path === fullPath)) {
            siblings.push({
              path: fullPath,
              content: allFiles[fullPath] || "",
            });
          }
        }
      }
    }
    match = importRegex.exec(sourceContent);
  }
  return siblings;
}

export function useGenerationLoop({
  projectId,
  threadId,
  getCurrentFiles,
  requestHealthCheck,
  onFileChange,
  onFinish,
  onError,
  onProviderKeyMissing,
  onHealingTelemetryChange,
}: UseGenerationLoopOptions): UseGenerationLoopReturn {
  const [isStreaming, setIsStreaming] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [fileOperations, setFileOperations] = useState<FileOperation[]>([]);
  const [activeFiles, setActiveFiles] = useState<ProjectFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [healingTelemetry, setHealingTelemetry] = useState<HealingTelemetry>(INITIAL_TELEMETRY);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeFilesRef = useRef<ProjectFile[]>([]);
  const lastAssistantMessageIdRef = useRef<string | null>(null);

  const updateTelemetry = useCallback(
    (telemetry: HealingTelemetry) => {
      setHealingTelemetry(telemetry);
      onHealingTelemetryChange?.(telemetry);
    },
    [onHealingTelemetryChange]
  );

  const reset = useCallback(() => {
    setPlanSteps([]);
    setFileOperations([]);
    setActiveFiles([]);
    activeFilesRef.current = [];
    setError(null);
    updateTelemetry(INITIAL_TELEMETRY);
    lastAssistantMessageIdRef.current = null;
  }, [updateTelemetry]);

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

  // Central Verification & Self-Healing Loop (AC-2, AC-4, AC-6, AC-7)
  const runSelfHealingVerificationLoop = useCallback(
    async (
      initialMessageId: string | null,
      turnDescription: string,
      model = "claude-3-7-sonnet",
      initialError?: PreviewErrorPayload,
      signal?: AbortSignal
    ): Promise<void> => {
      let activeMessageId = initialMessageId;
      let attemptsCount = 0;
      const seenFingerprints = new Set<string>();
      const currentAttempts: HealingAttempt[] = [];

      // Update step 3 to running
      setPlanSteps((prev) =>
        prev.map((s) => (s.id === "step-3" ? { ...s, status: "running" } : s))
      );

      while (attemptsCount <= 3) {
        if (signal?.aborted) {
          return;
        }

        // Step 1: Health Check Handshake
        let healthStatus: PreviewHealthStatusPayload;
        if (attemptsCount === 0 && initialError) {
          healthStatus = { healthy: false, error: initialError };
        } else {
          healthStatus = requestHealthCheck ? await requestHealthCheck(4000) : { healthy: true };
        }

        if (signal?.aborted) {
          return;
        }

        if (healthStatus.healthy) {
          // Verification passed!
          const finalTelemetry: HealingTelemetry = {
            status: attemptsCount > 0 ? "healed" : "none",
            totalRepairs: attemptsCount,
            attempts: currentAttempts,
          };
          updateTelemetry(finalTelemetry);

          setPlanSteps((prev) =>
            prev.map((s) => (s.id === "step-3" ? { ...s, status: "completed" } : s))
          );

          // Commit verified clean snapshot (AC-7)
          const allFilesMap = getCurrentFiles
            ? getCurrentFiles()
            : Object.fromEntries(activeFilesRef.current.map((f) => [f.path, f.content]));

          const filesPayload = Object.fromEntries(
            Object.entries(allFilesMap).map(([p, content]) => [p, { content }])
          );

          const snapRes = await fetch(`/api/projects/${projectId}/snapshots`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
              files: filesPayload,
              message:
                attemptsCount > 0
                  ? `${turnDescription} (with ${attemptsCount} automated repair${attemptsCount > 1 ? "s" : ""})`
                  : turnDescription,
              ...(activeMessageId ? { messageId: activeMessageId } : {}),
              healingTelemetry: finalTelemetry,
              status: attemptsCount > 0 ? "healed" : "clean",
            }),
          });

          if (snapRes.ok) {
            const snapData = await snapRes.json();
            onFinish?.(snapData.id, snapData.treeHash);
          }
          return;
        }

        // Verification failed -> inspect error
        const detectedError = healthStatus.error || {
          message: "Preview application failed health verification",
        };

        const errorCategory: HealingCategory = detectedError.category || "compiler";
        const normalizedFilename = (detectedError.filename || "src/App.tsx")
          .replace(/^[./]+/, "")
          .trim();
        const fingerprint =
          detectedError.errorFingerprint ||
          computeErrorFingerprint(errorCategory, normalizedFilename, detectedError.message);

        // Check Loop Invariant: duplicate fingerprint or max 3 retries (AC-6)
        if (seenFingerprints.has(fingerprint) || attemptsCount >= 3) {
          // Halt immediately and mark exhausted
          const exhaustedTelemetry: HealingTelemetry = {
            status: "exhausted",
            totalRepairs: attemptsCount,
            attempts: currentAttempts,
          };
          updateTelemetry(exhaustedTelemetry);

          setPlanSteps((prev) =>
            prev.map((s) => (s.id === "step-3" ? { ...s, status: "failed" } : s))
          );

          const exhaustedReason = seenFingerprints.has(fingerprint)
            ? "Duplicate error fingerprint detected across repair attempts."
            : "Maximum three repair attempts exhausted.";

          const warningMessage = `Self-healing halted: ${exhaustedReason} Preview progress preserved.`;
          setError(warningMessage);
          onError?.(warningMessage);

          // Still commit snapshot marked as exhausted so creator progress is preserved (AC-7)
          const allFilesMap = getCurrentFiles
            ? getCurrentFiles()
            : Object.fromEntries(activeFilesRef.current.map((f) => [f.path, f.content]));

          const filesPayload = Object.fromEntries(
            Object.entries(allFilesMap).map(([p, content]) => [p, { content }])
          );

          try {
            if (signal?.aborted) {
              return;
            }
            const snapRes = await fetch(`/api/projects/${projectId}/snapshots`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal,
              body: JSON.stringify({
                files: filesPayload,
                message: `[Unverified - healing exhausted] ${turnDescription}`,
                ...(activeMessageId ? { messageId: activeMessageId } : {}),
                healingTelemetry: exhaustedTelemetry,
                status: "exhausted",
              }),
            });
            if (snapRes.ok) {
              const snapData = await snapRes.json();
              onFinish?.(snapData.id, snapData.treeHash);
            }
          } catch (e) {
            if ((e as Error)?.name === "AbortError") {
              return;
            }
            console.warn("Failed to save exhausted snapshot", e);
          }
          return;
        }

        // Record fingerprint
        seenFingerprints.add(fingerprint);
        attemptsCount += 1;

        const attempt: HealingAttempt = {
          attemptIndex: attemptsCount,
          errorFingerprint: fingerprint,
          category: errorCategory,
          message: detectedError.message,
          filePath: normalizedFilename,
          line: detectedError.line,
          column: detectedError.column,
          patchFiles: [],
          status: "analyzing",
          timestamp: Date.now(),
        };
        currentAttempts.push(attempt);

        updateTelemetry({
          status: "in_progress",
          totalRepairs: attemptsCount,
          attempts: [...currentAttempts],
        });

        // Resolve failing file and sibling imports (AC-3)
        const allFilesMap = getCurrentFiles
          ? getCurrentFiles()
          : Object.fromEntries(activeFilesRef.current.map((f) => [f.path, f.content]));

        const failingFileContent =
          allFilesMap[normalizedFilename] ||
          activeFilesRef.current.find((f) => f.path === normalizedFilename)?.content ||
          "";

        const siblingFiles = resolveSiblingImports(
          normalizedFilename,
          failingFileContent,
          allFilesMap
        );

        currentAttempts[currentAttempts.length - 1] = {
          ...attempt,
          status: "patching",
        };
        updateTelemetry({
          status: "in_progress",
          totalRepairs: attemptsCount,
          attempts: [...currentAttempts],
        });

        // Call server repair route (AC-3)
        const repairProvider = resolveModelProvider(model);
        const repairRes = await fetch(`/api/projects/${projectId}/repair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            ...(activeMessageId ? { messageId: activeMessageId } : {}),
            error: {
              ...detectedError,
              category: errorCategory,
              errorFingerprint: fingerprint,
            },
            failingFile: {
              path: normalizedFilename,
              content: failingFileContent,
            },
            importedSiblingFiles: siblingFiles,
            model,
            provider: repairProvider,
          }),
        });

        if (signal?.aborted) {
          return;
        }

        if (!repairRes.ok) {
          let repairErrMessage = `Repair request failed (${repairRes.status})`;
          try {
            const errData = (await repairRes.json()) as {
              error?: string;
              provider?: string;
              message?: string;
            };
            if (errData?.message) repairErrMessage = errData.message;
            if (
              errData?.error === "PROVIDER_KEY_MISSING" &&
              typeof errData.provider === "string" &&
              isAiProvider(errData.provider)
            ) {
              onProviderKeyMissing?.(errData.provider);
            }
          } catch {
            // Keep fallback error message
          }
          throw new Error(repairErrMessage);
        }

        const repairReader = repairRes.body?.getReader();
        if (!repairReader) {
          throw new Error("Unable to read repair stream");
        }

        const decoder = new TextDecoder();
        let repairBuffer = "";

        while (true) {
          if (signal?.aborted) {
            await repairReader.cancel().catch(() => {});
            return;
          }
          const { done, value } = await repairReader.read();
          if (done) break;
          if (signal?.aborted) {
            return;
          }

          repairBuffer += decoder.decode(value, { stream: true });
          const messages = repairBuffer.split("\n\n");
          repairBuffer = messages.pop() || "";

          for (const raw of messages) {
            if (!raw.trim()) continue;
            const eventMatch = raw.match(/^event:\s*(\w+)/m);
            const dataMatch = raw.match(/^data:\s*(.+)$/m);
            const eventType = eventMatch ? eventMatch[1] : "message";
            const dataStr = dataMatch ? dataMatch[1] : "";
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              if (typeof data.messageId === "string" && data.messageId) {
                activeMessageId = data.messageId;
                lastAssistantMessageIdRef.current = data.messageId;
              }
              if (eventType === "file_op") {
                const patchedFile: ProjectFile = {
                  path: data.path,
                  content: data.content,
                };

                setActiveFiles((prev) => {
                  const filtered = prev.filter((f) => f.path !== patchedFile.path);
                  return [...filtered, patchedFile];
                });

                activeFilesRef.current = [
                  ...activeFilesRef.current.filter((f) => f.path !== patchedFile.path),
                  patchedFile,
                ];

                setFileOperations((prev) => [
                  ...prev.filter((op) => op.path !== data.path),
                  {
                    path: data.path,
                    op: data.op || "write",
                    status: "completed",
                    diff: data.diff || `+ self-healed patch applied`,
                  },
                ]);

                const latestAttempt = currentAttempts[currentAttempts.length - 1];
                if (latestAttempt && !latestAttempt.patchFiles.includes(data.path)) {
                  currentAttempts[currentAttempts.length - 1] = {
                    ...latestAttempt,
                    patchFiles: [...latestAttempt.patchFiles, data.path],
                  };
                }

                // Push patch directly to preview runner (AC-4)
                onFileChange?.(patchedFile);
              } else if (eventType === "healing_status") {
                if (data.status) {
                  const latestAttempt = currentAttempts[currentAttempts.length - 1];
                  if (latestAttempt) {
                    currentAttempts[currentAttempts.length - 1] = {
                      ...latestAttempt,
                      status: data.status,
                    };
                  }
                  updateTelemetry({
                    status: "in_progress",
                    totalRepairs: attemptsCount,
                    attempts: [...currentAttempts],
                  });
                }
              }
            } catch {
              // Ignore payload parse error
            }
          }
        }

        const latestAttempt = currentAttempts[currentAttempts.length - 1];
        if (latestAttempt) {
          currentAttempts[currentAttempts.length - 1] = {
            ...latestAttempt,
            status: "verifying",
          };
        }
        updateTelemetry({
          status: "in_progress",
          totalRepairs: attemptsCount,
          attempts: [...currentAttempts],
        });

        // Loop continues to next health check handshake
      }
    },
    [
      getCurrentFiles,
      onFileChange,
      onFinish,
      onError,
      onProviderKeyMissing,
      projectId,
      requestHealthCheck,
      updateTelemetry,
    ]
  );

  // Manual repair action triggered by user outside generation turn (AC-8)
  const triggerRepair = useCallback(
    async (manualError: PreviewErrorPayload, model = "claude-3-7-sonnet") => {
      if (isStreaming) return;
      setIsStreaming(true);
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await runSelfHealingVerificationLoop(
          null,
          "Manual error repair pass",
          model,
          manualError,
          controller.signal
        );
      } catch (err: unknown) {
        const errorObj = err as Error;
        if (errorObj.name === "AbortError") {
          return;
        }
        const msg = errorObj.message || "Manual repair failed";
        setError(msg);
        onError?.(msg);
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [isStreaming, onError, runSelfHealingVerificationLoop]
  );

  // Submit Prompt Implementation
  const submitPrompt = useCallback(
    async (prompt: string, model?: string) => {
      if (!prompt.trim() || isStreaming) return;

      setIsStreaming(true);
      setError(null);
      setPlanSteps([]);
      setFileOperations([]);
      updateTelemetry(INITIAL_TELEMETRY);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const provider = resolveModelProvider(model || "claude-3-7-sonnet");
        const response = await fetch(`/api/projects/${projectId}/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: prompt.trim(),
            threadId,
            model,
            provider,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errorMessage = `Generation failed (${response.status})`;
          try {
            const errData = (await response.json()) as {
              error?: string;
              provider?: string;
              message?: string;
            };
            if (errData?.message) errorMessage = errData.message;
            else if (errData?.error) errorMessage = errData.error;
            if (
              errData?.error === "PROVIDER_KEY_MISSING" &&
              typeof errData.provider === "string" &&
              isAiProvider(errData.provider)
            ) {
              onProviderKeyMissing?.(errData.provider);
            }
          } catch {
            // Keep fallback
          }
          throw new Error(errorMessage);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Unable to read generation stream response");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let assistantMessageId: string | null = null;
        let directSnapshotId: string | null = null;
        let directTreeHash: string | null = null;

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
                if (data.messageId) {
                  assistantMessageId = data.messageId;
                  lastAssistantMessageIdRef.current = data.messageId;
                }
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

                activeFilesRef.current = [
                  ...activeFilesRef.current.filter((f) => f.path !== file.path),
                  file,
                ];

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
                if (data.messageId) {
                  assistantMessageId = data.messageId;
                  lastAssistantMessageIdRef.current = data.messageId;
                }
                if (data.snapshotId) {
                  directSnapshotId = data.snapshotId;
                  directTreeHash = data.treeHash;
                }
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

        // Direct finish backwards compatibility (if server already committed snapshot)
        if (directSnapshotId) {
          onFinish?.(directSnapshotId, directTreeHash || "");
          return;
        }

        // Otherwise start verification & self-healing handshake (AC-2, AC-4, AC-7)
        if (assistantMessageId && !controller.signal.aborted) {
          await runSelfHealingVerificationLoop(
            assistantMessageId,
            prompt,
            model,
            undefined,
            controller.signal
          );
        }
      } catch (err: unknown) {
        const errorObj = err as Error;
        if (errorObj.name === "AbortError") {
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
    [
      isStreaming,
      onError,
      onFileChange,
      onFinish,
      onProviderKeyMissing,
      projectId,
      runSelfHealingVerificationLoop,
      threadId,
      updateTelemetry,
    ]
  );

  return {
    isStreaming,
    planSteps,
    fileOperations,
    activeFiles,
    error,
    healingTelemetry,
    submitPrompt,
    triggerRepair,
    cancelGeneration,
    reset,
  };
}

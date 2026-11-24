"use client";

import { STARTER_TEMPLATE_FILES } from "@spark/sandbox";
import type {
  BridgeMessageType,
  DeviceMode,
  PreviewErrorPayload,
  ProjectFile,
  SelectedElementState,
} from "@spark/shared";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  GenerationProgressCard,
  PreviewErrorBanner,
  PromptComposer,
} from "@/components/generation";
import { InspectorPanel } from "@/components/inspector";
import {
  BuilderShell,
  BuilderWorkbench,
  ChatPanel,
  PreviewFrame,
  PreviewToolbar,
} from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { useGenerationLoop } from "@/hooks/useGenerationLoop";
import { usePreviewBridge } from "@/hooks/usePreviewBridge";
import { useProjectFiles } from "@/hooks/useProjectFiles";

export default function BuilderPage() {
  const [projectId] = useState("00000000-0000-0000-0000-000000000001");
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [currentPath, setCurrentPath] = useState("/");
  const [previewError, setPreviewError] = useState<PreviewErrorPayload | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([
    {
      id: "initial",
      role: "assistant",
      content:
        "Welcome to sparkweb! Describe the application you want to build in plain words, or select one of the suggestions below.",
    },
  ]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sandboxUrl = process.env.NEXT_PUBLIC_SANDBOX_URL || "/sandbox/runner";

  const { isConnected, sendToPreview, checkPreviewHealth } = usePreviewBridge({
    iframeRef,
    targetUrl: sandboxUrl,
    onMessage: (msg) => {
      if (msg.type === "PREVIEW_NAVIGATE" && typeof msg.payload.path === "string") {
        setCurrentPath(msg.payload.path);
      } else if (msg.type === "PREVIEW_ERROR") {
        const errorData = msg.payload as unknown as PreviewErrorPayload;
        setPreviewError(errorData);
      } else if (msg.type === "PREVIEW_ELEMENT_SELECT") {
        const element = msg.payload as unknown as SelectedElementState;
        setSelectedElement(element);
      } else if (msg.type === "PREVIEW_UPDATE_TEXT") {
        const payload = msg.payload as { text?: string };
        if (payload?.text) {
          applyTextUpdate(payload.text);
        }
      }
    },
  });

  const {
    files,
    selectedElement,
    setSelectedElement,
    isInspectMode,
    setIsInspectMode,
    applyStyleUpdate,
    applyTextUpdate,
    updateFileContent,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectFiles({
    projectId,
    initialFiles: STARTER_TEMPLATE_FILES,
    isStreaming: false,
    onWriteFiles: (filesToWrite) => {
      sendToPreview("PREVIEW_WRITE_FILES", { files: filesToWrite });
    },
    onSendBridgeMessage: (type, payload) => {
      sendToPreview(type as BridgeMessageType, payload);
    },
  });

  const {
    isStreaming,
    planSteps,
    fileOperations,
    healingTelemetry,
    submitPrompt,
    triggerRepair,
    cancelGeneration,
  } = useGenerationLoop({
    projectId,
    getCurrentFiles: () =>
      Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.content])),
    requestHealthCheck: checkPreviewHealth,
    onFileChange: (file: ProjectFile) => {
      // Forward streamed file modification to in-browser WebContainer immediately
      sendToPreview("PREVIEW_WRITE_FILES", { files: [file] });
      setPreviewError(null);
      updateFileContent(file.path, file.content, "AI streaming generation");
    },
    onFinish: (snapshotId: string, _treeHash: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `All planned components and routes have been built and verified in the live preview. Snapshot ${snapshotId.slice(0, 8)} committed.`,
        },
      ]);
    },
    onError: (errMessage: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `Generation stopped: ${errMessage}`,
        },
      ]);
    },
  });

  // Global Keyboard shortcuts: Command+Z (Undo) and Command+Shift+Z (Redo) (AC-8)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        const active = document.activeElement;
        const isTextInput =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            (active as HTMLElement).isContentEditable);

        // Allow shortcuts unless typing in prompt composer
        if (isTextInput && !active.closest("[aria-label='Visual Canvas Inspector Panel']")) {
          return;
        }

        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  const handlePromptSubmit = async (promptText: string, model: string) => {
    setMessages((prev) => [...prev, { id: String(Date.now()), role: "user", content: promptText }]);
    await submitPrompt(promptText, model);
  };

  const [iframeKey, setIframeKey] = useState(0);

  const handleReload = () => {
    sendToPreview("PREVIEW_RELOAD", {});
    setIframeKey((prev) => prev + 1);
  };

  const handleNavigate = (newPath: string) => {
    setCurrentPath(newPath);
    sendToPreview("PREVIEW_NAVIGATE", { path: newPath });
  };

  const handleToggleInspect = () => {
    setIsInspectMode(!isInspectMode);
  };

  return (
    <BuilderShell projectName="Demo Application">
      <BuilderWorkbench
        isInspectorOpen={isInspectMode || Boolean(selectedElement)}
        onToggleInspector={handleToggleInspect}
        inspectorContent={
          <InspectorPanel
            element={selectedElement}
            onClose={() => {
              setSelectedElement(null);
              setIsInspectMode(false);
            }}
            onApplyStyle={applyStyleUpdate}
            onApplyText={applyTextUpdate}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        }
        chatContent={
          <ChatPanel title="Prompt Assistant">
            <div className="flex h-full flex-col justify-between space-y-4">
              {/* Message List */}
              <div className="space-y-4 overflow-y-auto pr-1">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col space-y-1.5 ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {msg.role === "assistant" && <Sparkles className="h-3 w-3 text-indigo-400" />}
                      <span>{msg.role === "user" ? "You" : "spark"}</span>
                    </div>
                    <div
                      className={`rounded-xl px-3.5 py-2.5 text-sm leading-relaxed max-w-[92%] ${
                        msg.role === "user"
                          ? "bg-indigo-600 text-white font-medium shadow-sm"
                          : "bg-card border border-border/80 text-foreground shadow-sm"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}

                {/* Live Progress Card when streaming or active steps present */}
                {(isStreaming || planSteps.length > 0 || healingTelemetry.status !== "none") && (
                  <GenerationProgressCard
                    isStreaming={isStreaming}
                    planSteps={planSteps}
                    fileOperations={fileOperations}
                    healingTelemetry={healingTelemetry}
                  />
                )}
              </div>

              {/* Input Area with Quick Prompts & Composer */}
              <div className="space-y-3 pt-2 border-t border-border/40">
                {!isStreaming && (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-accent text-xs font-normal transition"
                      onClick={() =>
                        handlePromptSubmit(
                          "Build a task manager with categories, filter tabs, and status badges",
                          "claude-3-7-sonnet"
                        )
                      }
                    >
                      + Task manager app
                    </Badge>
                    <Badge
                      variant="outline"
                      className="cursor-pointer hover:bg-accent text-xs font-normal transition"
                      onClick={() =>
                        handlePromptSubmit(
                          "Create an interactive analytics revenue card with monthly growth metric",
                          "claude-3-7-sonnet"
                        )
                      }
                    >
                      + Analytics card
                    </Badge>
                  </div>
                )}

                <PromptComposer
                  onSubmit={handlePromptSubmit}
                  onCancel={cancelGeneration}
                  isStreaming={isStreaming}
                />
              </div>
            </div>
          </ChatPanel>
        }
        previewContent={
          <div className="flex h-full w-full flex-col">
            <PreviewToolbar
              activeDevice={device}
              onDeviceChange={setDevice}
              onReload={handleReload}
              currentPath={currentPath}
              onNavigate={handleNavigate}
              isConnected={isConnected}
              sandboxUrl={sandboxUrl}
              isInspectMode={isInspectMode}
              onToggleInspect={handleToggleInspect}
            />

            {previewError && (
              <div className="p-3 bg-muted/40 border-b border-border">
                <PreviewErrorBanner
                  error={previewError}
                  onRepair={(err) => {
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: String(Date.now()),
                        role: "assistant",
                        content: `Initiating automated repair pass for: ${err.message.slice(0, 80)}`,
                      },
                    ]);
                    triggerRepair(err);
                  }}
                  isRepairing={isStreaming && healingTelemetry.status === "in_progress"}
                  remainingRetries={Math.max(0, 3 - healingTelemetry.totalRepairs)}
                  onDismiss={() => setPreviewError(null)}
                />
              </div>
            )}

            <PreviewFrame
              key={iframeKey}
              iframeRef={iframeRef}
              src={sandboxUrl}
              device={device}
              className="flex-1"
            />
          </div>
        }
      />
    </BuilderShell>
  );
}

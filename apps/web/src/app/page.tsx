"use client";

import { STARTER_TEMPLATE_FILES } from "@spark/sandbox";
import type {
  AiProvider,
  BridgeMessage,
  BridgeMessageType,
  DeviceMode,
  PreviewErrorPayload,
  ProjectFile,
  SelectedElementState,
  SnapshotFilesMap,
  SnapshotSummary,
} from "@spark/shared";
import { Database, KeyRound, Lock, Monitor, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DatabaseViewer } from "@/components/database";
import {
  GenerationProgressCard,
  PreviewErrorBanner,
  PromptComposer,
} from "@/components/generation";
import {
  BranchSwitcher,
  CreateBranchDialog,
  InspectModeBanner,
  VersionHistoryDrawer,
} from "@/components/history";
import { InspectorPanel } from "@/components/inspector";
import {
  BuilderShell,
  BuilderWorkbench,
  ChatPanel,
  PreviewFrame,
  PreviewToolbar,
} from "@/components/layout";
import { ApiKeysDialog } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAiSettings } from "@/hooks/useAiSettings";
import { useDatabaseViewer } from "@/hooks/useDatabaseViewer";
import { useGenerationLoop } from "@/hooks/useGenerationLoop";
import { usePreviewBridge } from "@/hooks/usePreviewBridge";
import { useProjectFiles } from "@/hooks/useProjectFiles";
import { useVersionHistory } from "@/hooks/useVersionHistory";
import { cn } from "@/lib/utils";

function parseDependencies(pkgContent?: string): Record<string, string> {
  if (!pkgContent) return {};
  try {
    const parsed = JSON.parse(pkgContent);
    return { ...parsed.dependencies, ...parsed.devDependencies };
  } catch {
    return {};
  }
}

function areDependenciesEqual(pkgA?: string, pkgB?: string): boolean {
  const depsA = JSON.stringify(parseDependencies(pkgA));
  const depsB = JSON.stringify(parseDependencies(pkgB));
  return depsA === depsB;
}

const WORKBENCH_TAB_STORAGE_KEY = "sparkweb:workbench-tab";

export default function BuilderPage() {
  const [projectId] = useState("00000000-0000-0000-0000-000000000001");
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState<"preview" | "database">("preview");

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
      if (stored === "preview" || stored === "database") {
        setActiveWorkbenchTab(stored);
      }
    } catch {
      // Ignore storage access errors in restricted frames
    }
  }, []);

  const handleSelectWorkbenchTab = (tab: "preview" | "database") => {
    setActiveWorkbenchTab(tab);
    try {
      window.sessionStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, tab);
    } catch {
      // Ignore storage access errors
    }
  };
  const [isGenerationStreaming, setIsGenerationStreaming] = useState(false);
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [currentPath, setCurrentPath] = useState("/");
  const [previewError, setPreviewError] = useState<PreviewErrorPayload | null>(null);
  const [isManualRepairSession, setIsManualRepairSession] = useState(false);
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

  const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
  const [branchSourceSnapshotId, setBranchSourceSnapshotId] = useState<string | null>(null);
  const [branchSourceMessage, setBranchSourceMessage] = useState<string | null>(null);
  const [isApiKeysOpen, setIsApiKeysOpen] = useState(false);
  const [highlightedKeyProvider, setHighlightedKeyProvider] = useState<AiProvider | null>(null);

  const aiSettings = useAiSettings();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dbBridgeHandlerRef = useRef<((msg: BridgeMessage) => void) | null>(null);
  const runnerReadyRef = useRef(false);
  const snapshotHydratedRef = useRef(false);
  const bootedCurrentRunnerRef = useRef(false);
  const latestFilesRef = useRef<SnapshotFilesMap>(STARTER_TEMPLATE_FILES);
  const sandboxUrl = process.env.NEXT_PUBLIC_SANDBOX_URL || "/sandbox/runner";

  const { isConnected, sendToPreview, checkPreviewHealth, resetConnection } = usePreviewBridge({
    iframeRef,
    targetUrl: sandboxUrl,
    onMessage: (msg) => {
      if (msg.type === "PREVIEW_HEARTBEAT" && msg.payload.status === "runner_ready") {
        runnerReadyRef.current = true;
        if (snapshotHydratedRef.current && !bootedCurrentRunnerRef.current) {
          bootedCurrentRunnerRef.current = true;
          sendToPreview("PREVIEW_BOOT", { files: latestFilesRef.current });
        }
      } else if (msg.type === "PREVIEW_READY") {
        if (snapshotHydratedRef.current && !bootedCurrentRunnerRef.current) {
          bootedCurrentRunnerRef.current = true;
          sendToPreview("PREVIEW_BOOT", { files: latestFilesRef.current });
        }
      } else if (msg.type === "PREVIEW_NAVIGATE" && typeof msg.payload.path === "string") {
        setCurrentPath(msg.payload.path);
      } else if (msg.type === "PREVIEW_ERROR") {
        const errorData = msg.payload as unknown as PreviewErrorPayload;
        setPreviewError(errorData);
        if (!isGenerationStreaming) {
          setIsManualRepairSession(false);
        }
      } else if (msg.type === "PREVIEW_ELEMENT_SELECT") {
        const element = msg.payload as unknown as SelectedElementState;
        setSelectedElement(element);
      } else if (msg.type === "PREVIEW_UPDATE_TEXT") {
        const payload = msg.payload as { text?: string };
        if (payload?.text) {
          applyTextUpdate(payload.text);
        }
      } else if (msg.type.startsWith("DB_")) {
        dbBridgeHandlerRef.current?.(msg);
      }
    },
  });

  const {
    files,
    setFiles,
    selectedElement,
    setSelectedElement,
    isInspectMode,
    setIsInspectMode,
    applyStyleUpdate,
    applyTextUpdate,
    updateFileContent,
    hasUnsavedCanvasChanges,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectFiles({
    projectId,
    initialFiles: STARTER_TEMPLATE_FILES,
    isStreaming: isGenerationStreaming,
    onWriteFiles: (filesToWrite) => {
      sendToPreview("PREVIEW_WRITE_FILES", { files: filesToWrite });
    },
    onSendBridgeMessage: (type, payload) => {
      sendToPreview(type as BridgeMessageType, payload);
    },
  });

  latestFilesRef.current = files;
  const sendToPreviewRef = useRef(sendToPreview);
  sendToPreviewRef.current = sendToPreview;

  // Hydrate latest project snapshot on mount so full page reloads restore seed.sql and app files
  useEffect(() => {
    let cancelled = false;
    async function hydrateCurrentSnapshot() {
      try {
        const res = await fetch(`/api/projects/${projectId}/snapshots/current`);
        if (!res.ok) return;
        const data = (await res.json()) as { files?: SnapshotFilesMap | null };
        if (!cancelled && data?.files && Object.keys(data.files).length > 0) {
          latestFilesRef.current = data.files;
          setFiles(data.files, { resetHistory: true });
        }
      } catch {
        // Keep starter template fallback if offline or unmocked in unit tests
      } finally {
        if (!cancelled) {
          snapshotHydratedRef.current = true;
          if (runnerReadyRef.current && !bootedCurrentRunnerRef.current) {
            bootedCurrentRunnerRef.current = true;
            sendToPreviewRef.current("PREVIEW_BOOT", { files: latestFilesRef.current });
          }
        }
      }
    }
    hydrateCurrentSnapshot().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, setFiles]);

  const versionHistory = useVersionHistory({
    projectId,
    isStreaming: isGenerationStreaming,
    hasUnsavedCanvasChanges,
    onInspectFiles: (historicalFiles) => {
      const filesList = Object.entries(historicalFiles).map(([path, entry]) => ({
        path,
        content: entry.content,
      }));
      sendToPreview("PREVIEW_WRITE_FILES", { files: filesList });
    },
    onExitInspect: () => {
      const filesList = Object.entries(files).map(([path, entry]) => ({
        path,
        content: entry.content,
      }));
      sendToPreview("PREVIEW_WRITE_FILES", { files: filesList });
    },
    onRollbackComplete: (restoredFiles: SnapshotFilesMap, snapshot: SnapshotSummary) => {
      // Preview reload optimization: if dependencies differ, boot cleanly; else hot reload (AC-7)
      const currentPkg = files["package.json"]?.content;
      const restoredPkg = restoredFiles["package.json"]?.content;
      const depsEqual = areDependenciesEqual(currentPkg, restoredPkg);

      if (!depsEqual) {
        sendToPreview("PREVIEW_BOOT", { files: restoredFiles });
      } else {
        const filesList = Object.entries(restoredFiles).map(([path, entry]) => ({
          path,
          content: entry.content,
        }));
        sendToPreview("PREVIEW_WRITE_FILES", { files: filesList });
      }

      setFiles(restoredFiles);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `Rolled back to snapshot ${snapshot.id.slice(0, 8)}. Preview updated to restored application state.`,
        },
      ]);
    },
    onBranchSwitched: (newFiles: SnapshotFilesMap, branch) => {
      const filesList = Object.entries(newFiles).map(([path, entry]) => ({
        path,
        content: entry.content,
      }));
      sendToPreview("PREVIEW_WRITE_FILES", { files: filesList });
      setFiles(newFiles);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `Switched active branch to ${branch.name}. Loaded branch head code tree.`,
        },
      ]);
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
    onProviderKeyMissing: (provider: AiProvider) => {
      setHighlightedKeyProvider(provider);
      setIsApiKeysOpen(true);
    },
  });

  useEffect(() => {
    setIsGenerationStreaming(isStreaming);
  }, [isStreaming]);

  const databaseViewer = useDatabaseViewer({
    projectId,
    isConnected,
    isStreaming,
    sendToPreview,
    onSeedSnapshotSaved: (snapshotId, sql) => {
      setFiles({
        ...files,
        "seed.sql": { content: sql },
      });
      sendToPreview("PREVIEW_WRITE_FILES", {
        files: [{ path: "seed.sql", content: sql }],
      });
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now()),
          role: "assistant",
          content: `Exported preview database rows to seed.sql and saved snapshot ${snapshotId.slice(0, 8)} (database_seed).`,
        },
      ]);
    },
  });
  dbBridgeHandlerRef.current = databaseViewer.handleBridgeMessage;

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
    setIsManualRepairSession(false);
    setMessages((prev) => [...prev, { id: String(Date.now()), role: "user", content: promptText }]);
    await submitPrompt(promptText, model);
  };

  const [iframeKey, setIframeKey] = useState(0);

  const handleReload = () => {
    if (isConnected) {
      sendToPreview("PREVIEW_RELOAD", {});
      return;
    }
    resetConnection();
    runnerReadyRef.current = false;
    bootedCurrentRunnerRef.current = false;
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
    <BuilderShell
      projectName="Demo Application"
      headerActions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setHighlightedKeyProvider(null);
            setIsApiKeysOpen(true);
          }}
          aria-label="Configure AI API keys"
          className="h-8 gap-1.5 text-xs"
        >
          <KeyRound className="h-3.5 w-3.5 text-indigo-500" />
          <span>API Keys</span>
          {aiSettings.hasKeyForProvider("openrouter") && (
            <Badge
              variant="secondary"
              className="ml-0.5 bg-emerald-500/15 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-300"
            >
              OpenRouter
            </Badge>
          )}
        </Button>
      }
      branchSwitcher={
        <BranchSwitcher
          branches={versionHistory.branches}
          activeBranchId={versionHistory.activeBranchId}
          onSwitchBranch={versionHistory.switchBranch}
          onCreateBranchClick={() => {
            setBranchSourceSnapshotId(null);
            setBranchSourceMessage(null);
            setIsCreateBranchOpen(true);
          }}
          onDeleteBranchClick={versionHistory.deleteBranch}
        />
      }
    >
      <BuilderWorkbench
        isInspectorOpen={
          activeWorkbenchTab === "preview" &&
          !versionHistory.isInspectMode &&
          (isInspectMode || Boolean(selectedElement))
        }
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
                {versionHistory.isInspectMode ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                    <p className="font-semibold mb-1">Inspect Mode Active</p>
                    <p className="text-[11px] text-muted-foreground">
                      Prompt submission and canvas direct edits are locked while inspecting
                      historical versions. Exit inspection or restore this version to make changes.
                    </p>
                  </div>
                ) : (
                  <>
                    {!isStreaming && (
                      <div className="flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          className="cursor-pointer hover:bg-accent text-xs font-normal transition"
                          onClick={() =>
                            handlePromptSubmit(
                              "Build a task manager with categories, filter tabs, and status badges",
                              aiSettings.selectedModel
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
                              aiSettings.selectedModel
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
                      selectedModel={aiSettings.selectedModel}
                      onModelChange={aiSettings.setSelectedModel}
                      openRouterModels={aiSettings.openRouterModels}
                      directModels={aiSettings.directModels}
                      configuredProviders={aiSettings.configuredProviders}
                      openRouterKeyBudget={aiSettings.openRouterKeyBudget}
                      hasOpenRouterKey={aiSettings.hasKeyForProvider("openrouter")}
                      onOpenApiKeys={() => {
                        setHighlightedKeyProvider("openrouter");
                        setIsApiKeysOpen(true);
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          </ChatPanel>
        }
        previewContent={
          <div className="flex h-full w-full flex-col overflow-hidden">
            {/* Top-Level Right Workbench Switcher (Preview | Database) */}
            <div
              role="tablist"
              aria-label="Workbench surface"
              className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card/80 px-3"
            >
              <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-0.5">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeWorkbenchTab === "preview"}
                  onClick={() => handleSelectWorkbenchTab("preview")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeWorkbenchTab === "preview"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Preview</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeWorkbenchTab === "database"}
                  onClick={() => handleSelectWorkbenchTab("database")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeWorkbenchTab === "database"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Database</span>
                  {databaseViewer.viewerMode === "STREAMING_LOCKED" ? (
                    <Lock className="h-3 w-3 text-amber-500" aria-label="Read only locked" />
                  ) : (
                    databaseViewer.isDbReady && (
                      <Badge
                        variant="secondary"
                        className="ml-0.5 h-4 px-1.5 font-mono text-[10px]"
                      >
                        {databaseViewer.tables.length}
                      </Badge>
                    )
                  )}
                </button>
              </div>
            </div>

            {/* Preview Container stays permanently mounted in DOM via CSS hidden (AC-4) */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                activeWorkbenchTab !== "preview" && "hidden"
              )}
              aria-hidden={activeWorkbenchTab !== "preview"}
            >
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
                isHistoryOpen={versionHistory.isDrawerOpen}
                onToggleHistory={versionHistory.toggleDrawer}
              />

              {/* Inspect Mode Banner (AC-6) */}
              {versionHistory.isInspectMode && versionHistory.inspectSnapshotId && (
                <InspectModeBanner
                  snapshotId={versionHistory.inspectSnapshotId}
                  snapshotMessage={
                    versionHistory.snapshots.find((s) => s.id === versionHistory.inspectSnapshotId)
                      ?.message
                  }
                  onRestore={() => {
                    if (versionHistory.inspectSnapshotId) {
                      versionHistory.executeRollback(versionHistory.inspectSnapshotId);
                    }
                  }}
                  onBranchFromHere={() => {
                    if (versionHistory.inspectSnapshotId) {
                      const snap = versionHistory.snapshots.find(
                        (s) => s.id === versionHistory.inspectSnapshotId
                      );
                      setBranchSourceSnapshotId(versionHistory.inspectSnapshotId);
                      setBranchSourceMessage(snap?.message || null);
                      setIsCreateBranchOpen(true);
                    }
                  }}
                  onExit={versionHistory.exitInspectMode}
                  isRollingBack={versionHistory.isRollingBack}
                />
              )}

              {previewError && (
                <div className="p-3 bg-muted/40 border-b border-border">
                  <PreviewErrorBanner
                    error={previewError}
                    onRepair={(err) => {
                      setIsManualRepairSession(true);
                      setMessages((prev) => [
                        ...prev,
                        {
                          id: String(Date.now()),
                          role: "assistant",
                          content: `Initiating automated repair pass for: ${err.message.slice(0, 80)}`,
                        },
                      ]);
                      triggerRepair(err, aiSettings.selectedModel);
                    }}
                    isRepairing={isStreaming && healingTelemetry.status === "in_progress"}
                    remainingRetries={
                      isManualRepairSession ? Math.max(0, 3 - healingTelemetry.totalRepairs) : 3
                    }
                    onDismiss={() => {
                      setPreviewError(null);
                      setIsManualRepairSession(false);
                    }}
                  />
                </div>
              )}

              <PreviewFrame
                key={iframeKey}
                iframeRef={iframeRef}
                src={sandboxUrl}
                device={device}
                className="flex-1"
                onLoad={() => {
                  if (!runnerReadyRef.current) {
                    sendToPreview("PREVIEW_HEARTBEAT", { ping: true });
                  }
                }}
              />
            </div>

            {/* Managed Database Viewer Panel stays mounted with CSS hidden to preserve subview/console state */}
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                activeWorkbenchTab !== "database" && "hidden"
              )}
              aria-hidden={activeWorkbenchTab !== "database"}
            >
              <DatabaseViewer
                viewerMode={databaseViewer.viewerMode}
                tables={databaseViewer.tables}
                selectedTable={databaseViewer.selectedTable}
                selectedTableName={databaseViewer.selectedTableName}
                isIntrospecting={databaseViewer.isIntrospecting}
                introspectError={databaseViewer.introspectError}
                rows={databaseViewer.rows}
                totalCount={databaseViewer.totalCount}
                page={databaseViewer.page}
                pageSize={databaseViewer.pageSize}
                sortColumn={databaseViewer.sortColumn}
                sortDirection={databaseViewer.sortDirection}
                searchQuery={databaseViewer.searchQuery}
                isLoadingRows={databaseViewer.isLoadingRows}
                rowsError={databaseViewer.rowsError}
                savedQueries={databaseViewer.savedQueries}
                isLoadingQueries={databaseViewer.isLoadingQueries}
                isExportingSeed={databaseViewer.isExportingSeed}
                seedFeedback={databaseViewer.seedFeedback}
                onDismissSeedFeedback={() => databaseViewer.setSeedFeedback(null)}
                onSelectTable={databaseViewer.handleSelectTable}
                onPageChange={databaseViewer.setPage}
                onPageSizeChange={databaseViewer.setPageSize}
                onSortChange={databaseViewer.handleSortChange}
                onSearchChange={databaseViewer.handleSearchChange}
                onRefreshAll={() => {
                  databaseViewer.refreshActiveView().catch(() => {});
                }}
                onExecuteMutation={databaseViewer.executeMutation}
                onExecuteRawSql={databaseViewer.executeRawSql}
                onSaveSnippet={databaseViewer.saveQuerySnippet}
                onUpdateSnippet={databaseViewer.updateQuerySnippet}
                onDeleteSnippet={databaseViewer.deleteQuerySnippet}
                onSaveSeedData={databaseViewer.exportAndSaveSeed}
                onAskSparkSchema={(prompt) => {
                  handlePromptSubmit(prompt, aiSettings.selectedModel);
                }}
              />
            </div>
          </div>
        }
      />

      {/* Version History Sliding Drawer (AC-5, AC-6) */}
      <VersionHistoryDrawer
        isOpen={versionHistory.isDrawerOpen}
        onClose={versionHistory.closeDrawer}
        snapshots={versionHistory.filteredSnapshots}
        activeSnapshotId={
          versionHistory.activeBranchId
            ? versionHistory.branches.find((b) => b.id === versionHistory.activeBranchId)
                ?.headSnapshotId
            : null
        }
        inspectSnapshotId={versionHistory.inspectSnapshotId}
        inspectDiff={versionHistory.inspectDiff}
        isLoadingSnapshots={versionHistory.isLoadingSnapshots}
        isLoadingDiff={versionHistory.isLoadingDiff}
        nextCursor={versionHistory.nextCursor}
        onLoadMore={versionHistory.loadMoreSnapshots}
        onInspectSnapshot={versionHistory.enterInspectMode}
        onExitInspect={versionHistory.exitInspectMode}
        onRollbackSnapshot={(id) => versionHistory.executeRollback(id)}
        onBranchFromSnapshot={(id, msg) => {
          setBranchSourceSnapshotId(id);
          setBranchSourceMessage(msg);
          setIsCreateBranchOpen(true);
        }}
        onSaveCheckpoint={(msg, tag) => versionHistory.createManualCheckpoint(files, msg, tag)}
        searchQuery={versionHistory.searchQuery}
        onSearchQueryChange={versionHistory.setSearchQuery}
        selectedTriggerFilter={versionHistory.selectedTriggerFilter}
        onTriggerFilterChange={versionHistory.setSelectedTriggerFilter}
      />

      {/* Create Branch Modal (AC-4) */}
      <CreateBranchDialog
        isOpen={isCreateBranchOpen}
        onClose={() => {
          setIsCreateBranchOpen(false);
          setBranchSourceSnapshotId(null);
          setBranchSourceMessage(null);
        }}
        onSubmit={async (name, switchActive) => {
          const b = await versionHistory.createBranch(
            name,
            branchSourceSnapshotId || undefined,
            switchActive
          );
          return Boolean(b);
        }}
        fromSnapshotId={branchSourceSnapshotId}
        fromSnapshotMessage={branchSourceMessage}
      />

      {/* AI Provider API Keys Modal (OpenRouter & Direct Providers) */}
      <ApiKeysDialog
        open={isApiKeysOpen}
        onOpenChange={(open) => {
          setIsApiKeysOpen(open);
          if (!open) {
            setHighlightedKeyProvider(null);
          }
        }}
        configuredKeys={aiSettings.configuredKeys}
        envProviders={aiSettings.envProviders}
        highlightedProvider={highlightedKeyProvider}
        onSaveKey={aiSettings.saveApiKey}
        onRemoveKey={aiSettings.removeApiKey}
      />
    </BuilderShell>
  );
}

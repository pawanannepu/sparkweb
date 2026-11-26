"use client";

import { upgradeLegacyDbTemplate, WebContainerRunner } from "@spark/sandbox";
import type {
  BridgeMessage,
  PreviewBootPayload,
  PreviewErrorPayload,
  PreviewStatus,
  PreviewWriteFilesPayload,
} from "@spark/shared";
import { AlertCircle, Loader2, Sparkles, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export default function SandboxRunnerPage() {
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ id: string; text: string }>>([]);
  const [error, setError] = useState<PreviewErrorPayload | null>(null);
  const runnerRef = useRef<WebContainerRunner | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  previewUrlRef.current = previewUrl;
  const latestErrorRef = useRef<PreviewErrorPayload | null>(null);
  const writeSeqRef = useRef(0);
  const hmrCompletedForSeqRef = useRef(-1);
  const pendingHealthCheckRef = useRef<{
    timeoutId: NodeJS.Timeout;
    resolve: (healthy: boolean, err?: PreviewErrorPayload) => void;
  } | null>(null);

  useEffect(() => {
    // Only execute inside browser
    if (typeof window === "undefined") return;

    const postToHost = (type: BridgeMessage["type"], payload: Record<string, unknown> = {}) => {
      if (window.parent && window.parent !== window) {
        const msg: BridgeMessage = {
          protocol: "sparkweb:bridge:v1",
          type,
          source: "sparkweb:sandbox",
          payload,
          timestamp: Date.now(),
        };
        window.parent.postMessage(msg, "*");
      }
    };

    const hasErrorOverlay = (): boolean => {
      try {
        const iframe = document.getElementById("sandbox-app-frame") as HTMLIFrameElement | null;
        if (iframe?.contentDocument) {
          const overlay = iframe.contentDocument.querySelector("vite-error-overlay");
          if (overlay) return true;
        }
      } catch {
        // Cross origin fallback
      }
      return false;
    };

    const runner = new WebContainerRunner({
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
        if (newStatus === "error" && pendingHealthCheckRef.current) {
          const errPayload = latestErrorRef.current || {
            message: "Runner transitioned to error status",
          };
          pendingHealthCheckRef.current.resolve(false, errPayload);
        }
      },
      onReady: (url) => {
        setPreviewUrl(url);
        postToHost("PREVIEW_READY", { url });
      },
      onError: (err) => {
        setError(err);
        latestErrorRef.current = err;
        postToHost("PREVIEW_ERROR", err as unknown as Record<string, unknown>);
        if (pendingHealthCheckRef.current) {
          pendingHealthCheckRef.current.resolve(false, err);
        }
      },
      onLog: (line) => {
        setLogs((prev) => [
          ...prev.slice(-100),
          { id: `${Date.now()}-${Math.random()}`, text: line },
        ]);
      },
    });

    runnerRef.current = runner;

    const handleMessage = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object" || data.protocol !== "sparkweb:bridge:v1") {
        return;
      }

      const msg = data as BridgeMessage;

      // Check if message came from parent host
      const isFromParent = event.source === window.parent;

      if (isFromParent) {
        if (msg.type === "PREVIEW_BOOT") {
          try {
            const payload = msg.payload as unknown as PreviewBootPayload;
            const bootFiles = payload?.files ? upgradeLegacyDbTemplate(payload.files) : undefined;
            if (runner.getStatus() === "idle") {
              await runner.boot(bootFiles);
            } else if (bootFiles && Object.keys(bootFiles).length > 0) {
              // If auto-boot already started before PREVIEW_BOOT arrived, wait for it to finish
              // (if still booting/installing) then apply hydrated files and reload the frame.
              if (runner.getStatus() !== "running") {
                await runner.boot();
              }
              const fileList = Object.entries(bootFiles).map(([path, entry]) => ({
                path,
                content: entry.content,
              }));
              await runner.applyFileUpdates(fileList);
              if (previewUrlRef.current) {
                const iframe = document.getElementById("sandbox-app-frame") as HTMLIFrameElement;
                if (iframe) {
                  iframe.src = previewUrlRef.current;
                }
              }
            }
          } catch (err: unknown) {
            console.error("Runner boot error:", err);
          }
        } else if (msg.type === "PREVIEW_HEARTBEAT") {
          if (runner.getStatus() === "idle") {
            postToHost("PREVIEW_HEARTBEAT", { status: "runner_ready" });
          }
        } else if (msg.type === "PREVIEW_WRITE_FILES") {
          try {
            const payload = msg.payload as unknown as PreviewWriteFilesPayload;
            if (payload?.files && payload.files.length > 0) {
              writeSeqRef.current += 1;
              latestErrorRef.current = null;
              setError(null);
              await runner.applyFileUpdates(payload.files);
            }
          } catch (err: unknown) {
            console.error("Failed to write files to sandbox:", err);
          }
        } else if (msg.type === "PREVIEW_HEALTH_CHECK") {
          const payload = msg.payload as { timeoutMs?: number };
          const timeoutMs = payload?.timeoutMs || 4000;

          if (pendingHealthCheckRef.current) {
            clearTimeout(pendingHealthCheckRef.current.timeoutId);
          }

          const resolveHealthCheck = (healthy: boolean, err?: PreviewErrorPayload) => {
            if (pendingHealthCheckRef.current) {
              clearTimeout(pendingHealthCheckRef.current.timeoutId);
              pendingHealthCheckRef.current = null;
            }
            postToHost("PREVIEW_HEALTH_STATUS", {
              healthy,
              ...(err ? { error: err } : {}),
            });
          };

          const evaluateCurrentHealth = () => {
            const overlayPresent = hasErrorOverlay();
            if (overlayPresent || latestErrorRef.current || runner.getStatus() === "error") {
              const reportError = latestErrorRef.current || {
                message: overlayPresent
                  ? "Vite error overlay detected in preview DOM"
                  : "Health check timed out with preview error",
              };
              resolveHealthCheck(false, reportError);
            } else {
              resolveHealthCheck(true);
            }
          };

          // If HMR already completed for the latest file write before health check arrived,
          // resolve after a brief 50ms settle window instead of waiting the full fallback timeout.
          const effectiveTimeout =
            writeSeqRef.current > 0 && hmrCompletedForSeqRef.current === writeSeqRef.current
              ? Math.min(timeoutMs, 50)
              : timeoutMs;

          const timeoutId = setTimeout(evaluateCurrentHealth, effectiveTimeout);

          pendingHealthCheckRef.current = {
            timeoutId,
            resolve: resolveHealthCheck,
          };
        } else if (msg.type === "PREVIEW_RELOAD") {
          if (previewUrlRef.current) {
            const iframe = document.getElementById("sandbox-app-frame") as HTMLIFrameElement;
            if (iframe) {
              iframe.src = previewUrlRef.current;
            }
          }
        } else if (
          msg.type === "PREVIEW_INSPECT_MODE" ||
          msg.type === "PREVIEW_INJECT_STYLES" ||
          msg.type === "PREVIEW_UPDATE_TEXT" ||
          msg.type === "DB_INTROSPECT_REQUEST" ||
          msg.type === "DB_QUERY_REQUEST" ||
          msg.type === "DB_MUTATE_REQUEST" ||
          msg.type === "DB_EXPORT_SEED_REQUEST" ||
          msg.type === "DB_MUTATED_EVENT"
        ) {
          // Forward inspector and database bridge commands from host down to application iframe
          const iframe = document.getElementById("sandbox-app-frame") as HTMLIFrameElement;
          if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(msg, "*");
          }
        }
      } else {
        // Message originated from inner application iframe -> forward upstream to parent host
        if (msg.type === "PREVIEW_ERROR") {
          const errPayload = msg.payload as unknown as PreviewErrorPayload;
          setError(errPayload);
          latestErrorRef.current = errPayload;
          postToHost("PREVIEW_ERROR", msg.payload);
          if (pendingHealthCheckRef.current) {
            pendingHealthCheckRef.current.resolve(false, errPayload);
          }
        } else if (msg.type === "PREVIEW_HMR_COMPLETE") {
          hmrCompletedForSeqRef.current = writeSeqRef.current;
          postToHost("PREVIEW_HMR_COMPLETE", msg.payload);
          if (pendingHealthCheckRef.current) {
            setTimeout(() => {
              const overlay = hasErrorOverlay();
              if (overlay || latestErrorRef.current) {
                pendingHealthCheckRef.current?.resolve(
                  false,
                  latestErrorRef.current || { message: "Error overlay detected after HMR update" }
                );
              } else {
                pendingHealthCheckRef.current?.resolve(true);
              }
            }, 50);
          }
        } else if (
          msg.type === "PREVIEW_ELEMENT_HOVER" ||
          msg.type === "PREVIEW_ELEMENT_SELECT" ||
          msg.type === "PREVIEW_UPDATE_TEXT" ||
          msg.type === "PREVIEW_NAVIGATE" ||
          msg.type === "DB_READY_EVENT" ||
          msg.type === "DB_INTROSPECT_RESPONSE" ||
          msg.type === "DB_QUERY_RESPONSE" ||
          msg.type === "DB_MUTATE_RESPONSE" ||
          msg.type === "DB_MUTATED_EVENT" ||
          msg.type === "DB_EXPORT_SEED_RESPONSE"
        ) {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(msg, "*");
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    postToHost("PREVIEW_HEARTBEAT", { status: "runner_ready" });

    // Give the parent host window time to hydrate the project snapshot and send PREVIEW_BOOT
    // before falling back to booting the starter template directly.
    const isEmbedded = window.parent && window.parent !== window;
    const bootTimer = setTimeout(
      () => {
        if (runner.getStatus() === "idle") {
          runner.boot().catch((err) => {
            console.warn("Auto boot error", err);
          });
        }
      },
      isEmbedded ? 6000 : 500
    );

    return () => {
      clearTimeout(bootTimer);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  if (previewUrl && status === "running") {
    return (
      <iframe
        id="sandbox-app-frame"
        src={previewUrl}
        title="WebContainer Application"
        className="h-screen w-screen border-0 bg-background"
        allow="autoplay; camera; microphone; geolocation"
      />
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl backdrop-blur-md">
        <div className="mb-6 flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600/20 text-indigo-400 ring-1 ring-indigo-500/30">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Sparkweb Sandbox</h2>
              <p className="text-xs text-slate-400">WebAssembly Node.js Runtime</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                status === "running"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : status === "error"
                    ? "bg-rose-500/10 text-rose-400"
                    : "bg-indigo-500/10 text-indigo-400"
              }`}
            >
              {status}
            </span>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-rose-900/50 bg-rose-950/30 p-4 text-xs text-rose-300">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4 text-rose-400" />
              Runtime Diagnostic
            </div>
            <p className="mt-2 font-mono whitespace-pre-wrap">{error.message}</p>
            {error.filename && (
              <p className="mt-1 text-slate-400">
                Location: {error.filename}:{error.line}:{error.column}
              </p>
            )}
          </div>
        ) : (
          <div className="mb-6 flex flex-col items-center justify-center py-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="mt-4 text-sm font-medium text-slate-300">
              {status === "booting" && "Mounting virtual file system and booting container..."}
              {status === "installing" && "Resolving template packages via npm..."}
              {status === "idle" && "Initializing preview environment..."}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Vite dev server starting in browser WebAssembly
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
            <Terminal className="h-3.5 w-3.5" />
            <span>Terminal Output</span>
          </div>
          <div className="max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-400">
            {logs.length === 0 ? (
              <span className="text-slate-600">Waiting for process logs...</span>
            ) : (
              logs.map((item) => (
                <div key={item.id} className="whitespace-pre-wrap">
                  {item.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

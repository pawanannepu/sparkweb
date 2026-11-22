"use client";

import { WebContainerRunner } from "@spark/sandbox";
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

    const runner = new WebContainerRunner({
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
      },
      onReady: (url) => {
        setPreviewUrl(url);
        postToHost("PREVIEW_READY", { url });
      },
      onError: (err) => {
        setError(err);
        postToHost("PREVIEW_ERROR", err as unknown as Record<string, unknown>);
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

      if (msg.type === "PREVIEW_BOOT") {
        try {
          const payload = msg.payload as unknown as PreviewBootPayload;
          await runner.boot(payload?.files);
        } catch (err: unknown) {
          console.error("Runner boot error:", err);
        }
      } else if (msg.type === "PREVIEW_WRITE_FILES") {
        try {
          const payload = msg.payload as unknown as PreviewWriteFilesPayload;
          if (payload?.files && payload.files.length > 0) {
            await runner.applyFileUpdates(payload.files);
          }
        } catch (err: unknown) {
          console.error("Failed to write files to sandbox:", err);
        }
      } else if (msg.type === "PREVIEW_RELOAD") {
        if (previewUrl) {
          // Trigger reload of internal application frame
          const iframe = document.getElementById("sandbox-app-frame") as HTMLIFrameElement;
          if (iframe) {
            iframe.src = previewUrl;
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);

    // Automatically boot on load if not explicitly booted within 2 seconds
    const bootTimer = setTimeout(() => {
      if (runner.getStatus() === "idle") {
        runner.boot().catch((err) => {
          console.warn("Auto boot error", err);
        });
      }
    }, 1500);

    return () => {
      clearTimeout(bootTimer);
      window.removeEventListener("message", handleMessage);
    };
  }, [previewUrl]);

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

"use client";

import type { PreviewErrorPayload } from "@spark/shared";
import { AlertCircle, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PreviewErrorBannerProps {
  error: PreviewErrorPayload | null;
  onDismiss?: () => void;
  className?: string;
}

export function PreviewErrorBanner({ error, onDismiss, className }: PreviewErrorBannerProps) {
  if (!error) return null;

  return (
    <div
      className={`relative flex items-start gap-3 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3.5 text-xs text-rose-200 shadow-sm backdrop-blur-sm ${
        className || ""
      }`}
    >
      <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 font-semibold text-rose-300">
          <span>Preview Compilation Warning</span>
          {error.filename && (
            <span className="rounded bg-rose-900/50 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
              {error.filename}
              {error.line !== undefined ? `:${error.line}` : ""}
            </span>
          )}
        </div>
        <p className="font-mono text-[11px] leading-relaxed text-rose-200/90 whitespace-pre-wrap">
          {error.message}
        </p>
        <div className="flex items-center gap-1.5 pt-1 text-[11px] text-rose-300/80">
          <Wrench className="h-3 w-3" />
          <span>Prompt sparkweb to repair this syntax issue, or edit the file directly.</span>
        </div>
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="h-6 w-6 p-0 text-rose-400 hover:bg-rose-900/40 hover:text-rose-200"
        >
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Dismiss</span>
        </Button>
      )}
    </div>
  );
}

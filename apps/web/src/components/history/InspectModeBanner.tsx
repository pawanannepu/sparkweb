"use client";

import { Eye, GitBranch, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface InspectModeBannerProps {
  snapshotId: string;
  snapshotMessage?: string | null;
  onRestore: () => void;
  onBranchFromHere: () => void;
  onExit: () => void;
  isRollingBack?: boolean;
}

export function InspectModeBanner({
  snapshotId,
  snapshotMessage,
  onRestore,
  onBranchFromHere,
  onExit,
  isRollingBack = false,
}: InspectModeBannerProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-950 dark:text-amber-200 transition-colors shadow-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
          <Eye className="h-3.5 w-3.5" />
        </div>
        <span>
          Inspecting historical snapshot{" "}
          <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[11px] font-bold">
            {snapshotId.slice(0, 8)}
          </code>
          {snapshotMessage ? `: ${snapshotMessage}` : ""}
        </span>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider">
          Read only preview
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onBranchFromHere}
          className="h-7 gap-1.5 border-amber-500/40 bg-background/80 hover:bg-amber-500/10 text-xs font-medium"
        >
          <GitBranch className="h-3 w-3" />
          <span>Branch</span>
        </Button>

        <Button
          size="sm"
          onClick={onRestore}
          disabled={isRollingBack}
          className="h-7 gap-1.5 bg-amber-600 text-white hover:bg-amber-700 text-xs font-semibold shadow-sm"
        >
          <RotateCcw className="h-3 w-3" />
          <span>{isRollingBack ? "Restoring..." : "Restore version"}</span>
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={onExit}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          aria-label="Exit inspect mode"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

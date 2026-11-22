"use client";

import type { FileOperation, PlanStep } from "@spark/shared";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileCode2,
  Loader2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface GenerationProgressCardProps {
  isStreaming: boolean;
  planSteps: PlanStep[];
  fileOperations: FileOperation[];
  className?: string;
}

export function GenerationProgressCard({
  isStreaming,
  planSteps,
  fileOperations,
  className,
}: GenerationProgressCardProps) {
  const [showDiff, setShowDiff] = useState(false);

  if (planSteps.length === 0 && fileOperations.length === 0 && !isStreaming) {
    return null;
  }

  const completedSteps = planSteps.filter((s) => s.status === "completed").length;
  const totalSteps = planSteps.length;

  return (
    <div
      className={`rounded-xl border border-border/80 bg-card/90 p-4 shadow-sm backdrop-blur-sm space-y-4 ${
        className || ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isStreaming ? "Generation In Progress" : "Generation Complete"}
          </span>
        </div>
        {totalSteps > 0 && (
          <span className="text-xs font-mono text-muted-foreground">
            {completedSteps}/{totalSteps} steps
          </span>
        )}
      </div>

      {/* Plan Milestones Checklist */}
      {planSteps.length > 0 && (
        <div className="space-y-2">
          {planSteps.map((step) => (
            <div key={step.id} className="flex items-start gap-2.5 text-xs leading-relaxed">
              {step.status === "completed" && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              )}
              {step.status === "running" && (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400 mt-0.5" />
              )}
              {step.status === "pending" && (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40 mt-0.5" />
              )}
              {step.status === "failed" && (
                <XCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              )}
              <span
                className={`${
                  step.status === "completed"
                    ? "text-foreground font-medium"
                    : step.status === "running"
                      ? "text-indigo-400 font-semibold"
                      : "text-muted-foreground"
                }`}
              >
                {step.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Active File Operations Pills */}
      {fileOperations.length > 0 && (
        <div className="pt-2 border-t border-border/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Files Changed</span>
            {fileOperations.some((op) => op.diff) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDiff((prev) => !prev)}
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <span>{showDiff ? "Hide diff" : "Show diff"}</span>
                {showDiff ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {fileOperations.map((op) => (
              <Badge
                key={op.path}
                variant="outline"
                className="gap-1.5 py-0.5 px-2 text-[11px] font-mono bg-muted/30"
              >
                <FileCode2 className="h-3 w-3 text-indigo-400" />
                <span>{op.path}</span>
                <span className="text-[10px] text-muted-foreground uppercase">{op.op}</span>
              </Badge>
            ))}
          </div>

          {/* Expandable Code Diff Preview */}
          {showDiff && (
            <div className="mt-2 rounded-lg border border-border bg-slate-950 p-2.5 font-mono text-[11px] text-slate-300 max-h-40 overflow-y-auto">
              {fileOperations.map((op) => (
                <div key={op.path} className="mb-2 last:mb-0">
                  <div className="text-indigo-400 font-semibold border-b border-slate-800 pb-1 mb-1">
                    --- {op.path} ({op.op})
                  </div>
                  <pre className="whitespace-pre-wrap text-emerald-400">
                    {op.diff || "+ full file write completed"}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

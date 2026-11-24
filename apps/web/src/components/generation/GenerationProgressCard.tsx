"use client";

import type { FileOperation, HealingTelemetry, PlanStep } from "@spark/shared";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileCode2,
  Loader2,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface GenerationProgressCardProps {
  isStreaming: boolean;
  planSteps: PlanStep[];
  fileOperations: FileOperation[];
  healingTelemetry?: HealingTelemetry;
  className?: string;
}

export function GenerationProgressCard({
  isStreaming,
  planSteps,
  fileOperations,
  healingTelemetry,
  className,
}: GenerationProgressCardProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [showHealing, setShowHealing] = useState(true);

  if (
    planSteps.length === 0 &&
    fileOperations.length === 0 &&
    !isStreaming &&
    (!healingTelemetry || healingTelemetry.status === "none")
  ) {
    return null;
  }

  const completedSteps = planSteps.filter((s) => s.status === "completed").length;
  const totalSteps = planSteps.length;
  const hasHealingData =
    healingTelemetry &&
    (healingTelemetry.status !== "none" || healingTelemetry.attempts.length > 0);

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

      {/* Self Healing Verification Card (AC-5) */}
      {hasHealingData && (
        <div className="pt-2 border-t border-border/60 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {healingTelemetry?.status === "in_progress" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              )}
              {healingTelemetry?.status === "healed" && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
              {healingTelemetry?.status === "exhausted" && (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
              )}
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-indigo-400" />
                <span>
                  {healingTelemetry?.status === "in_progress" &&
                    `Self healing in progress (${healingTelemetry.attempts.length}/3)`}
                  {healingTelemetry?.status === "healed" &&
                    `Self healed successfully (${healingTelemetry.totalRepairs} repair${
                      healingTelemetry.totalRepairs > 1 ? "s" : ""
                    })`}
                  {healingTelemetry?.status === "exhausted" &&
                    "Self healing attempts exhausted (3 attempt limit)"}
                </span>
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHealing((prev) => !prev)}
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <span>{showHealing ? "Hide details" : "Show details"}</span>
              {showHealing ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          </div>

          {showHealing && healingTelemetry && (
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs">
              {healingTelemetry.attempts.map((attempt) => (
                <div
                  key={`${attempt.attemptIndex}-${attempt.errorFingerprint}`}
                  className="rounded border border-border/60 bg-background/80 p-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-foreground text-[11px]">
                        Attempt #{attempt.attemptIndex}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 capitalize font-mono"
                      >
                        {attempt.category}
                      </Badge>
                      {attempt.filePath && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {attempt.filePath}
                          {attempt.line !== undefined ? `:${attempt.line}` : ""}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-medium capitalize ${
                        attempt.status === "resolved"
                          ? "text-emerald-400"
                          : attempt.status === "patching"
                            ? "text-indigo-400"
                            : attempt.status === "unfixable"
                              ? "text-rose-400"
                              : "text-muted-foreground"
                      }`}
                    >
                      {attempt.status}
                    </span>
                  </div>

                  <p className="font-mono text-[10px] leading-relaxed text-muted-foreground bg-slate-950/60 p-1.5 rounded border border-border/40 whitespace-pre-wrap">
                    {attempt.message}
                  </p>

                  {attempt.patchFiles.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Wrench className="h-2.5 w-2.5" /> Patched:
                      </span>
                      {attempt.patchFiles.map((path) => (
                        <Badge
                          key={path}
                          variant="outline"
                          className="text-[10px] px-1 py-0 font-mono text-indigo-400 border-indigo-500/30"
                        >
                          {path}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import type { SnapshotDiffResult, SnapshotSummary, SnapshotTrigger } from "@spark/shared";
import {
  Bookmark,
  Clock,
  Eye,
  GitBranch,
  History,
  MousePointerClick,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { CodeDiffViewer } from "./CodeDiffViewer";
import { CreateCheckpointDialog } from "./CreateCheckpointDialog";

export interface VersionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: SnapshotSummary[];
  activeSnapshotId?: string | null;
  inspectSnapshotId?: string | null;
  inspectDiff?: SnapshotDiffResult | null;
  isLoadingSnapshots?: boolean;
  isLoadingDiff?: boolean;
  nextCursor?: string | null;
  onLoadMore?: () => void;
  onInspectSnapshot: (snapshotId: string) => void;
  onExitInspect: () => void;
  onRollbackSnapshot: (snapshotId: string) => void;
  onBranchFromSnapshot: (snapshotId: string, message: string) => void;
  onSaveCheckpoint: (message: string, tag?: string) => Promise<boolean | undefined>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  selectedTriggerFilter: SnapshotTrigger | "all";
  onTriggerFilterChange: (trigger: SnapshotTrigger | "all") => void;
  className?: string;
}

export function VersionHistoryDrawer({
  isOpen,
  onClose,
  snapshots,
  activeSnapshotId,
  inspectSnapshotId,
  inspectDiff,
  isLoadingSnapshots = false,
  nextCursor,
  onLoadMore,
  onInspectSnapshot,
  onExitInspect,
  onRollbackSnapshot,
  onBranchFromSnapshot,
  onSaveCheckpoint,
  searchQuery,
  onSearchQueryChange,
  selectedTriggerFilter,
  onTriggerFilterChange,
  className,
}: VersionHistoryDrawerProps) {
  const [isCheckpointDialogOpen, setIsCheckpointDialogOpen] = useState(false);

  // Group snapshots into relative time categories
  const groupedSnapshots = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const pastSevenDays = today - 7 * 86400000;

    const groups: Record<string, SnapshotSummary[]> = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      Older: [],
    };

    for (const snap of snapshots) {
      const snapTime = new Date(snap.createdAt).getTime();
      if (snapTime >= today) {
        groups.Today.push(snap);
      } else if (snapTime >= yesterday) {
        groups.Yesterday.push(snap);
      } else if (snapTime >= pastSevenDays) {
        groups["Previous 7 Days"].push(snap);
      } else {
        groups.Older.push(snap);
      }
    }

    return Object.entries(groups).filter(([_, items]) => items.length > 0);
  }, [snapshots]);

  const getTriggerMeta = (trigger: SnapshotTrigger) => {
    switch (trigger) {
      case "canvas":
        return {
          label: "Canvas",
          icon: MousePointerClick,
          badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
        };
      case "repair":
        return {
          label: "Repair",
          icon: Wrench,
          badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
        };
      case "manual":
        return {
          label: "Manual",
          icon: Bookmark,
          badgeClass:
            "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
        };
      case "rollback":
        return {
          label: "Rollback",
          icon: RotateCcw,
          badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
        };
      default:
        return {
          label: "Generation",
          icon: Sparkles,
          badgeClass: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
        };
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Sliding Drawer Container */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-full max-w-xl md:max-w-2xl flex-col border-r border-border bg-card shadow-2xl backdrop-blur transition-all duration-300",
          className
        )}
        role="dialog"
        aria-label="Version history snapshots"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-card/80">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-foreground">Version History</h2>
              <p className="text-[11px] text-muted-foreground">
                Time travel, browse code diffs, or roll back past checkpoints
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsCheckpointDialogOpen(true)}
              className="h-8 gap-1.5 text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Checkpoint</span>
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Close history drawer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="border-b border-border bg-muted/20 p-3 space-y-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search by prompt, message, tag, or id..."
              className="h-8 pl-8 pr-7 text-xs bg-background/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchQueryChange("")}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Trigger Filter Pills */}
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-muted-foreground text-[10px] font-semibold uppercase mr-1">
              Filter:
            </span>
            {(["all", "generation", "canvas", "repair", "manual", "rollback"] as const).map(
              (trigger) => (
                <button
                  key={trigger}
                  type="button"
                  onClick={() => onTriggerFilterChange(trigger)}
                  className={cn(
                    "px-2 py-0.5 rounded-full capitalize font-medium transition-colors",
                    selectedTriggerFilter === trigger
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {trigger}
                </button>
              )
            )}
          </div>
        </div>

        {/* Main Content Area: Timeline or Diff Viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {inspectSnapshotId && inspectDiff ? (
            /* Inline Diff Inspection View */
            <div className="flex-1 flex flex-col overflow-hidden p-3 gap-2">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    Inspecting {inspectSnapshotId.slice(0, 8)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Side by side diff</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const snap = snapshots.find((s) => s.id === inspectSnapshotId);
                      onBranchFromSnapshot(inspectSnapshotId, snap?.message || "");
                    }}
                    className="h-7 text-xs gap-1"
                  >
                    <GitBranch className="h-3 w-3" />
                    <span>Branch</span>
                  </Button>

                  <Button
                    size="sm"
                    onClick={() => onRollbackSnapshot(inspectSnapshotId)}
                    className="h-7 text-xs gap-1 bg-amber-600 text-white hover:bg-amber-700"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Rollback</span>
                  </Button>

                  <Button size="sm" variant="ghost" onClick={onExitInspect} className="h-7 text-xs">
                    Close diff
                  </Button>
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <CodeDiffViewer diffResult={inspectDiff} className="h-full" />
              </div>
            </div>
          ) : (
            /* Chronological Timeline */
            <ScrollArea className="flex-1 p-4">
              {isLoadingSnapshots && snapshots.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground">
                  Loading snapshots...
                </div>
              ) : snapshots.length === 0 ? (
                <div className="p-12 text-center text-xs text-muted-foreground space-y-1">
                  <History className="h-8 w-8 mx-auto opacity-30 mb-2" />
                  <p className="font-semibold text-foreground">No snapshots found</p>
                  <p>Snapshots are recorded automatically as you generate or edit code.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedSnapshots.map(([groupName, groupItems]) => (
                    <div key={groupName} className="space-y-2">
                      <div className="sticky top-0 z-10 bg-card/90 py-1 backdrop-blur text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        <span>{groupName}</span>
                        <div className="h-[1px] flex-1 bg-border/60" />
                      </div>

                      <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-border/60">
                        {groupItems.map((snapshot) => {
                          const meta = getTriggerMeta(snapshot.trigger);
                          const TriggerIcon = meta.icon;
                          const isCurrentHead = snapshot.id === activeSnapshotId;
                          const isInspecting = snapshot.id === inspectSnapshotId;

                          return (
                            <div
                              key={snapshot.id}
                              className={cn(
                                "relative group rounded-lg border p-3 transition-all bg-card/60 hover:bg-card hover:shadow-sm",
                                isCurrentHead && "border-primary/50 bg-primary/5",
                                isInspecting && "border-amber-500/60 bg-amber-500/5 shadow-sm"
                              )}
                            >
                              {/* Timeline Bullet Node */}
                              <div
                                className={cn(
                                  "absolute -left-[19px] top-4 h-2.5 w-2.5 rounded-full border-2 bg-card transition-colors",
                                  isCurrentHead
                                    ? "border-primary bg-primary"
                                    : isInspecting
                                      ? "border-amber-500 bg-amber-500"
                                      : "border-muted-foreground/60"
                                )}
                              />

                              {/* Snapshot Header Row */}
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] gap-1 px-1.5 py-0 h-4",
                                      meta.badgeClass
                                    )}
                                  >
                                    <TriggerIcon className="h-2.5 w-2.5" />
                                    <span>{meta.label}</span>
                                  </Badge>

                                  {snapshot.tag && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] gap-1 px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-mono"
                                    >
                                      <Tag className="h-2.5 w-2.5" />
                                      <span>{snapshot.tag}</span>
                                    </Badge>
                                  )}

                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {snapshot.id.slice(0, 8)}
                                  </span>

                                  {isCurrentHead && (
                                    <Badge className="text-[10px] px-1.5 py-0 h-4 bg-primary text-primary-foreground font-semibold">
                                      Active head
                                    </Badge>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <span>
                                    {new Date(snapshot.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                              </div>

                              {/* Snapshot Message */}
                              <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 mb-2">
                                {snapshot.message || "Checkpoint commit"}
                              </p>

                              {/* Footer Metadata and Action Buttons */}
                              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/40">
                                <div className="flex items-center gap-2 text-muted-foreground font-mono text-[10px]">
                                  <span>{snapshot.fileCount} files</span>
                                  <span>•</span>
                                  <span>{snapshot.branchName}</span>
                                </div>

                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => onInspectSnapshot(snapshot.id)}
                                    className="h-6 px-2 text-[11px] gap-1"
                                    title="Inspect code diff and preview"
                                  >
                                    <Eye className="h-3 w-3" />
                                    <span>Inspect</span>
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      onBranchFromSnapshot(snapshot.id, snapshot.message || "")
                                    }
                                    className="h-6 px-2 text-[11px] gap-1"
                                    title="Create new branch from here"
                                  >
                                    <GitBranch className="h-3 w-3" />
                                    <span>Branch</span>
                                  </Button>

                                  {!isCurrentHead && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => onRollbackSnapshot(snapshot.id)}
                                      className="h-6 px-2 text-[11px] gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10 font-semibold"
                                      title="Roll back to this checkpoint"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      <span>Restore</span>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Cursor Pagination Button */}
                  {nextCursor && (
                    <div className="pt-2 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onLoadMore}
                        disabled={isLoadingSnapshots}
                        className="text-xs w-full"
                      >
                        {isLoadingSnapshots ? "Loading older versions..." : "Load older versions"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Manual Checkpoint Modal */}
      <CreateCheckpointDialog
        isOpen={isCheckpointDialogOpen}
        onClose={() => setIsCheckpointDialogOpen(false)}
        onSubmit={onSaveCheckpoint}
      />
    </>
  );
}

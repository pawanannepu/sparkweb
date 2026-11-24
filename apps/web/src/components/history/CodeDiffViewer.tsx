"use client";

import type { FileDiff, SnapshotDiffResult } from "@spark/shared";
import { Columns, FileCode, FilePlus, FileText, FileX, Rows } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface CodeDiffViewerProps {
  diffResult: SnapshotDiffResult;
  className?: string;
}

export function CodeDiffViewer({ diffResult, className }: CodeDiffViewerProps) {
  const [selectedPath, setSelectedPath] = useState<string>(diffResult.fileDiffs[0]?.path || "");
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const activeFileDiff: FileDiff | undefined =
    diffResult.fileDiffs.find((f) => f.path === selectedPath) || diffResult.fileDiffs[0];

  const getStatusIcon = (status: FileDiff["status"]) => {
    switch (status) {
      case "added":
        return <FilePlus className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
      case "deleted":
        return <FileX className="h-3.5 w-3.5 text-rose-500 shrink-0" />;
      default:
        return <FileCode className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full border border-border rounded-lg bg-card overflow-hidden",
        className
      )}
    >
      {/* Diff Header Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">
            {diffResult.summary.totalFiles} {diffResult.summary.totalFiles === 1 ? "file" : "files"}{" "}
            changed
          </span>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              +{diffResult.summary.totalAdditions}
            </span>
            <span className="text-rose-600 dark:text-rose-400 font-semibold">
              -{diffResult.summary.totalDeletions}
            </span>
          </div>

          <div className="flex items-center gap-1 ml-2">
            {diffResult.summary.addedFiles > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-emerald-600 border-emerald-500/30"
              >
                {diffResult.summary.addedFiles} added
              </Badge>
            )}
            {diffResult.summary.modifiedFiles > 0 && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                {diffResult.summary.modifiedFiles} modified
              </Badge>
            )}
            {diffResult.summary.deletedFiles > 0 && (
              <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-500/30">
                {diffResult.summary.deletedFiles} deleted
              </Badge>
            )}
          </div>
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={viewMode === "unified" ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setViewMode("unified")}
            aria-label="Unified diff view"
          >
            <Rows className="h-3.5 w-3.5" />
            <span>Unified</span>
          </Button>
          <Button
            size="sm"
            variant={viewMode === "split" ? "secondary" : "ghost"}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setViewMode("split")}
            aria-label="Split diff view"
          >
            <Columns className="h-3.5 w-3.5" />
            <span>Split</span>
          </Button>
        </div>
      </div>

      {/* Main Diff Content Container */}
      <div className="grid grid-cols-1 md:grid-cols-4 flex-1 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Left Files List Sidebar */}
        <div className="md:col-span-1 overflow-y-auto max-h-48 md:max-h-full bg-muted/10 p-2 space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">
            Changed Files
          </div>
          {diffResult.fileDiffs.map((file) => {
            const isSelected = file.path === (activeFileDiff?.path || selectedPath);
            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded text-left text-xs font-mono transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground font-medium shadow-sm"
                    : "hover:bg-accent text-foreground"
                )}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {getStatusIcon(file.status)}
                  <span className="truncate">{file.path}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] shrink-0">
                  {file.additions > 0 && (
                    <span className={isSelected ? "text-primary-foreground" : "text-emerald-500"}>
                      +{file.additions}
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className={isSelected ? "text-primary-foreground" : "text-rose-500"}>
                      -{file.deletions}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Code Diff Area */}
        <div className="md:col-span-3 flex flex-col overflow-hidden bg-background">
          {activeFileDiff ? (
            <>
              {/* File Heading */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/20 text-xs font-mono">
                <div className="flex items-center gap-2">
                  {getStatusIcon(activeFileDiff.status)}
                  <span className="font-semibold">{activeFileDiff.path}</span>
                </div>
                <span className="text-muted-foreground capitalize">{activeFileDiff.status}</span>
              </div>

              {/* Diff Lines View */}
              <ScrollArea className="flex-1 font-mono text-xs">
                {activeFileDiff.isBinary ? (
                  <div className="p-8 text-center text-muted-foreground flex flex-col items-center gap-2">
                    <FileText className="h-8 w-8 opacity-40" />
                    <span>Binary file change. Text diff preview not available.</span>
                  </div>
                ) : activeFileDiff.hunks.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No textual changes detected in this file.
                  </div>
                ) : viewMode === "unified" ? (
                  <div className="divide-y divide-border/20">
                    {activeFileDiff.hunks.map((hunk) => {
                      let oldLineNum = hunk.oldStart;
                      let newLineNum = hunk.newStart;
                      return (
                        <div key={`${hunk.oldStart}-${hunk.newStart}`} className="py-1">
                          <div className="bg-muted/60 text-muted-foreground px-3 py-0.5 text-[11px] font-bold select-none">
                            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                          </div>
                          <div className="overflow-x-auto">
                            {hunk.lines.map((line) => {
                              const isAdd = line.startsWith("+");
                              const isDel = line.startsWith("-");
                              const lineId = isAdd
                                ? `+${newLineNum++}`
                                : isDel
                                  ? `-${oldLineNum++}`
                                  : ` ${oldLineNum++}-${newLineNum++}`;
                              return (
                                <div
                                  key={`${hunk.oldStart}-${hunk.newStart}-${lineId}`}
                                  className={cn(
                                    "flex px-3 py-0.5 leading-relaxed whitespace-pre font-mono",
                                    isAdd &&
                                      "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200",
                                    isDel && "bg-rose-500/15 text-rose-900 dark:text-rose-200"
                                  )}
                                >
                                  <span className="select-none w-5 text-muted-foreground/60 mr-2 shrink-0">
                                    {isAdd ? "+" : isDel ? "-" : " "}
                                  </span>
                                  <span>{line.slice(1)}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Split side by side mode */
                  <div className="divide-y divide-border/20">
                    {activeFileDiff.hunks.map((hunk) => {
                      let oldLineNum = hunk.oldStart;
                      let newLineNum = hunk.newStart;
                      return (
                        <div key={`${hunk.oldStart}-${hunk.newStart}`} className="py-1">
                          <div className="bg-muted/60 text-muted-foreground px-3 py-0.5 text-[11px] font-bold select-none">
                            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                          </div>
                          <div className="grid grid-cols-2 divide-x divide-border overflow-x-auto">
                            {/* Old column */}
                            <div className="p-1 space-y-0.5">
                              {hunk.lines
                                .filter((l) => !l.startsWith("+"))
                                .map((line) => {
                                  const isDel = line.startsWith("-");
                                  const lineKey = `${hunk.oldStart}-old-${oldLineNum++}`;
                                  return (
                                    <div
                                      key={lineKey}
                                      className={cn(
                                        "px-2 py-0.5 whitespace-pre font-mono leading-relaxed",
                                        isDel && "bg-rose-500/15 text-rose-900 dark:text-rose-200"
                                      )}
                                    >
                                      {isDel ? line.slice(1) : line}
                                    </div>
                                  );
                                })}
                            </div>
                            {/* New column */}
                            <div className="p-1 space-y-0.5">
                              {hunk.lines
                                .filter((l) => !l.startsWith("-"))
                                .map((line) => {
                                  const isAdd = line.startsWith("+");
                                  const lineKey = `${hunk.newStart}-new-${newLineNum++}`;
                                  return (
                                    <div
                                      key={lineKey}
                                      className={cn(
                                        "px-2 py-0.5 whitespace-pre font-mono leading-relaxed",
                                        isAdd &&
                                          "bg-emerald-500/15 text-emerald-900 dark:text-emerald-200"
                                      )}
                                    >
                                      {isAdd ? line.slice(1) : line}
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              Select a file to inspect diff.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

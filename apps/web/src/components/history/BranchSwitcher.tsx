"use client";

import type { BranchSummary } from "@spark/shared";
import { Check, ChevronDown, GitBranch, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface BranchSwitcherProps {
  branches: BranchSummary[];
  activeBranchId: string | null;
  onSwitchBranch: (branchId: string) => void;
  onCreateBranchClick: () => void;
  onDeleteBranchClick?: (branchId: string) => void;
  disabled?: boolean;
  className?: string;
}

export function BranchSwitcher({
  branches,
  activeBranchId,
  onSwitchBranch,
  onCreateBranchClick,
  onDeleteBranchClick,
  disabled = false,
  className,
}: BranchSwitcherProps) {
  const activeBranch = branches.find((b) => b.id === activeBranchId) || branches[0];
  const activeBranchName = activeBranch ? activeBranch.name : "main";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 gap-1.5 px-2.5 font-mono text-xs font-medium border-border/80 bg-background/60 shadow-sm transition-colors hover:bg-accent",
            className
          )}
          aria-label="Switch active branch"
        >
          <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="max-w-[120px] truncate">{activeBranchName}</span>
          <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          Project Branches
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {branches.map((branch) => {
          const isActive =
            branch.id === activeBranchId || (activeBranchId === null && branch.isMain);
          return (
            <div
              key={branch.id}
              className="flex items-center justify-between px-1 hover:bg-accent rounded-sm group"
            >
              <button
                type="button"
                onClick={() => onSwitchBranch(branch.id)}
                className="flex flex-1 items-center gap-2 py-1.5 px-2 text-xs font-mono text-left cursor-pointer"
              >
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate flex-1 font-medium">{branch.name}</span>
                {branch.isMain && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 h-4 border-muted-foreground/30"
                  >
                    main
                  </Badge>
                )}
                {isActive && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>

              {!branch.isMain && !isActive && onDeleteBranchClick && (
                <button
                  type="button"
                  title="Delete branch"
                  aria-label={`Delete branch ${branch.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBranchClick(branch.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={onCreateBranchClick}
          className="gap-2 text-xs cursor-pointer text-primary focus:text-primary font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Create new branch...</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { PanelLeftClose } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface ChatPanelProps {
  children?: React.ReactNode;
  title?: string;
  onCollapse?: () => void;
  className?: string;
}

export function ChatPanel({
  children,
  title = "Project Assistant",
  onCollapse,
  className,
}: ChatPanelProps) {
  return (
    <div
      className={`flex h-full flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border ${className || ""}`}
    >
      {/* Panel Top Bar */}
      <div className="flex h-11 items-center justify-between border-b border-sidebar-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
        </div>
        {onCollapse && (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={onCollapse}
                  aria-label="Collapse chat panel (Cmd+B)"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse panel (Cmd+B)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Main Chat Stream Container */}
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

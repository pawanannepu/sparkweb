"use client";

import { Eye, MessageSquare, PanelLeftOpen } from "lucide-react";
import * as React from "react";
import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { useWorkspaceLayout } from "@/hooks/useWorkspaceLayout";
import { cn } from "@/lib/utils";

export interface BuilderWorkbenchProps {
  chatContent: React.ReactNode;
  previewContent: React.ReactNode;
  className?: string;
}

export function BuilderWorkbench({
  chatContent,
  previewContent,
  className,
}: BuilderWorkbenchProps) {
  const { layout, updateSizes, toggleChatCollapse } = useWorkspaceLayout();
  const [isDragging, setIsDragging] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");

  // Keyboard shortcut listener: Cmd+B or Ctrl+B toggles chat panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        const active = document.activeElement;
        const isInput =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "TEXTAREA" ||
            (active as HTMLElement).isContentEditable);

        if (isInput) return; // Do not intercept when typing in prompts

        e.preventDefault();
        toggleChatCollapse();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleChatCollapse]);

  return (
    <div className={cn("relative flex h-[calc(100vh-3.5rem)] w-full overflow-hidden", className)}>
      {/* Desktop / Tablet Resizable Panels (Hidden on small mobile screens < 768px) */}
      <div className="hidden h-full w-full md:flex">
        {/* Floating Expand button if chat is collapsed */}
        {layout.isChatCollapsed && (
          <div className="absolute left-3 top-3 z-30">
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 shadow-md border border-border bg-card hover:bg-accent"
              onClick={toggleChatCollapse}
              aria-label="Expand chat panel (Cmd+B)"
              title="Expand chat (Cmd+B)"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Group
          orientation="horizontal"
          onLayoutChanged={(layoutMap) => {
            if (!layout.isChatCollapsed && layoutMap) {
              const values = Array.isArray(layoutMap)
                ? layoutMap
                : [layoutMap["chat-panel"], layoutMap["preview-panel"]].filter(
                    (v): v is number => typeof v === "number"
                  );
              if (values.length === 2) {
                updateSizes(values[0], values[1]);
              }
            }
          }}
          className="h-full w-full flex"
        >
          {/* Left Chat Column */}
          {!layout.isChatCollapsed && (
            <>
              <Panel
                id="chat-panel"
                defaultSize={`${layout.chatPanelSize}%`}
                minSize="15%"
                maxSize="50%"
                className="h-full overflow-hidden"
              >
                {React.isValidElement(chatContent)
                  ? React.cloneElement(
                      chatContent as React.ReactElement<{ onCollapse?: () => void }>,
                      {
                        onCollapse: toggleChatCollapse,
                      }
                    )
                  : chatContent}
              </Panel>

              {/* Resize Handle with Grip indicator */}
              <Separator
                onMouseDown={() => setIsDragging(true)}
                onMouseUp={() => setIsDragging(false)}
                className="group relative flex w-1.5 items-center justify-center bg-border transition-colors hover:bg-primary/50 focus-visible:bg-primary cursor-col-resize select-none"
              >
                <div className="h-8 w-1 rounded-full bg-muted-foreground/30 group-hover:bg-primary transition-colors" />
              </Separator>
            </>
          )}

          {/* Right Live Preview Canvas */}
          <Panel
            id="preview-panel"
            defaultSize={layout.isChatCollapsed ? "100%" : `${layout.previewPanelSize}%`}
            minSize="50%"
            className="relative flex h-full flex-col overflow-hidden"
          >
            <div className="relative flex h-full w-full flex-col">
              {previewContent}
              {/* Invisible overlay during drag to prevent iframe event swallowing */}
              {isDragging && (
                <div
                  className="absolute inset-0 z-50 cursor-col-resize bg-transparent"
                  aria-hidden="true"
                />
              )}
            </div>
          </Panel>
        </Group>
      </div>

      {/* Mobile Viewport (< 768px): Single View with Bottom Tab Switcher */}
      <div className="flex h-full w-full flex-col md:hidden">
        <div className="flex-1 overflow-hidden">
          {mobileTab === "chat" ? (
            <div className="h-full w-full overflow-y-auto">{chatContent}</div>
          ) : (
            <div className="h-full w-full">{previewContent}</div>
          )}
        </div>

        {/* Mobile Persistent Bottom Switcher Bar */}
        <nav
          className="flex h-12 items-center justify-around border-t border-border bg-card px-4 backdrop-blur select-none"
          aria-label="Mobile View Switcher"
        >
          <Button
            variant={mobileTab === "chat" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMobileTab("chat")}
            aria-label="Switch to Chat"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="text-xs font-medium">Prompt Chat</span>
          </Button>
          <Button
            variant={mobileTab === "preview" ? "secondary" : "ghost"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => setMobileTab("preview")}
            aria-label="Switch to Live Preview"
          >
            <Eye className="h-4 w-4" />
            <span className="text-xs font-medium">Live Preview</span>
          </Button>
        </nav>
      </div>
    </div>
  );
}

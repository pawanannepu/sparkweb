"use client";

import type { DeviceMode } from "@spark/shared";
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface PreviewToolbarProps {
  activeDevice: DeviceMode;
  onDeviceChange: (device: DeviceMode) => void;
  onReload: () => void;
  currentPath?: string;
  onNavigate?: (path: string) => void;
  isConnected?: boolean;
  sandboxUrl?: string;
}

export function PreviewToolbar({
  activeDevice,
  onDeviceChange,
  onReload,
  currentPath = "/",
  onNavigate,
  isConnected = false,
  sandboxUrl,
}: PreviewToolbarProps) {
  const [inputPath, setInputPath] = useState(currentPath);

  React.useEffect(() => {
    setInputPath(currentPath);
  }, [currentPath]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const sanitized = inputPath.startsWith("/") ? inputPath : `/${inputPath}`;
      onNavigate?.(sanitized);
    }
  };

  const handleOpenExternal = () => {
    if (!sandboxUrl) return;
    try {
      const full = new URL(inputPath, sandboxUrl).toString();
      window.open(full, "_blank", "noopener,noreferrer");
    } catch {
      window.open(sandboxUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex h-11 items-center justify-between gap-2 border-b border-border bg-card/60 px-3 py-1.5 backdrop-blur">
        {/* Device Mode Switcher */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeDevice === "desktop" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => onDeviceChange("desktop")}
                aria-label="Desktop viewport"
              >
                <Monitor className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Desktop (100%)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeDevice === "tablet" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => onDeviceChange("tablet")}
                aria-label="Tablet viewport"
              >
                <Tablet className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tablet (768 × 1024)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={activeDevice === "mobile" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => onDeviceChange("mobile")}
                aria-label="Mobile viewport"
              >
                <Smartphone className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mobile (375 × 667)</TooltipContent>
          </Tooltip>
        </div>

        {/* Address Path Bar */}
        <div className="flex max-w-sm flex-1 items-center gap-1.5">
          <div
            role="status"
            className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
              isConnected ? "bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-amber-500"
            }`}
            title={isConnected ? "Sandbox connected" : "Connecting to preview..."}
            aria-label={isConnected ? "Connected" : "Connecting"}
          />
          <Input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/"
            className="h-7 text-xs font-mono bg-background/50 focus-visible:bg-background"
            aria-label="Preview address bar"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onReload}
                aria-label="Reload preview"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload preview</TooltipContent>
          </Tooltip>

          {sandboxUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleOpenExternal}
                  aria-label="Open in new window"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in new tab</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>
    </TooltipProvider>
  );
}

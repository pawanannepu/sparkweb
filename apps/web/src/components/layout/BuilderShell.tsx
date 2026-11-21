"use client";

import { Laptop, Moon, Sparkles, Sun } from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export interface BuilderShellProps {
  children: React.ReactNode;
  projectName?: string;
  headerActions?: React.ReactNode;
  className?: string;
}

export function BuilderShell({
  children,
  projectName = "Untitled App",
  headerActions,
  className,
}: BuilderShellProps) {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <div className={cn("flex min-h-screen flex-col bg-background text-foreground", className)}>
      {/* Studio Top Navigation Bar */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur">
        {/* Brand & Project Identity */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-base font-extrabold tracking-tight">sparkweb</span>
          </div>

          <div className="h-4 w-[1px] bg-border" aria-hidden="true" />

          <Badge variant="outline" className="font-mono text-xs bg-muted/40">
            {projectName}
          </Badge>
        </div>

        {/* Right Header Actions & Theme Toggle */}
        <div className="flex items-center gap-2">
          {headerActions}

          {/* Theme Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Toggle theme">
                {resolvedTheme === "dark" ? (
                  <Moon className="h-4 w-4" />
                ) : (
                  <Sun className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2">
                <Sun className="h-4 w-4" />
                <span>Light</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2">
                <Moon className="h-4 w-4" />
                <span>Dark</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2">
                <Laptop className="h-4 w-4" />
                <span>System</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Main Studio Workspace Container */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}

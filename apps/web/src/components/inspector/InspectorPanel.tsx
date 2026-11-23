"use client";

import type { SelectedElementState } from "@spark/shared";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Layers,
  Palette,
  Redo2,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface InspectorPanelProps {
  element: SelectedElementState | null;
  onClose: () => void;
  onApplyStyle: (update: {
    newClasses?: string[];
    removeClasses?: string[];
    replaceAllClasses?: string[];
    instantStyles?: Record<string, string>;
  }) => void;
  onApplyText?: (text: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  className?: string;
}

export function InspectorPanel({
  element,
  onClose,
  onApplyStyle,
  onApplyText,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  className,
}: InspectorPanelProps) {
  const [editedText, setEditedText] = useState("");

  React.useEffect(() => {
    if (element?.textContent) {
      setEditedText(element.textContent);
    } else {
      setEditedText("");
    }
  }, [element?.textContent]);

  if (!element) {
    return (
      <aside
        className={cn(
          "flex h-full w-full flex-col items-center justify-center border-l border-border bg-card/60 p-6 text-center backdrop-blur",
          className
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground mb-3">
          <Layers className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Canvas Inspector</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-[200px] leading-relaxed">
          Click the inspect toggle in the toolbar and select an element to view and adjust its
          properties.
        </p>
      </aside>
    );
  }

  const isEditable = element.isEditable;
  const classes = element.classes || [];

  const handleClassToggle = (newClass: string, removeMatches?: RegExp) => {
    if (!isEditable) return;
    const toRemove: string[] = [];
    if (removeMatches) {
      for (const cls of classes) {
        if (removeMatches.test(cls)) {
          toRemove.push(cls);
        }
      }
    }
    onApplyStyle({
      newClasses: [newClass],
      removeClasses: toRemove,
    });
  };

  const handleTextCommit = () => {
    if (!isEditable || !onApplyText) return;
    if (editedText !== element.textContent) {
      onApplyText(editedText);
    }
  };

  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col border-l border-border bg-card/90 text-card-foreground backdrop-blur select-none",
        className
      )}
      aria-label="Visual Canvas Inspector Panel"
    >
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Badge variant="secondary" className="font-mono text-xs font-semibold px-1.5 py-0.5">
            &lt;{element.tagName}&gt;
          </Badge>
          {element.source ? (
            <span
              className="truncate text-[11px] font-mono text-muted-foreground"
              title={`${element.source.file}:${element.source.line}`}
            >
              {element.source.file.split("/").pop()}:{element.source.line}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">DOM Element</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onUndo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Cmd+Z)"
              aria-label="Undo visual edit"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}

          {onRedo && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Cmd+Shift+Z)"
              aria-label="Redo visual edit"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close inspector"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Non editable external notice badge (AC-7) */}
      {!isEditable && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3 py-2 text-xs text-amber-400 flex items-center justify-between">
          <span>Read only element</span>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
            external / unmapped
          </Badge>
        </div>
      )}

      {/* Controls List */}
      <ScrollArea className="flex-1 px-3 py-3">
        <div className="space-y-5 text-xs">
          {/* Text Content Editor (for static leaf text nodes) */}
          {element.isLeafTextOnly && (
            <div className="space-y-1.5">
              <label
                htmlFor="inspector-element-text-input"
                className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5"
              >
                <Type className="h-3.5 w-3.5" /> Text Content
              </label>
              <Input
                id="inspector-element-text-input"
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                onBlur={handleTextCommit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                disabled={!isEditable}
                placeholder="Element text..."
                className="h-8 text-xs bg-background/50"
              />
            </div>
          )}

          {/* Typography */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5" /> Typography
            </h4>

            {/* Font Size */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Size</span>
              <div className="grid grid-cols-6 gap-1">
                {[
                  { label: "xs", cls: "text-xs" },
                  { label: "sm", cls: "text-sm" },
                  { label: "base", cls: "text-base" },
                  { label: "lg", cls: "text-lg" },
                  { label: "xl", cls: "text-xl" },
                  { label: "2xl", cls: "text-2xl" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^text-(xs|sm|base|lg|xl|2xl|3xl)/)}
                    className="h-7 px-1 text-[10px] font-mono"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Font Weight */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Weight</span>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: "Normal", cls: "font-normal" },
                  { label: "Medium", cls: "font-medium" },
                  { label: "Semi", cls: "font-semibold" },
                  { label: "Bold", cls: "font-bold" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^font-(normal|medium|semibold|bold)/)}
                    className="h-7 px-1 text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Text Align */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Alignment</span>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: "Left", cls: "text-left", icon: AlignLeft },
                  { label: "Center", cls: "text-center", icon: AlignCenter },
                  { label: "Right", cls: "text-right", icon: AlignRight },
                ].map(({ label, cls, icon: Icon }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^text-(left|center|right)/)}
                    className="h-7 gap-1 text-[10px]"
                  >
                    <Icon className="h-3 w-3" />
                    <span>{label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator className="bg-border/60" />

          {/* Spacing (Padding & Margin) */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Square className="h-3.5 w-3.5" /> Spacing
            </h4>

            {/* Padding Presets */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Padding</span>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: "p-0", cls: "p-0" },
                  { label: "p-2", cls: "p-2" },
                  { label: "p-4", cls: "p-4" },
                  { label: "p-6", cls: "p-6" },
                  { label: "p-8", cls: "p-8" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^p-\d+/)}
                    className="h-7 px-1 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Margin Presets */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Margin</span>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: "m-0", cls: "m-0" },
                  { label: "m-2", cls: "m-2" },
                  { label: "m-4", cls: "m-4" },
                  { label: "m-8", cls: "m-8" },
                  { label: "auto", cls: "mx-auto" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^(m-\d+|mx-auto)/)}
                    className="h-7 px-1 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator className="bg-border/60" />

          {/* Layout (Flex / Grid / Display) */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Layout
            </h4>

            {/* Display */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Display</span>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: "block", cls: "block" },
                  { label: "flex", cls: "flex" },
                  { label: "grid", cls: "grid" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^(block|flex|grid|inline)/)}
                    className="h-7 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Flex Direction */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Direction</span>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { label: "row", cls: "flex-row" },
                  { label: "col", cls: "flex-col" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^flex-(row|col)/)}
                    className="h-7 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Gap */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Gap</span>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: "gap-1", cls: "gap-1" },
                  { label: "gap-2", cls: "gap-2" },
                  { label: "gap-4", cls: "gap-4" },
                  { label: "gap-6", cls: "gap-6" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^gap-\d+/)}
                    className="h-7 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator className="bg-border/60" />

          {/* Colors & Background */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Palette className="h-3.5 w-3.5" /> Colors
            </h4>

            {/* Background color presets */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Background</span>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Dark", cls: "bg-slate-950", color: "#020617" },
                  { label: "Slate", cls: "bg-slate-900", color: "#0f172a" },
                  { label: "Indigo", cls: "bg-indigo-600", color: "#4f46e5" },
                  { label: "Emerald", cls: "bg-emerald-600", color: "#059669" },
                  { label: "Rose", cls: "bg-rose-600", color: "#e11d48" },
                  { label: "Amber", cls: "bg-amber-600", color: "#d97706" },
                  { label: "Card", cls: "bg-card", color: "#1e293b" },
                  { label: "Clear", cls: "bg-transparent", color: "transparent" },
                ].map(({ label, cls, color }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() =>
                      handleClassToggle(
                        cls,
                        /^bg-(slate|indigo|emerald|rose|amber|zinc|card|transparent)/
                      )
                    }
                    className="h-7 justify-start gap-1.5 px-2 text-[10px]"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-border/80"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate">{label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Text color presets */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Text Color</span>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { label: "White", cls: "text-white", color: "#ffffff" },
                  { label: "Muted", cls: "text-slate-400", color: "#94a3b8" },
                  { label: "Indigo", cls: "text-indigo-400", color: "#818cf8" },
                  { label: "Emerald", cls: "text-emerald-400", color: "#34d399" },
                  { label: "Rose", cls: "text-rose-400", color: "#fb7185" },
                  { label: "Amber", cls: "text-amber-400", color: "#fbbf24" },
                ].map(({ label, cls, color }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() =>
                      handleClassToggle(
                        cls,
                        /^text-(white|slate|indigo|emerald|rose|amber|foreground)/
                      )
                    }
                    className="h-7 justify-start gap-1.5 px-2 text-[10px]"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-border/80"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate">{label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator className="bg-border/60" />

          {/* Borders */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Square className="h-3.5 w-3.5" /> Borders
            </h4>

            {/* Border Radius */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Radius</span>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: "none", cls: "rounded-none" },
                  { label: "sm", cls: "rounded-sm" },
                  { label: "md", cls: "rounded-md" },
                  { label: "lg", cls: "rounded-xl" },
                  { label: "full", cls: "rounded-full" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^rounded/)}
                    className="h-7 px-1 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Border Width */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Width</span>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: "0", cls: "border-0" },
                  { label: "1px", cls: "border" },
                  { label: "2px", cls: "border-2" },
                  { label: "4px", cls: "border-4" },
                ].map(({ label, cls }) => (
                  <Button
                    key={cls}
                    variant={classes.includes(cls) ? "secondary" : "outline"}
                    size="sm"
                    disabled={!isEditable}
                    onClick={() => handleClassToggle(cls, /^border(-\d+)?$/)}
                    className="h-7 font-mono text-[10px]"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

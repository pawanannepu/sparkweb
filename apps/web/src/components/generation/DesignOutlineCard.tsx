"use client";

import {
  type DesignOutlineDto,
  type DesignOutlinePayload,
  getEffectiveOutlinePayload,
  normalizeHexColor,
  type ThreadMessageDto,
} from "@spark/shared";
import {
  CheckCircle2,
  Copy,
  Layers,
  Loader2,
  Palette,
  RotateCcw,
  Sparkles,
  Type,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface DesignOutlineCardProps {
  projectId: string;
  outline: DesignOutlineDto;
  isBusy?: boolean;
  onOutlineUpdated: (updated: DesignOutlineDto) => void;
  onOutlineCloned: (cloned: DesignOutlineDto, outlineMessage: ThreadMessageDto) => void;
  onBuildOutline: (outlineId: string, latestPayload: DesignOutlinePayload) => Promise<void> | void;
}

const PATCH_DEBOUNCE_MS = 500;

export function DesignOutlineCard({
  projectId,
  outline,
  isBusy = false,
  onOutlineUpdated,
  onOutlineCloned,
  onBuildOutline,
}: DesignOutlineCardProps) {
  const baseId = useId();
  const isReady = outline.status === "ready";
  const isConfirmed = outline.status === "confirmed";

  const [draft, setDraft] = useState<DesignOutlinePayload>(() =>
    getEffectiveOutlinePayload(outline)
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<DesignOutlinePayload>(draft);
  latestDraftRef.current = draft;

  // Sync draft if parent outline changes (e.g. external reset or status transition)
  useEffect(() => {
    setDraft(getEffectiveOutlinePayload(outline));
  }, [outline]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const persistPatch = async (payload: DesignOutlinePayload) => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/outlines/${outline.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editedOutline: payload }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `Failed to save outline (${res.status})`);
      }

      const data = (await res.json()) as { outline: DesignOutlineDto };
      onOutlineUpdated(data.outline);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save outline edits");
    }
  };

  const updateDraft = (updater: (prev: DesignOutlinePayload) => DesignOutlinePayload) => {
    if (!isReady) return;
    const next = updater(latestDraftRef.current);
    setDraft(next);
    latestDraftRef.current = next;
    setSaveState("saving");
    setSaveError(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void persistPatch(latestDraftRef.current);
    }, PATCH_DEBOUNCE_MS);
  };

  const handleReset = async () => {
    if (!isReady || isBusy) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/outlines/${outline.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Failed to reset outline");
      }
      const data = (await res.json()) as { outline: DesignOutlineDto };
      setDraft(data.outline.extractedOutline);
      onOutlineUpdated(data.outline);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Failed to reset outline");
    }
  };

  const handleBuildClick = () => {
    if (!isReady || isBusy) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      setSaveState("idle");
    }
    void onBuildOutline(outline.id, latestDraftRef.current);
  };

  const handleCloneClick = async () => {
    if (isReady || isCloning || isBusy) return;
    setIsCloning(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/outlines/${outline.id}/clone`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Failed to clone outline");
      }
      const data = (await res.json()) as {
        outline: DesignOutlineDto;
        outlineMessage: ThreadMessageDto;
      };
      onOutlineCloned(data.outline, data.outlineMessage);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to clone outline");
    } finally {
      setIsCloning(false);
    }
  };

  const enabledSectionsCount = draft.layoutSections.filter((s) => s.enabled).length;
  const enabledComponentsCount = draft.componentHierarchy.filter((c) => c.enabled).length;

  return (
    <section
      aria-label="Design outline review card"
      className="w-full rounded-xl border border-border bg-card p-3.5 text-card-foreground shadow-sm space-y-3.5"
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-xs font-semibold tracking-tight">Design Outline</h3>
            <p className="font-mono text-[10px] text-muted-foreground">{outline.modelId}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {outline.clonedFromOutlineId && (
            <Badge variant="outline" className="text-[10px]">
              Cloned draft
            </Badge>
          )}
          <Badge
            variant={isConfirmed ? "default" : "outline"}
            className={
              isReady
                ? "border-primary/40 bg-primary/10 text-primary text-[10px]"
                : isConfirmed
                  ? "text-[10px]"
                  : "text-muted-foreground text-[10px]"
            }
          >
            {isReady ? "Ready to review" : isConfirmed ? "Confirmed" : "Superseded"}
          </Badge>
        </div>
      </div>

      {/* App Summary */}
      <div className="space-y-1">
        <label
          htmlFor={`${baseId}-summary`}
          className="block text-[11px] font-medium text-muted-foreground"
        >
          Application Summary
        </label>
        <Textarea
          id={`${baseId}-summary`}
          value={draft.appSummary}
          disabled={!isReady}
          rows={2}
          onChange={(e) => updateDraft((prev) => ({ ...prev, appSummary: e.target.value }))}
          className="min-h-[56px] text-xs"
        />
      </div>

      {/* Color Palette */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Palette className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Color Palette ({draft.palette.length})</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {draft.palette.map((swatch, index) => {
            const safeColorValue = normalizeHexColor(swatch.hex);
            return (
              <div
                key={swatch.id}
                className="flex items-center gap-2 rounded-lg border border-border/80 bg-background/60 p-2"
              >
                <input
                  type="color"
                  aria-label={`Pick color for ${swatch.role}`}
                  value={/^#[0-9A-F]{6}$/.test(safeColorValue) ? safeColorValue : "#2563EB"}
                  disabled={!isReady}
                  onChange={(e) => {
                    const nextHex = e.target.value.toUpperCase();
                    updateDraft((prev) => ({
                      ...prev,
                      palette: prev.palette.map((p, idx) =>
                        idx === index ? { ...p, hex: nextHex } : p
                      ),
                    }));
                  }}
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-[11px] font-medium">{swatch.role}</span>
                    <Input
                      aria-label={`Hex code for ${swatch.role}`}
                      value={swatch.hex}
                      disabled={!isReady}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateDraft((prev) => ({
                          ...prev,
                          palette: prev.palette.map((p, idx) =>
                            idx === index ? { ...p, hex: val } : p
                          ),
                        }));
                      }}
                      className="h-6 w-20 px-1.5 font-mono text-[10px]"
                    />
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground" title={swatch.usage}>
                    {swatch.usage}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Typography */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Type className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Typography</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor={`${baseId}-heading-font`}
              className="block text-[10px] font-medium text-muted-foreground"
            >
              Heading Font
            </label>
            <Input
              id={`${baseId}-heading-font`}
              value={draft.typography.headingFont}
              disabled={!isReady}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  typography: { ...prev.typography, headingFont: e.target.value },
                }))
              }
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`${baseId}-body-font`}
              className="block text-[10px] font-medium text-muted-foreground"
            >
              Body Font
            </label>
            <Input
              id={`${baseId}-body-font`}
              value={draft.typography.bodyFont}
              disabled={!isReady}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  typography: { ...prev.typography, bodyFont: e.target.value },
                }))
              }
              className="h-7 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label
            htmlFor={`${baseId}-scale-notes`}
            className="block text-[10px] font-medium text-muted-foreground"
          >
            Scale Notes
          </label>
          <Input
            id={`${baseId}-scale-notes`}
            value={draft.typography.scaleNotes}
            disabled={!isReady}
            onChange={(e) =>
              updateDraft((prev) => ({
                ...prev,
                typography: { ...prev.typography, scaleNotes: e.target.value },
              }))
            }
            className="h-7 text-xs"
          />
        </div>
      </div>

      {/* Layout Sections */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-muted-foreground">
          Layout Sections ({enabledSectionsCount}/{draft.layoutSections.length} enabled)
        </div>
        <ul className="space-y-1.5">
          {draft.layoutSections.map((section, index) => (
            <li
              key={section.id}
              className={`rounded-lg border p-2 transition-colors ${
                section.enabled
                  ? "border-border bg-background/60"
                  : "border-border/50 bg-muted/30 opacity-70"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  id={`${baseId}-sec-${section.id}`}
                  type="checkbox"
                  checked={section.enabled}
                  disabled={!isReady}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    updateDraft((prev) => ({
                      ...prev,
                      layoutSections: prev.layoutSections.map((s, idx) =>
                        idx === index ? { ...s, enabled: checked } : s
                      ),
                    }));
                  }}
                  className="mt-1 h-4 w-4 rounded border-input accent-primary"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <label
                    htmlFor={`${baseId}-sec-${section.id}`}
                    className="block text-xs font-medium cursor-pointer"
                  >
                    {section.name}
                  </label>
                  <Input
                    aria-label={`Notes for ${section.name}`}
                    value={section.description}
                    disabled={!isReady}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDraft((prev) => ({
                        ...prev,
                        layoutSections: prev.layoutSections.map((s, idx) =>
                          idx === index ? { ...s, description: val } : s
                        ),
                      }));
                    }}
                    className="h-7 text-[11px]"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Component Hierarchy */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium text-muted-foreground">
          Components ({enabledComponentsCount}/{draft.componentHierarchy.length} enabled)
        </div>
        <ul className="space-y-1.5">
          {draft.componentHierarchy.map((comp, index) => (
            <li
              key={comp.id}
              className={`flex items-start gap-2 rounded-lg border p-2 ${
                comp.enabled
                  ? "border-border bg-background/60"
                  : "border-border/50 bg-muted/30 opacity-70"
              }`}
            >
              <input
                id={`${baseId}-comp-${comp.id}`}
                type="checkbox"
                checked={comp.enabled}
                disabled={!isReady}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateDraft((prev) => ({
                    ...prev,
                    componentHierarchy: prev.componentHierarchy.map((c, idx) =>
                      idx === index ? { ...c, enabled: checked } : c
                    ),
                  }));
                }}
                className="mt-1 h-4 w-4 rounded border-input accent-primary"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <label
                  htmlFor={`${baseId}-comp-${comp.id}`}
                  className="block font-mono text-[11px] font-medium cursor-pointer"
                >
                  {comp.name}
                </label>
                <Input
                  aria-label={`Role for ${comp.name}`}
                  value={comp.role}
                  disabled={!isReady}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateDraft((prev) => ({
                      ...prev,
                      componentHierarchy: prev.componentHierarchy.map((c, idx) =>
                        idx === index ? { ...c, role: val } : c
                      ),
                    }));
                  }}
                  className="h-7 text-[11px]"
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Additional Notes */}
      <div className="space-y-1">
        <label
          htmlFor={`${baseId}-notes`}
          className="block text-[11px] font-medium text-muted-foreground"
        >
          Additional Notes
        </label>
        <Textarea
          id={`${baseId}-notes`}
          value={draft.additionalNotes}
          disabled={!isReady}
          rows={2}
          placeholder="Add extra layout, interaction, or copy adjustments..."
          onChange={(e) => updateDraft((prev) => ({ ...prev, additionalNotes: e.target.value }))}
          className="min-h-[48px] text-xs"
        />
      </div>

      {/* Status & Error announcements */}
      {saveError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive"
        >
          {saveError}
        </div>
      )}

      {/* Footer Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <span aria-live="polite" className="text-[11px] text-muted-foreground">
          {!isReady
            ? isConfirmed
              ? "Locked for build"
              : ""
            : saveState === "saving"
              ? "Saving changes..."
              : saveState === "saved"
                ? "Changes saved"
                : ""}
        </span>

        <div className="flex items-center gap-2">
          {isReady ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={handleReset}
                className="h-8 gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isBusy || enabledSectionsCount === 0}
                onClick={handleBuildClick}
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Build App
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy || isCloning}
              onClick={handleCloneClick}
              className="h-8 gap-1.5 text-xs"
            >
              {isCloning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : isConfirmed ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Clone to New Draft
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

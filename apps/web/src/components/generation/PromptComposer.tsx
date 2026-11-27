"use client";

import {
  type AiModelOption,
  type AiProvider,
  ALLOWED_IMAGE_MIME_TYPES,
  type DesignAttachmentDto,
  DIRECT_MODELS,
  isOpenRouterModelId,
  MAX_DESIGN_IMAGES,
  MAX_IMAGE_BYTES,
  OPENROUTER_DEFAULT_MODELS,
  type OpenRouterKeyBudgetDto,
  resolveModelProvider,
} from "@spark/shared";
import {
  AlertTriangle,
  Check,
  Cpu,
  Globe,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExtractionErrorState } from "@/hooks/useGenerationLoop";

export interface MultimodalSubmitPayload {
  prompt: string;
  model: string;
  attachmentIds: string[];
  sourceUrl?: string;
  visionOverride?: boolean;
}

export interface PromptComposerProps {
  projectId?: string;
  threadId?: string | null;
  onSubmit: (prompt: string, model: string) => void;
  onSubmitMultimodal?: (payload: MultimodalSubmitPayload) => Promise<boolean> | boolean;
  onCancel?: () => void;
  isStreaming?: boolean;
  isExtractingOutline?: boolean;
  disabled?: boolean;
  className?: string;
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  openRouterModels?: readonly AiModelOption[];
  directModels?: readonly AiModelOption[];
  configuredProviders?: readonly AiProvider[];
  openRouterKeyBudget?: OpenRouterKeyBudgetDto | null;
  hasOpenRouterKey?: boolean;
  onOpenApiKeys?: () => void;
  pendingAttachments?: readonly DesignAttachmentDto[];
  onAttachmentUploaded?: (attachment: DesignAttachmentDto) => void;
  onAttachmentRemoved?: (attachmentId: string) => void;
  extractionError?: ExtractionErrorState | null;
  onDismissExtractionError?: () => void;
}

type ModelFilterTab = "all" | "free" | "paid" | "direct";

function formatBytesLabel(sizeBytes: number | null): string {
  if (!sizeBytes) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PromptComposer({
  projectId,
  threadId,
  onSubmit,
  onSubmitMultimodal,
  onCancel,
  isStreaming = false,
  isExtractingOutline = false,
  disabled = false,
  className,
  selectedModel: controlledModel,
  onModelChange,
  openRouterModels = OPENROUTER_DEFAULT_MODELS,
  directModels = DIRECT_MODELS,
  configuredProviders,
  openRouterKeyBudget = null,
  hasOpenRouterKey = false,
  onOpenApiKeys,
  pendingAttachments = [],
  onAttachmentUploaded,
  onAttachmentRemoved,
  extractionError = null,
  onDismissExtractionError,
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [internalModel, setInternalModel] = useState("claude-3-7-sonnet");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<ModelFilterTab>("all");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [sourceUrl, setSourceUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [visionOverride, setVisionOverride] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedModel = controlledModel ?? internalModel;
  const isBusy = isStreaming || isExtractingOutline;

  const selectModel = (modelId: string) => {
    if (controlledModel === undefined) {
      setInternalModel(modelId);
    }
    onModelChange?.(modelId);
    setVisionOverride(false);
    setSearchQuery("");
    setIsMenuOpen(false);
  };

  const configuredDirectModels = useMemo<readonly AiModelOption[]>(() => {
    if (!configuredProviders) return directModels;
    return directModels.filter((m) => configuredProviders.includes(m.provider));
  }, [configuredProviders, directModels]);

  const visibleOpenRouterModels = useMemo<readonly AiModelOption[]>(() => {
    if (!configuredProviders || configuredProviders.length === 0) return openRouterModels;
    return configuredProviders.includes("openrouter") ? openRouterModels : [];
  }, [configuredProviders, openRouterModels]);

  const allKnownModels = useMemo<readonly AiModelOption[]>(
    () => [...openRouterModels, ...directModels],
    [directModels, openRouterModels]
  );

  const isCustomModelId = useMemo(
    () => !allKnownModels.some((m) => m.id === selectedModel),
    [allKnownModels, selectedModel]
  );

  const activeModelObj = useMemo<AiModelOption>(() => {
    const found = allKnownModels.find((m) => m.id === selectedModel);
    if (found) return found;

    const provider = resolveModelProvider(selectedModel);
    const isFree = selectedModel.endsWith(":free");
    return {
      id: selectedModel,
      name: selectedModel,
      provider,
      tier: isFree ? "free" : "paid",
      supportsVision: false,
      badge: provider === "openrouter" ? (isFree ? "Free" : "OpenRouter") : provider,
    };
  }, [allKnownModels, selectedModel]);

  const configuredVisionModels = useMemo<readonly AiModelOption[]>(() => {
    const pool = [...configuredDirectModels, ...visibleOpenRouterModels];
    return pool.filter((m) => m.supportsVision);
  }, [configuredDirectModels, visibleOpenRouterModels]);

  const hasImages = pendingAttachments.length > 0;
  const hasUrl = sourceUrl.trim().length > 0;
  const isVisionBlocked =
    hasImages && !activeModelObj.supportsVision && !(isCustomModelId && visionOverride);
  const canSubmit =
    (prompt.trim().length > 0 || hasImages || hasUrl) &&
    !isBusy &&
    !disabled &&
    uploadingCount === 0 &&
    !isVisionBlocked;

  const uploadFiles = async (files: File[]) => {
    if (!projectId || files.length === 0 || isBusy || disabled) return;
    setUploadError(null);

    const remainingSlots = MAX_DESIGN_IMAGES - pendingAttachments.length;
    if (remainingSlots <= 0) {
      setUploadError(`You can attach up to ${MAX_DESIGN_IMAGES} images per extraction.`);
      return;
    }

    const candidates = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      setUploadError(
        `Only ${remainingSlots} more image${remainingSlots === 1 ? "" : "s"} can be attached (max ${MAX_DESIGN_IMAGES}).`
      );
    }

    for (const file of candidates) {
      if (
        !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type) &&
        !/\.(png|jpe?g|webp)$/i.test(file.name)
      ) {
        setUploadError(`"${file.name}" is not a supported PNG, JPEG, or WebP image.`);
        continue;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        setUploadError(`"${file.name}" exceeds the 5 MB image upload limit.`);
        continue;
      }

      setUploadingCount((c) => c + 1);
      try {
        const formData = new FormData();
        formData.append("file", file);
        if (threadId) {
          formData.append("threadId", threadId);
        }

        const res = await fetch(`/api/projects/${projectId}/attachments`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errData.error || `Upload failed (${res.status})`);
        }

        const uploaded = (await res.json()) as DesignAttachmentDto;
        onAttachmentUploaded?.(uploaded);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Failed to upload image");
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!projectId || isBusy) return;
    setUploadError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/attachments/${attachmentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Failed to remove attachment");
      }
      onAttachmentRemoved?.(attachmentId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to remove attachment");
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!projectId || isBusy || disabled) return;
    const pastedFiles: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      void uploadFiles(pastedFiles);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!projectId || isBusy || disabled) return;
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    setIsDragActive(false);
    if (!projectId || isBusy || disabled) return;
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    if (dropped.length > 0) {
      e.preventDefault();
      void uploadFiles(dropped);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if ((hasImages || hasUrl) && onSubmitMultimodal) {
      const succeeded = await onSubmitMultimodal({
        prompt: prompt.trim(),
        model: selectedModel,
        attachmentIds: pendingAttachments.map((a) => a.id),
        sourceUrl: sourceUrl.trim() || undefined,
        visionOverride: isCustomModelId ? visionOverride : undefined,
      });

      if (succeeded !== false) {
        setPrompt("");
        setSourceUrl("");
        setShowUrlInput(false);
        setVisionOverride(false);
        setUploadError(null);
      }
      return;
    }

    if (!prompt.trim()) return;
    onSubmit(prompt.trim(), selectedModel);
    setPrompt("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredModels = useMemo(() => {
    const source: readonly AiModelOption[] =
      filterTab === "direct"
        ? configuredDirectModels
        : filterTab === "free"
          ? visibleOpenRouterModels.filter((m) => m.tier === "free")
          : filterTab === "paid"
            ? visibleOpenRouterModels.filter((m) => m.tier === "paid")
            : [...visibleOpenRouterModels, ...configuredDirectModels];

    if (!normalizedQuery) {
      return source.slice(0, 200);
    }

    return source
      .filter(
        (m) =>
          m.id.toLowerCase().includes(normalizedQuery) ||
          m.name.toLowerCase().includes(normalizedQuery) ||
          m.provider.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 200);
  }, [configuredDirectModels, filterTab, normalizedQuery, visibleOpenRouterModels]);

  const trimmedSearch = searchQuery.trim();
  const canUseCustomModel =
    trimmedSearch.length > 0 &&
    (isOpenRouterModelId(trimmedSearch) || filterTab !== "direct") &&
    !allKnownModels.some((m) => m.id.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <section
      aria-label="Prompt composer"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition-colors ${
        isDragActive ? "border-primary bg-primary/5" : "border-border"
      } ${className || ""}`}
    >
      {/* Hidden multi-file picker */}
      {projectId && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          aria-label="Upload design reference images"
          className="sr-only"
          onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (selected.length > 0) {
              void uploadFiles(selected);
            }
          }}
        />
      )}

      {/* Pending Image Chips */}
      {(pendingAttachments.length > 0 || uploadingCount > 0) && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached design images">
          {pendingAttachments.map((att) => (
            <li
              key={att.id}
              className="group relative flex items-center gap-2 rounded-lg border border-border bg-background/80 p-1.5 pr-2 text-xs"
            >
              {att.previewUrl && (
                // biome-ignore lint/performance/noImgElement: authenticated private attachment route
                <img
                  src={att.previewUrl}
                  alt={att.fileName || "Attached design reference"}
                  className="h-9 w-9 rounded object-cover border border-border/70"
                />
              )}
              <div className="min-w-0 max-w-[130px]">
                <p className="truncate text-[11px] font-medium text-foreground">
                  {att.fileName || "Image"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {att.width && att.height ? `${att.width}×${att.height}` : ""}
                  {att.sizeBytes ? ` · ${formatBytesLabel(att.sizeBytes)}` : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${att.fileName || "image"}`}
                disabled={isBusy}
                onClick={() => void handleRemoveAttachment(att.id)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}

          {uploadingCount > 0 && (
            <li className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Uploading {uploadingCount}...</span>
            </li>
          )}
        </ul>
      )}

      {/* Public Website URL Input */}
      {showUrlInput && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2 py-1">
          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            disabled={isBusy || disabled}
            placeholder="https://example.com (extract layout & theme)"
            aria-label="Reference website URL"
            className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            aria-label="Clear reference URL"
            disabled={isBusy}
            onClick={() => {
              setSourceUrl("");
              setShowUrlInput(false);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Vision Model Gating Warning Banner & Custom Override (AC-3) */}
      {(isVisionBlocked || (hasImages && !activeModelObj.supportsVision && isCustomModelId)) && (
        <div
          role={isVisionBlocked ? "alert" : "status"}
          className={`space-y-2 rounded-lg border p-2.5 text-xs text-foreground ${
            isVisionBlocked
              ? "border-destructive/40 bg-destructive/10"
              : "border-border bg-muted/40"
          }`}
        >
          {isVisionBlocked && (
            <>
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p className="font-medium">
                    {activeModelObj.name} does not support image inputs.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Switch to a vision capable model to analyze your attached screenshots, or remove
                    the images to build from text or URL only.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {configuredVisionModels.length > 0
                  ? configuredVisionModels.slice(0, 3).map((vm) => (
                      <Button
                        key={`${vm.provider}:${vm.id}`}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => selectModel(vm.id)}
                        className="h-7 gap-1 px-2 text-[11px]"
                      >
                        <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                        Switch to {vm.name}
                      </Button>
                    ))
                  : onOpenApiKeys && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onOpenApiKeys}
                        className="h-7 gap-1 px-2 text-[11px]"
                      >
                        <KeyRound className="h-3 w-3" aria-hidden="true" />
                        Add a vision provider key
                      </Button>
                    )}
              </div>
            </>
          )}

          {isCustomModelId && (
            <label className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={visionOverride}
                onChange={(e) => setVisionOverride(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              <span>Override: treat custom model ID as vision capable</span>
            </label>
          )}
        </div>
      )}

      {/* Upload or Extraction Error Banner (AC-7) */}
      {(uploadError || extractionError) && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
        >
          <div className="space-y-0.5">
            <p className="font-medium">{uploadError || extractionError?.message}</p>
            {extractionError?.suggestion && (
              <p className="text-[11px] text-muted-foreground">{extractionError.suggestion}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => {
              setUploadError(null);
              onDismissExtractionError?.();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-destructive/15"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={
          isExtractingOutline
            ? "Extracting layout, palette, and components..."
            : isStreaming
              ? "Generation in progress..."
              : hasImages || hasUrl
                ? "Add optional instructions for your design reference..."
                : "Describe the application or component you want to build, paste a screenshot, or attach a link..."
        }
        disabled={isBusy || disabled}
        rows={3}
        className="min-h-[76px] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex items-center gap-1">
          <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={isBusy || disabled}
                aria-label="Select AI model"
                className="h-8 max-w-[200px] gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Cpu className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden="true" />
                <span className="truncate">{activeModelObj.name}</span>
                {activeModelObj.provider === "openrouter" && (
                  <Badge
                    variant="outline"
                    className={`ml-0.5 shrink-0 px-1 py-0 text-[9px] ${
                      activeModelObj.tier === "free"
                        ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                        : "border-indigo-500/40 text-indigo-600 dark:text-indigo-400"
                    }`}
                  >
                    {activeModelObj.tier === "free" ? "Free" : "OR"}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80 p-0">
              <div className="border-b border-border p-2 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") {
                        e.stopPropagation();
                      }
                    }}
                    placeholder="Search or type OpenRouter model ID..."
                    aria-label="Search AI models or enter custom OpenRouter model ID"
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <fieldset
                  className="m-0 flex items-center gap-1 border-0 p-0"
                  aria-label="Filter AI models"
                >
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "free", label: "Free" },
                      { id: "paid", label: "Paid" },
                      { id: "direct", label: "Direct" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterTab(tab.id)}
                      aria-pressed={filterTab === tab.id}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                        filterTab === tab.id
                          ? "bg-indigo-600 text-white"
                          : "bg-muted/60 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </fieldset>

                {openRouterKeyBudget?.freeOnly && (
                  <p className="rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    $0 OpenRouter key budget active · Showing live free models only
                  </p>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto p-1">
                {canUseCustomModel && (
                  <>
                    <DropdownMenuItem
                      onClick={() => selectModel(trimmedSearch)}
                      className="flex items-center justify-between gap-2 text-xs text-indigo-600 dark:text-indigo-400"
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate font-mono">Use custom: {trimmedSearch}</span>
                      </span>
                      <span className="shrink-0 text-[10px] font-mono">OpenRouter</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}

                {filteredModels.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {filterTab === "direct" && configuredProviders ? (
                      <>
                        No direct Anthropic, OpenAI, or Gemini API keys configured yet. Add one in{" "}
                        <span className="font-medium text-foreground">API Keys</span> to load live
                        models.
                      </>
                    ) : filterTab === "paid" && openRouterKeyBudget?.freeOnly ? (
                      <>
                        Your OpenRouter API key has a $0 budget, so paid models are hidden. Switch
                        to <span className="font-medium text-foreground">Free</span> or{" "}
                        <span className="font-medium text-foreground">All</span> to pick a live free
                        model.
                      </>
                    ) : (
                      <>
                        No matching models. Type any OpenRouter model ID (e.g.{" "}
                        <span className="font-mono">openai/gpt-4.1</span>) above to use it.
                      </>
                    )}
                  </div>
                ) : (
                  filteredModels.map((model) => {
                    const isSelected = model.id === selectedModel;
                    return (
                      <DropdownMenuItem
                        key={`${model.provider}:${model.id}`}
                        onClick={() => selectModel(model.id)}
                        className="flex items-center justify-between gap-2 py-1.5 text-xs"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <Check
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isSelected ? "opacity-100 text-indigo-500" : "opacity-0"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 truncate font-medium">
                              <span className="truncate">{model.name}</span>
                              {model.supportsVision && (
                                <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">
                                  Vision
                                </span>
                              )}
                            </div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">
                              {model.id}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                            model.provider === "openrouter"
                              ? model.tier === "free"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {model.badge || (model.tier === "free" ? "Free" : "Paid")}
                        </span>
                      </DropdownMenuItem>
                    );
                  })
                )}
              </div>

              {onOpenApiKeys && (
                <>
                  <DropdownMenuSeparator className="my-0" />
                  <div className="p-1">
                    <DropdownMenuItem
                      onClick={() => {
                        setIsMenuOpen(false);
                        onOpenApiKeys();
                      }}
                      className="flex items-center justify-between gap-2 text-xs font-medium"
                    >
                      <span className="flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5 text-indigo-500" />
                        <span>Configure OpenRouter & API Keys</span>
                      </span>
                      {hasOpenRouterKey && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                          Active
                        </span>
                      )}
                    </DropdownMenuItem>
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {projectId && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBusy || disabled || pendingAttachments.length >= MAX_DESIGN_IMAGES}
                aria-label="Attach design image"
                title="Attach image (PNG, JPEG, WebP, max 5 MB)"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant={showUrlInput ? "secondary" : "ghost"}
                size="sm"
                disabled={isBusy || disabled}
                aria-label="Add website design URL"
                aria-expanded={showUrlInput}
                title="Inspect a public website URL"
                onClick={() => setShowUrlInput((prev) => !prev)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onCancel}
              className="h-8 gap-1.5 px-3 text-xs font-semibold"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              className="h-8 gap-1.5 bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              {isExtractingOutline ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Extracting...
                </>
              ) : hasImages || hasUrl ? (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Extract Outline
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Generate
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

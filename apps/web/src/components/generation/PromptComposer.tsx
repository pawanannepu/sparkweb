"use client";

import {
  type AiModelOption,
  type AiProvider,
  DIRECT_MODELS,
  isOpenRouterModelId,
  OPENROUTER_DEFAULT_MODELS,
  type OpenRouterKeyBudgetDto,
  resolveModelProvider,
} from "@spark/shared";
import { Check, Cpu, KeyRound, Plus, Search, Sparkles, Square } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
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

export interface PromptComposerProps {
  onSubmit: (prompt: string, model: string) => void;
  onCancel?: () => void;
  isStreaming?: boolean;
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
}

type ModelFilterTab = "all" | "free" | "paid" | "direct";

export function PromptComposer({
  onSubmit,
  onCancel,
  isStreaming = false,
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
}: PromptComposerProps) {
  const [prompt, setPrompt] = useState("");
  const [internalModel, setInternalModel] = useState("claude-3-7-sonnet");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<ModelFilterTab>("all");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const selectedModel = controlledModel ?? internalModel;

  const selectModel = (modelId: string) => {
    if (controlledModel === undefined) {
      setInternalModel(modelId);
    }
    onModelChange?.(modelId);
    setIsMenuOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (!prompt.trim() || isStreaming || disabled) return;
    onSubmit(prompt.trim(), selectedModel);
    setPrompt("");
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
      badge: provider === "openrouter" ? (isFree ? "Free" : "OpenRouter") : provider,
    };
  }, [allKnownModels, selectedModel]);

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
    <div
      className={`relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm ${className || ""}`}
    >
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isStreaming
            ? "Generation in progress..."
            : "Describe the application or component you want to build..."
        }
        disabled={isStreaming || disabled}
        rows={3}
        className="min-h-[80px] resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={isStreaming || disabled}
              aria-label="Select AI model"
              className="h-8 max-w-[230px] gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Cpu className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
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
                      Your OpenRouter API key has a $0 budget, so paid models are hidden. Switch to{" "}
                      <span className="font-medium text-foreground">Free</span> or{" "}
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
                          <div className="truncate font-medium">{model.name}</div>
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

        <div className="flex items-center gap-2">
          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onCancel}
              className="h-8 gap-1.5 px-3 text-xs font-semibold"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!prompt.trim() || disabled}
              onClick={handleSubmit}
              className="h-8 gap-1.5 bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

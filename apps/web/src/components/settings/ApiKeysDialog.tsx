"use client";

import type { AiProvider, ApiKeySummaryDto } from "@spark/shared";
import { Check, Eye, EyeOff, KeyRound, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export interface ApiKeysDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configuredKeys: ApiKeySummaryDto[];
  envProviders: AiProvider[];
  highlightedProvider?: AiProvider | null;
  onSaveKey: (provider: AiProvider, apiKey: string) => Promise<ApiKeySummaryDto>;
  onRemoveKey: (provider: AiProvider) => Promise<void>;
}

interface ProviderConfig {
  id: AiProvider;
  label: string;
  placeholder: string;
  description: string;
  isRecommended?: boolean;
}

const PROVIDER_CONFIGS: readonly ProviderConfig[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-v1-...",
    description:
      "One key for free (:free) and paid models across Claude, GPT, Gemini, DeepSeek, Qwen, and Llama using your OpenRouter credits.",
    isRecommended: true,
  },
  {
    id: "anthropic",
    label: "Anthropic (Direct)",
    placeholder: "sk-ant-...",
    description: "Optional direct key for Anthropic Claude models.",
  },
  {
    id: "openai",
    label: "OpenAI (Direct)",
    placeholder: "sk-proj-...",
    description: "Optional direct key for OpenAI GPT models.",
  },
  {
    id: "gemini",
    label: "Google Gemini (Direct)",
    placeholder: "AIza...",
    description: "Optional direct key for Google Gemini models.",
  },
];

export function ApiKeysDialog({
  open,
  onOpenChange,
  configuredKeys,
  envProviders,
  highlightedProvider,
  onSaveKey,
  onRemoveKey,
}: ApiKeysDialogProps) {
  const [drafts, setDrafts] = useState<Partial<Record<AiProvider, string>>>({});
  const [visibleMap, setVisibleMap] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [savingProvider, setSavingProvider] = useState<AiProvider | null>(null);
  const [removingProvider, setRemovingProvider] = useState<AiProvider | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSave = async (provider: AiProvider) => {
    const rawValue = (drafts[provider] || "").trim();
    if (!rawValue) {
      setStatusMessage({ type: "error", text: `Enter a ${provider} API key before saving.` });
      return;
    }

    setSavingProvider(provider);
    setStatusMessage(null);
    try {
      const saved = await onSaveKey(provider, rawValue);
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      setStatusMessage({
        type: "success",
        text: `Saved ${provider} key (${saved.keyHint}). Select any model in the composer to start building.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save API key";
      setStatusMessage({ type: "error", text: msg });
    } finally {
      setSavingProvider(null);
    }
  };

  const handleRemove = async (provider: AiProvider) => {
    setRemovingProvider(provider);
    setStatusMessage(null);
    try {
      await onRemoveKey(provider);
      setStatusMessage({ type: "success", text: `Removed saved ${provider} key.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove API key";
      setStatusMessage({ type: "error", text: msg });
    } finally {
      setRemovingProvider(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-indigo-500" />
            <span>AI Provider API Keys</span>
          </DialogTitle>
          <DialogDescription>
            Keys are encrypted at rest on the server. Add an OpenRouter key to choose any free or
            paid model in the prompt composer.
          </DialogDescription>
        </DialogHeader>

        {statusMessage && (
          <div
            role={statusMessage.type === "error" ? "alert" : "status"}
            className={`rounded-lg border px-3 py-2 text-xs ${
              statusMessage.type === "error"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <div className="space-y-4">
          {PROVIDER_CONFIGS.map((config) => {
            const savedKey = configuredKeys.find((k) => k.provider === config.id);
            const hasEnv = envProviders.includes(config.id);
            const isHighlighted = highlightedProvider === config.id;
            const isVisible = Boolean(visibleMap[config.id]);
            const draftValue = drafts[config.id] || "";
            const isBusy = savingProvider === config.id || removingProvider === config.id;

            return (
              <section
                key={config.id}
                aria-label={`${config.label} API key settings`}
                className={`rounded-xl border p-4 transition-colors ${
                  config.isRecommended || isHighlighted
                    ? "border-indigo-500/40 bg-indigo-500/5"
                    : "border-border bg-card/50"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{config.label}</span>
                    {config.isRecommended && (
                      <Badge className="gap-1 bg-indigo-600 text-[10px] text-white hover:bg-indigo-600">
                        <Sparkles className="h-2.5 w-2.5" />
                        Recommended
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {savedKey ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
                      >
                        <Check className="h-2.5 w-2.5" />
                        {savedKey.keyHint}
                      </Badge>
                    ) : hasEnv ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Env key active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Not set
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-3">{config.description}</p>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={isVisible ? "text" : "password"}
                      value={draftValue}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [config.id]: e.target.value }))
                      }
                      placeholder={
                        savedKey ? `Replace key (${savedKey.keyHint})` : config.placeholder
                      }
                      aria-label={`${config.label} API key`}
                      className="pr-9 font-mono text-xs"
                      disabled={isBusy}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleMap((prev) => ({ ...prev, [config.id]: !prev[config.id] }))
                      }
                      aria-label={
                        isVisible ? `Hide ${config.label} API key` : `Show ${config.label} API key`
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {isVisible ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSave(config.id)}
                    disabled={isBusy || !draftValue.trim()}
                    className="h-9 px-3 text-xs"
                  >
                    {savingProvider === config.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>

                  {savedKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(config.id)}
                      disabled={isBusy}
                      aria-label={`Remove ${config.label} API key`}
                      className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    >
                      {removingProvider === config.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

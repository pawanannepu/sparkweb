"use client";

import {
  type AiModelOption,
  type AiProvider,
  type ApiKeySummaryDto,
  DIRECT_MODELS,
  isOpenRouterModelId,
  OPENROUTER_DEFAULT_MODELS,
  type OpenRouterKeyBudgetDto,
  resolveModelProvider,
} from "@spark/shared";
import { useCallback, useEffect, useMemo, useState } from "react";

const SELECTED_MODEL_STORAGE_KEY = "sparkweb:selected-model";
const DEFAULT_MODEL_ID = "claude-3-7-sonnet";
const STALE_DEFAULT_OPENROUTER_IDS = new Set(OPENROUTER_DEFAULT_MODELS.map((m) => m.id));

function isAllowedUnlistedOpenRouterModel(modelId: string, freeOnly?: boolean): boolean {
  if (STALE_DEFAULT_OPENROUTER_IDS.has(modelId)) {
    return false;
  }
  if (!freeOnly) {
    return true;
  }
  return modelId === "openrouter/free" || modelId.endsWith(":free");
}

type ProviderModelsMap = Record<AiProvider, AiModelOption[]>;

const EMPTY_PROVIDER_MODELS: ProviderModelsMap = {
  openrouter: [...OPENROUTER_DEFAULT_MODELS],
  anthropic: DIRECT_MODELS.filter((m) => m.provider === "anthropic"),
  openai: DIRECT_MODELS.filter((m) => m.provider === "openai"),
  gemini: DIRECT_MODELS.filter((m) => m.provider === "gemini"),
};

function pickPreferredModelForProvider(
  provider: AiProvider,
  models: readonly AiModelOption[]
): string | null {
  if (models.length === 0) return null;

  switch (provider) {
    case "openrouter": {
      const routerFree = models.find((m) => m.id === "openrouter/free");
      if (routerFree) return routerFree.id;
      const firstTextFree = models.find((m) => m.tier === "free" && m.id.endsWith(":free"));
      if (firstTextFree) return firstTextFree.id;
      const firstFree = models.find((m) => m.tier === "free");
      if (firstFree) return firstFree.id;
      return models[0]?.id ?? null;
    }
    case "anthropic": {
      const preferredSonnet = models.find((m) => m.id.toLowerCase().includes("sonnet"));
      return preferredSonnet?.id ?? models[0]?.id ?? null;
    }
    case "openai": {
      const gpt4o = models.find((m) => m.id === "gpt-4o");
      if (gpt4o) return gpt4o.id;
      const gpt41 = models.find((m) => m.id === "gpt-4.1");
      if (gpt41) return gpt41.id;
      return models[0]?.id ?? null;
    }
    case "gemini": {
      const flash = models.find(
        (m) => m.id.includes("flash") && !m.id.includes("lite") && !m.id.includes("thinking")
      );
      return flash?.id ?? models[0]?.id ?? null;
    }
  }
}

function pickBestConfiguredModel(
  providerModels: ProviderModelsMap,
  configuredProviders: readonly AiProvider[],
  preferredProvider?: AiProvider
): string | null {
  if (preferredProvider && configuredProviders.includes(preferredProvider)) {
    const picked = pickPreferredModelForProvider(
      preferredProvider,
      providerModels[preferredProvider] ?? []
    );
    if (picked) return picked;
  }

  const priorityOrder: readonly AiProvider[] = ["anthropic", "openai", "gemini", "openrouter"];
  for (const provider of priorityOrder) {
    if (!configuredProviders.includes(provider)) continue;
    const picked = pickPreferredModelForProvider(provider, providerModels[provider] ?? []);
    if (picked) return picked;
  }

  return null;
}

export interface UseAiSettingsReturn {
  configuredKeys: ApiKeySummaryDto[];
  envProviders: AiProvider[];
  configuredProviders: AiProvider[];
  openRouterModels: AiModelOption[];
  directModels: AiModelOption[];
  providerModels: ProviderModelsMap;
  openRouterKeyBudget: OpenRouterKeyBudgetDto | null;
  selectedModel: string;
  selectedProvider: AiProvider;
  isLoadingKeys: boolean;
  isLoadingModels: boolean;
  setSelectedModel: (modelId: string) => void;
  hasKeyForProvider: (provider: AiProvider) => boolean;
  saveApiKey: (provider: AiProvider, apiKey: string) => Promise<ApiKeySummaryDto>;
  removeApiKey: (provider: AiProvider) => Promise<void>;
  refreshKeys: () => Promise<void>;
  refreshOpenRouterModels: () => Promise<void>;
  refreshAllModels: () => Promise<void>;
}

export function useAiSettings(): UseAiSettingsReturn {
  const [configuredKeys, setConfiguredKeys] = useState<ApiKeySummaryDto[]>([]);
  const [envProviders, setEnvProviders] = useState<AiProvider[]>([]);
  const [serverConfiguredProviders, setServerConfiguredProviders] = useState<AiProvider[]>([]);
  const [providerModels, setProviderModels] = useState<ProviderModelsMap>(EMPTY_PROVIDER_MODELS);
  const [openRouterKeyBudget, setOpenRouterKeyBudget] = useState<OpenRouterKeyBudgetDto | null>(
    null
  );
  const [hasLoadedLiveModels, setHasLoadedLiveModels] = useState(false);
  const [selectedModel, setSelectedModelState] = useState<string>(DEFAULT_MODEL_ID);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Restore saved model preference
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
      if (stored?.trim()) {
        setSelectedModelState(stored.trim());
      }
    } catch {
      // Ignore storage access failures
    }
  }, []);

  const setSelectedModel = useCallback((modelId: string) => {
    const trimmed = modelId.trim() || DEFAULT_MODEL_ID;
    setSelectedModelState(trimmed);
    try {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, trimmed);
    } catch {
      // Ignore storage access failures
    }
  }, []);

  const refreshKeys = useCallback(async () => {
    setIsLoadingKeys(true);
    try {
      const response = await fetch("/api/keys");
      if (!response.ok) return;
      const data = (await response.json()) as {
        keys?: ApiKeySummaryDto[];
        envProviders?: AiProvider[];
      };
      if (Array.isArray(data.keys)) {
        setConfiguredKeys(data.keys);
      }
      if (Array.isArray(data.envProviders)) {
        setEnvProviders(data.envProviders);
      }
    } catch {
      // Ignore transient load failures during initial mount / tests
    } finally {
      setIsLoadingKeys(false);
    }
  }, []);

  const loadAllModels = useCallback(
    async (opts?: {
      refresh?: boolean;
    }): Promise<{
      providerModels: ProviderModelsMap;
      configuredProviders: AiProvider[];
      openRouterKeyBudget: OpenRouterKeyBudgetDto | null;
    } | null> => {
      setIsLoadingModels(true);
      try {
        const url = opts?.refresh ? "/api/ai/models?refresh=1" : "/api/ai/models";
        const response = await fetch(url);
        if (!response.ok) return null;
        const data = (await response.json()) as {
          providerModels?: Partial<ProviderModelsMap>;
          configuredProviders?: AiProvider[];
          openRouterKeyBudget?: OpenRouterKeyBudgetDto;
        };

        const nextProviderModels: ProviderModelsMap = {
          openrouter: Array.isArray(data.providerModels?.openrouter)
            ? data.providerModels.openrouter
            : [],
          anthropic: Array.isArray(data.providerModels?.anthropic)
            ? data.providerModels.anthropic
            : [],
          openai: Array.isArray(data.providerModels?.openai) ? data.providerModels.openai : [],
          gemini: Array.isArray(data.providerModels?.gemini) ? data.providerModels.gemini : [],
        };

        const hasAnyModel = Object.values(nextProviderModels).some((list) => list.length > 0);
        if (hasAnyModel) {
          setProviderModels(nextProviderModels);
          setHasLoadedLiveModels(true);
        }
        if (Array.isArray(data.configuredProviders)) {
          setServerConfiguredProviders(data.configuredProviders);
        }
        if (data.openRouterKeyBudget) {
          setOpenRouterKeyBudget(data.openRouterKeyBudget);
        }

        return {
          providerModels: nextProviderModels,
          configuredProviders: Array.isArray(data.configuredProviders)
            ? data.configuredProviders
            : [],
          openRouterKeyBudget: data.openRouterKeyBudget ?? null,
        };
      } catch {
        return null;
      } finally {
        setIsLoadingModels(false);
      }
    },
    []
  );

  useEffect(() => {
    refreshKeys().catch(() => {});
    loadAllModels().catch(() => {});
  }, [refreshKeys, loadAllModels]);

  const configuredProviders = useMemo<AiProvider[]>(() => {
    const set = new Set<AiProvider>([
      ...configuredKeys.map((k) => k.provider),
      ...envProviders,
      ...serverConfiguredProviders,
    ]);
    if (openRouterKeyBudget?.hasKey) {
      set.add("openrouter");
    }
    return Array.from(set);
  }, [configuredKeys, envProviders, openRouterKeyBudget?.hasKey, serverConfiguredProviders]);

  const hasKeyForProvider = useCallback(
    (provider: AiProvider): boolean => {
      return configuredProviders.includes(provider);
    },
    [configuredProviders]
  );

  const openRouterModels = useMemo(() => providerModels.openrouter, [providerModels.openrouter]);

  const directModels = useMemo(
    () => [...providerModels.anthropic, ...providerModels.openai, ...providerModels.gemini],
    [providerModels.anthropic, providerModels.gemini, providerModels.openai]
  );

  // Ensure selectedModel always points to a configured provider and valid live model
  useEffect(() => {
    if (!hasLoadedLiveModels || isLoadingKeys || isLoadingModels) return;
    if (configuredProviders.length === 0) return;

    const currentProvider = resolveModelProvider(selectedModel);
    const hasCurrentKey = configuredProviders.includes(currentProvider);

    if (!hasCurrentKey) {
      const best = pickBestConfiguredModel(providerModels, configuredProviders);
      if (best) {
        setSelectedModel(best);
      }
      return;
    }

    const liveForProvider = providerModels[currentProvider] ?? [];
    if (liveForProvider.length === 0) return;

    const existsInLive = liveForProvider.some((m) => m.id === selectedModel);
    if (existsInLive) return;

    if (
      currentProvider === "openrouter" &&
      isOpenRouterModelId(selectedModel) &&
      isAllowedUnlistedOpenRouterModel(selectedModel, openRouterKeyBudget?.freeOnly)
    ) {
      return;
    }

    const bestForProvider = pickPreferredModelForProvider(currentProvider, liveForProvider);
    if (bestForProvider) {
      setSelectedModel(bestForProvider);
    }
  }, [
    configuredProviders,
    hasLoadedLiveModels,
    isLoadingKeys,
    isLoadingModels,
    openRouterKeyBudget?.freeOnly,
    providerModels,
    selectedModel,
    setSelectedModel,
  ]);

  const saveApiKey = useCallback(
    async (provider: AiProvider, apiKey: string): Promise<ApiKeySummaryDto> => {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });

      const payload = (await response.json()) as ApiKeySummaryDto & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save API key");
      }

      setConfiguredKeys((prev) => {
        const filtered = prev.filter((item) => item.provider !== payload.provider);
        return [...filtered, payload];
      });
      setServerConfiguredProviders((prev) =>
        prev.includes(provider) ? prev : [...prev, provider]
      );

      const refreshed = await loadAllModels({ refresh: true });
      const nextModelsMap = refreshed?.providerModels ?? providerModels;
      const nextProviders = Array.from(
        new Set<AiProvider>([
          ...configuredProviders,
          ...(refreshed?.configuredProviders ?? []),
          provider,
        ])
      );

      const currentProvider = resolveModelProvider(selectedModel);
      const currentProviderHasKey = nextProviders.includes(currentProvider);
      const currentLiveList = nextModelsMap[currentProvider] ?? [];
      const currentStillValid =
        currentProviderHasKey &&
        (currentLiveList.some((m) => m.id === selectedModel) ||
          (currentProvider === "openrouter" &&
            isOpenRouterModelId(selectedModel) &&
            isAllowedUnlistedOpenRouterModel(
              selectedModel,
              refreshed?.openRouterKeyBudget?.freeOnly
            )));

      if (!currentStillValid || currentProvider === provider) {
        const nextModel = pickBestConfiguredModel(nextModelsMap, nextProviders, provider);
        if (nextModel) {
          setSelectedModel(nextModel);
        }
      }

      return payload;
    },
    [configuredProviders, loadAllModels, providerModels, selectedModel, setSelectedModel]
  );

  const removeApiKey = useCallback(
    async (provider: AiProvider): Promise<void> => {
      const response = await fetch(`/api/keys?provider=${encodeURIComponent(provider)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Failed to remove API key");
      }

      setConfiguredKeys((prev) => prev.filter((item) => item.provider !== provider));
      setServerConfiguredProviders((prev) => prev.filter((p) => p !== provider));

      const refreshed = await loadAllModels({ refresh: true });
      const remainingProviders = (refreshed?.configuredProviders ?? []).filter(
        (p) => p !== provider
      );
      if (resolveModelProvider(selectedModel) === provider && remainingProviders.length > 0) {
        const fallback = pickBestConfiguredModel(
          refreshed?.providerModels ?? providerModels,
          remainingProviders
        );
        if (fallback) {
          setSelectedModel(fallback);
        }
      }
    },
    [loadAllModels, providerModels, selectedModel, setSelectedModel]
  );

  const refreshAllModels = useCallback(async () => {
    await loadAllModels({ refresh: true });
  }, [loadAllModels]);

  const selectedProvider = useMemo(() => resolveModelProvider(selectedModel), [selectedModel]);

  return {
    configuredKeys,
    envProviders,
    configuredProviders,
    openRouterModels,
    directModels,
    providerModels,
    openRouterKeyBudget,
    selectedModel,
    selectedProvider,
    isLoadingKeys,
    isLoadingModels,
    setSelectedModel,
    hasKeyForProvider,
    saveApiKey,
    removeApiKey,
    refreshKeys,
    refreshOpenRouterModels: refreshAllModels,
    refreshAllModels,
  };
}

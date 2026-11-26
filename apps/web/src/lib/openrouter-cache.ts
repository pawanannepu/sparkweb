import type { AiModelOption, AiProvider, OpenRouterKeyBudgetDto } from "@spark/shared";

export interface CachedOpenRouterModelsState {
  models: AiModelOption[];
  keyBudget: OpenRouterKeyBudgetDto;
  fetchedAt: number;
}

export interface CachedProviderModelsState {
  models: AiModelOption[];
  fetchedAt: number;
}

const globalForModelsCache = globalThis as unknown as {
  __openRouterModelsCacheMap?: Map<string, CachedOpenRouterModelsState>;
  __providerModelsCacheMap?: Map<string, CachedProviderModelsState>;
};

export function getOpenRouterModelsCacheMap(): Map<string, CachedOpenRouterModelsState> {
  if (!globalForModelsCache.__openRouterModelsCacheMap) {
    globalForModelsCache.__openRouterModelsCacheMap = new Map();
  }
  return globalForModelsCache.__openRouterModelsCacheMap;
}

export function getProviderModelsCacheMap(): Map<string, CachedProviderModelsState> {
  if (!globalForModelsCache.__providerModelsCacheMap) {
    globalForModelsCache.__providerModelsCacheMap = new Map();
  }
  return globalForModelsCache.__providerModelsCacheMap;
}

export function invalidateOpenRouterModelsCache(): void {
  globalForModelsCache.__openRouterModelsCacheMap?.clear();
}

export function invalidateProviderModelsCache(provider?: AiProvider): void {
  if (!provider || provider === "openrouter") {
    globalForModelsCache.__openRouterModelsCacheMap?.clear();
  }
  if (!provider) {
    globalForModelsCache.__providerModelsCacheMap?.clear();
    return;
  }
  const map = globalForModelsCache.__providerModelsCacheMap;
  if (!map) return;
  const prefix = `${provider}:`;
  for (const key of Array.from(map.keys())) {
    if (key.startsWith(prefix)) {
      map.delete(key);
    }
  }
}

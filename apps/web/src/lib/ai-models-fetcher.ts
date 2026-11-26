import { createHash } from "node:crypto";
import {
  AI_PROVIDERS,
  type AiModelOption,
  type AiProvider,
  DIRECT_MODELS,
  formatAnthropicModel,
  formatGeminiModel,
  formatOpenAiModel,
  formatOpenRouterModel,
  isGeminiTextModel,
  isOpenAiChatModel,
  isTextCapableOpenRouterModel,
  OPENROUTER_DEFAULT_MODELS,
  type OpenRouterKeyBudgetDto,
  type RawAnthropicModel,
  type RawGeminiModel,
  type RawOpenAiModel,
  type RawOpenRouterModel,
} from "@spark/shared";
import { getEnvProviderApiKey, resolveProviderApiKey } from "@/lib/ai-provider";
import { getOpenRouterModelsCacheMap, getProviderModelsCacheMap } from "@/lib/openrouter-cache";

export type ModelFetchSource = "live" | "cache" | "fallback" | "unconfigured";

export interface OpenRouterFetchResult {
  models: AiModelOption[];
  keyBudget: OpenRouterKeyBudgetDto;
  source: Exclude<ModelFetchSource, "unconfigured">;
}

export interface AllProviderModelsResult {
  models: AiModelOption[];
  providerModels: Record<AiProvider, AiModelOption[]>;
  configuredProviders: AiProvider[];
  openRouterKeyBudget: OpenRouterKeyBudgetDto;
  sources: Record<AiProvider, ModelFetchSource>;
}

interface OpenRouterKeyApiResponse {
  data?: {
    limit?: number | null;
    limit_remaining?: number | null;
    is_free_tier?: boolean;
    effective_budget?: {
      limit_usd?: number | null;
      remaining_usd?: number | null;
    } | null;
  };
}

interface OpenRouterCreditsApiResponse {
  data?: {
    total_credits?: number;
    total_usage?: number;
  };
}

const CACHE_TTL_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7000;

function buildKeyCacheId(prefix: string, apiKey: string | null): string {
  if (!apiKey) return `${prefix}:public`;
  return `${prefix}:${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}`;
}

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sortLiveOpenRouterModels(rawList: RawOpenRouterModel[]): AiModelOption[] {
  const rawById = new Map<string, RawOpenRouterModel>();
  for (const item of rawList) {
    rawById.set(item.id, item);
  }

  return rawList
    .filter((item) => isTextCapableOpenRouterModel(item))
    .map((item) => formatOpenRouterModel(item))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier === "free" ? -1 : 1;

      const rawA = rawById.get(a.id);
      const rawB = rawById.get(b.id);
      const aAudio = rawA?.architecture?.output_modalities?.includes("audio") ?? false;
      const bAudio = rawB?.architecture?.output_modalities?.includes("audio") ?? false;
      if (aAudio !== bAudio) return aAudio ? 1 : -1;

      if (a.id === "openrouter/free" && b.id !== "openrouter/free") return -1;
      if (b.id === "openrouter/free" && a.id !== "openrouter/free") return 1;

      const aFreeTag = a.id.endsWith(":free");
      const bFreeTag = b.id.endsWith(":free");
      if (aFreeTag !== bFreeTag) return aFreeTag ? -1 : 1;

      return a.name.localeCompare(b.name);
    });
}

async function resolveOpenRouterKeyBudget(apiKey: string): Promise<OpenRouterKeyBudgetDto> {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const keyRes = await fetchWithTimeout("https://openrouter.ai/api/v1/key", headers);
    if (!keyRes.ok) {
      return {
        hasKey: true,
        freeOnly: false,
        limitUsd: null,
        remainingUsd: null,
        isFreeTier: null,
      };
    }

    const json = (await keyRes.json()) as OpenRouterKeyApiResponse;
    const data = json?.data ?? {};
    const limitUsd =
      typeof data.effective_budget?.limit_usd === "number"
        ? data.effective_budget.limit_usd
        : typeof data.limit === "number"
          ? data.limit
          : null;
    let remainingUsd =
      typeof data.effective_budget?.remaining_usd === "number"
        ? data.effective_budget.remaining_usd
        : typeof data.limit_remaining === "number"
          ? data.limit_remaining
          : null;
    const isFreeTier = typeof data.is_free_tier === "boolean" ? data.is_free_tier : null;

    if (remainingUsd === null && isFreeTier === true) {
      try {
        const creditsRes = await fetchWithTimeout("https://openrouter.ai/api/v1/credits", headers);
        if (creditsRes.ok) {
          const creditsJson = (await creditsRes.json()) as OpenRouterCreditsApiResponse;
          const totalCredits = creditsJson?.data?.total_credits ?? 0;
          const totalUsage = creditsJson?.data?.total_usage ?? 0;
          remainingUsd = Math.max(0, totalCredits - totalUsage);
        }
      } catch {
        // Ignore optional credits lookup failures
      }
    }

    const freeOnly =
      (limitUsd !== null && limitUsd <= 0) ||
      (remainingUsd !== null && remainingUsd <= 0) ||
      (isFreeTier === true && (remainingUsd === null || remainingUsd <= 0));

    return {
      hasKey: true,
      freeOnly,
      limitUsd,
      remainingUsd,
      isFreeTier,
    };
  } catch {
    return {
      hasKey: true,
      freeOnly: false,
      limitUsd: null,
      remainingUsd: null,
      isFreeTier: null,
    };
  }
}

async function fetchOpenRouterRawModels(apiKey: string | null): Promise<RawOpenRouterModel[]> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (apiKey) {
    const userModelsRes = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/models/user",
      headers
    );
    if (userModelsRes.ok) {
      const json = (await userModelsRes.json()) as { data?: RawOpenRouterModel[] };
      if (Array.isArray(json?.data) && json.data.length > 0) {
        return json.data;
      }
    }
  }

  const publicModelsRes = await fetchWithTimeout("https://openrouter.ai/api/v1/models", headers);
  if (!publicModelsRes.ok) {
    throw new Error(`OpenRouter models API responded with ${publicModelsRes.status}`);
  }
  const json = (await publicModelsRes.json()) as { data?: RawOpenRouterModel[] };
  return Array.isArray(json?.data) ? json.data : [];
}

export async function fetchOpenRouterModelsForKey(
  apiKey: string | null,
  forceRefresh = false
): Promise<OpenRouterFetchResult> {
  const cacheId = buildKeyCacheId("openrouter", apiKey);
  const cacheMap = getOpenRouterModelsCacheMap();
  const cached = cacheMap.get(cacheId);

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      models: cached.models,
      keyBudget: cached.keyBudget,
      source: "cache",
    };
  }

  const defaultBudget: OpenRouterKeyBudgetDto = {
    hasKey: Boolean(apiKey),
    freeOnly: false,
    limitUsd: null,
    remainingUsd: null,
    isFreeTier: null,
  };

  try {
    const [keyBudget, rawList] = await Promise.all([
      apiKey ? resolveOpenRouterKeyBudget(apiKey) : Promise.resolve(defaultBudget),
      fetchOpenRouterRawModels(apiKey),
    ]);

    const validRaw = rawList.filter(
      (item): item is RawOpenRouterModel => typeof item?.id === "string" && item.id.length > 0
    );

    const liveSorted = sortLiveOpenRouterModels(validRaw);
    const filteredModels = keyBudget.freeOnly
      ? liveSorted.filter((model) => model.tier === "free")
      : liveSorted;

    if (filteredModels.length === 0) {
      const fallback = keyBudget.freeOnly
        ? OPENROUTER_DEFAULT_MODELS.filter((m) => m.tier === "free")
        : [...OPENROUTER_DEFAULT_MODELS];
      return {
        models: fallback,
        keyBudget,
        source: "fallback",
      };
    }

    cacheMap.set(cacheId, {
      models: filteredModels,
      keyBudget,
      fetchedAt: Date.now(),
    });

    return {
      models: filteredModels,
      keyBudget,
      source: "live",
    };
  } catch {
    return {
      models: [...OPENROUTER_DEFAULT_MODELS],
      keyBudget: defaultBudget,
      source: "fallback",
    };
  }
}

async function fetchAnthropicModels(
  apiKey: string,
  forceRefresh: boolean
): Promise<{ models: AiModelOption[]; source: ModelFetchSource }> {
  const cacheId = buildKeyCacheId("anthropic", apiKey);
  const cacheMap = getProviderModelsCacheMap();
  const cached = cacheMap.get(cacheId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models, source: "cache" };
  }

  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/models?limit=100", {
      Accept: "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    });
    if (!res.ok) {
      throw new Error(`Anthropic models API responded with ${res.status}`);
    }
    const json = (await res.json()) as { data?: RawAnthropicModel[] };
    const rawList = Array.isArray(json?.data) ? json.data : [];
    const models = rawList
      .filter(
        (item): item is RawAnthropicModel => typeof item?.id === "string" && item.id.length > 0
      )
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
      .map(formatAnthropicModel);

    if (models.length === 0) {
      throw new Error("Empty Anthropic models list");
    }

    cacheMap.set(cacheId, { models, fetchedAt: Date.now() });
    return { models, source: "live" };
  } catch {
    return {
      models: DIRECT_MODELS.filter((m) => m.provider === "anthropic"),
      source: "fallback",
    };
  }
}

async function fetchOpenAiModels(
  apiKey: string,
  forceRefresh: boolean
): Promise<{ models: AiModelOption[]; source: ModelFetchSource }> {
  const cacheId = buildKeyCacheId("openai", apiKey);
  const cacheMap = getProviderModelsCacheMap();
  const cached = cacheMap.get(cacheId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models, source: "cache" };
  }

  try {
    const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    });
    if (!res.ok) {
      throw new Error(`OpenAI models API responded with ${res.status}`);
    }
    const json = (await res.json()) as { data?: RawOpenAiModel[] };
    const rawList = Array.isArray(json?.data) ? json.data : [];
    const models = rawList
      .filter(
        (item): item is RawOpenAiModel =>
          typeof item?.id === "string" && item.id.length > 0 && isOpenAiChatModel(item)
      )
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
      .map(formatOpenAiModel);

    if (models.length === 0) {
      throw new Error("Empty OpenAI chat models list");
    }

    cacheMap.set(cacheId, { models, fetchedAt: Date.now() });
    return { models, source: "live" };
  } catch {
    return {
      models: DIRECT_MODELS.filter((m) => m.provider === "openai"),
      source: "fallback",
    };
  }
}

async function fetchGeminiModels(
  apiKey: string,
  forceRefresh: boolean
): Promise<{ models: AiModelOption[]; source: ModelFetchSource }> {
  const cacheId = buildKeyCacheId("gemini", apiKey);
  const cacheMap = getProviderModelsCacheMap();
  const cached = cacheMap.get(cacheId);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { models: cached.models, source: "cache" };
  }

  try {
    const res = await fetchWithTimeout(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
      {
        Accept: "application/json",
        "x-goog-api-key": apiKey,
      }
    );
    if (!res.ok) {
      throw new Error(`Gemini models API responded with ${res.status}`);
    }
    const json = (await res.json()) as { models?: RawGeminiModel[] };
    const rawList = Array.isArray(json?.models) ? json.models : [];
    const models = rawList
      .filter(
        (item): item is RawGeminiModel =>
          typeof item?.name === "string" && item.name.length > 0 && isGeminiTextModel(item)
      )
      .map(formatGeminiModel)
      .sort((a, b) => b.id.localeCompare(a.id));

    if (models.length === 0) {
      throw new Error("Empty Gemini models list");
    }

    cacheMap.set(cacheId, { models, fetchedAt: Date.now() });
    return { models, source: "live" };
  } catch {
    return {
      models: DIRECT_MODELS.filter((m) => m.provider === "gemini"),
      source: "fallback",
    };
  }
}

export async function fetchAllProviderModels(params: {
  userId: string | null;
  forceRefresh?: boolean;
}): Promise<AllProviderModelsResult> {
  const forceRefresh = Boolean(params.forceRefresh);

  const keyEntries = await Promise.all(
    AI_PROVIDERS.map(async (provider) => {
      const key = params.userId
        ? await resolveProviderApiKey({ userId: params.userId, provider })
        : getEnvProviderApiKey(provider);
      return [provider, key] as const;
    })
  );

  const keysByProvider = Object.fromEntries(keyEntries) as Record<AiProvider, string | null>;
  const configuredProviders = AI_PROVIDERS.filter((provider) => Boolean(keysByProvider[provider]));

  const [openRouterRes, anthropicRes, openaiRes, geminiRes] = await Promise.all([
    fetchOpenRouterModelsForKey(keysByProvider.openrouter, forceRefresh),
    keysByProvider.anthropic
      ? fetchAnthropicModels(keysByProvider.anthropic, forceRefresh)
      : Promise.resolve({ models: [] as AiModelOption[], source: "unconfigured" as const }),
    keysByProvider.openai
      ? fetchOpenAiModels(keysByProvider.openai, forceRefresh)
      : Promise.resolve({ models: [] as AiModelOption[], source: "unconfigured" as const }),
    keysByProvider.gemini
      ? fetchGeminiModels(keysByProvider.gemini, forceRefresh)
      : Promise.resolve({ models: [] as AiModelOption[], source: "unconfigured" as const }),
  ]);

  const providerModels: Record<AiProvider, AiModelOption[]> = {
    openrouter: openRouterRes.models,
    anthropic: anthropicRes.models,
    openai: openaiRes.models,
    gemini: geminiRes.models,
  };

  const sources: Record<AiProvider, ModelFetchSource> = {
    openrouter: openRouterRes.source,
    anthropic: anthropicRes.source,
    openai: openaiRes.source,
    gemini: geminiRes.source,
  };

  // Combined list prioritizes configured providers so default and visible models always work
  const models: AiModelOption[] = [
    ...(keysByProvider.openrouter ? providerModels.openrouter : []),
    ...providerModels.anthropic,
    ...providerModels.openai,
    ...providerModels.gemini,
    ...(!keysByProvider.openrouter ? providerModels.openrouter : []),
  ];

  return {
    models,
    providerModels,
    configuredProviders,
    openRouterKeyBudget: openRouterRes.keyBudget,
    sources,
  };
}

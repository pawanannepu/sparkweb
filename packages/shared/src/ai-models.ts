export const AI_PROVIDERS = ["openrouter", "anthropic", "openai", "gemini"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export type AiModelTier = "free" | "paid";

export interface AiModelOption {
  id: string;
  name: string;
  provider: AiProvider;
  tier: AiModelTier;
  badge?: string;
  contextLength?: number;
  pricingLabel?: string;
}

export interface OpenRouterKeyBudgetDto {
  hasKey: boolean;
  freeOnly: boolean;
  limitUsd: number | null;
  remainingUsd: number | null;
  isFreeTier: boolean | null;
}

export interface ApiKeySummaryDto {
  provider: AiProvider;
  keyHint: string;
  updatedAt: string;
  hasEnvFallback?: boolean;
}

export const DIRECT_MODEL_PROVIDERS: Record<string, AiProvider> = {
  "claude-3-7-sonnet": "anthropic",
  "claude-3-5-sonnet": "anthropic",
  "gpt-4o": "openai",
  "gemini-2.0-flash": "gemini",
};

export const DIRECT_MODELS: readonly AiModelOption[] = [
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "anthropic",
    tier: "paid",
    badge: "Default",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    tier: "paid",
    badge: "OpenAI",
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "gemini",
    tier: "paid",
    badge: "Google",
  },
];

export const OPENROUTER_DEFAULT_MODELS: readonly AiModelOption[] = [
  {
    id: "qwen/qwen-2.5-coder-32b-instruct:free",
    name: "Qwen 2.5 Coder 32B",
    provider: "openrouter",
    tier: "free",
    badge: "Free",
    pricingLabel: "Free",
  },
  {
    id: "deepseek/deepseek-chat-v3-0324:free",
    name: "DeepSeek V3 0324",
    provider: "openrouter",
    tier: "free",
    badge: "Free",
    pricingLabel: "Free",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Llama 3.3 70B Instruct",
    provider: "openrouter",
    tier: "free",
    badge: "Free",
    pricingLabel: "Free",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Gemini 2.0 Flash Exp",
    provider: "openrouter",
    tier: "free",
    badge: "Free",
    pricingLabel: "Free",
  },
  {
    id: "mistralai/devstral-small:free",
    name: "Mistral Devstral Small",
    provider: "openrouter",
    tier: "free",
    badge: "Free",
    pricingLabel: "Free",
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "anthropic/claude-3.7-sonnet",
    name: "Claude 3.7 Sonnet",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "openai/o3-mini",
    name: "OpenAI o3-mini",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "google/gemini-2.5-pro-preview",
    name: "Gemini 2.5 Pro",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "openrouter",
    tier: "paid",
    badge: "Paid",
  },
];

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function isOpenRouterModelId(modelId: string): boolean {
  const trimmed = modelId.trim();
  return trimmed.includes("/") || trimmed.endsWith(":free");
}

export function resolveModelProvider(modelId: string, explicitProvider?: AiProvider): AiProvider {
  if (explicitProvider && isAiProvider(explicitProvider)) {
    return explicitProvider;
  }

  const trimmed = modelId.trim();
  const direct = DIRECT_MODEL_PROVIDERS[trimmed];
  if (direct) {
    return direct;
  }

  if (isOpenRouterModelId(trimmed)) {
    return "openrouter";
  }

  if (/^(?:gpt-|o[1-9](?:-|$)|chatgpt-|codex-)/i.test(trimmed)) {
    return "openai";
  }

  if (/^(?:gemini-|gemma-)/i.test(trimmed)) {
    return "gemini";
  }

  if (/^claude-/i.test(trimmed)) {
    return "anthropic";
  }

  return "anthropic";
}

export interface RawOpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export function isTextCapableOpenRouterModel(raw: RawOpenRouterModel): boolean {
  const outputs = raw.architecture?.output_modalities;
  if (!Array.isArray(outputs) || outputs.length === 0) {
    return true;
  }
  return outputs.includes("text");
}

function formatPricePerMillion(rawPerToken?: string): string | null {
  if (!rawPerToken) return null;
  const parsed = Number.parseFloat(rawPerToken);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (parsed === 0) return "$0";
  const perMillion = parsed * 1_000_000;
  if (perMillion < 0.01) return `<$0.01/1M`;
  return `$${perMillion.toFixed(perMillion >= 1 ? 2 : 3).replace(/\.?0+$/, "")}/1M`;
}

export function formatOpenRouterModel(raw: RawOpenRouterModel): AiModelOption {
  const promptCost = Number.parseFloat(raw.pricing?.prompt ?? "");
  const completionCost = Number.parseFloat(raw.pricing?.completion ?? "");
  const isZeroPricing =
    Number.isFinite(promptCost) &&
    Number.isFinite(completionCost) &&
    promptCost === 0 &&
    completionCost === 0;
  const tier: AiModelTier = raw.id.endsWith(":free") || isZeroPricing ? "free" : "paid";

  const promptLabel = formatPricePerMillion(raw.pricing?.prompt);
  const completionLabel = formatPricePerMillion(raw.pricing?.completion);
  const pricingLabel =
    tier === "free"
      ? "Free"
      : promptLabel && completionLabel
        ? `${promptLabel} in · ${completionLabel} out`
        : "Paid";

  return {
    id: raw.id,
    name: raw.name?.trim() || raw.id,
    provider: "openrouter",
    tier,
    badge: tier === "free" ? "Free" : "Paid",
    contextLength: raw.context_length,
    pricingLabel,
  };
}

export interface RawAnthropicModel {
  id: string;
  display_name?: string;
  created_at?: string;
}

export function formatAnthropicModel(raw: RawAnthropicModel): AiModelOption {
  return {
    id: raw.id,
    name: raw.display_name?.trim() || raw.id,
    provider: "anthropic",
    tier: "paid",
    badge: "Anthropic",
  };
}

export interface RawOpenAiModel {
  id: string;
  created?: number;
  owned_by?: string;
  shutdown_date?: string | null;
}

export function isOpenAiChatModel(raw: RawOpenAiModel): boolean {
  const id = raw.id.toLowerCase();
  const isChatFamily =
    id.startsWith("gpt-") ||
    /^o[1-9](?:-|$)/.test(id) ||
    id.startsWith("chatgpt-") ||
    id.startsWith("codex-");
  if (!isChatFamily) {
    return false;
  }

  const excludedSubstrings = [
    "-audio",
    "-realtime",
    "-transcribe",
    "-tts",
    "-search",
    "-instruct",
    "-diarize",
    "gpt-image",
    "computer-use",
  ];
  return !excludedSubstrings.some((part) => id.includes(part));
}

export function formatOpenAiModel(raw: RawOpenAiModel): AiModelOption {
  return {
    id: raw.id,
    name: raw.id,
    provider: "openai",
    tier: "paid",
    badge: "OpenAI",
  };
}

export interface RawGeminiModel {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

export function normalizeGeminiModelId(rawName: string): string {
  return rawName.replace(/^models\//, "").trim();
}

export function isGeminiTextModel(raw: RawGeminiModel): boolean {
  const methods = raw.supportedGenerationMethods;
  if (Array.isArray(methods) && !methods.includes("generateContent")) {
    return false;
  }

  const id = normalizeGeminiModelId(raw.name).toLowerCase();
  if (!id || (!id.startsWith("gemini-") && !id.startsWith("gemma-"))) {
    return false;
  }

  const excludedSubstrings = ["embedding", "-tts", "image-generation", "imagen", "veo", "lyria"];
  return !excludedSubstrings.some((part) => id.includes(part));
}

export function formatGeminiModel(raw: RawGeminiModel): AiModelOption {
  const id = normalizeGeminiModelId(raw.name);
  return {
    id,
    name: raw.displayName?.trim() || id,
    provider: "gemini",
    tier: "paid",
    badge: "Google",
    contextLength: raw.inputTokenLimit,
  };
}

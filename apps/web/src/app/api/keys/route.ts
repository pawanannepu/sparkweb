import { db, deleteUserApiKey, getUserApiKeys, saveUserApiKey } from "@spark/db";
import { AI_PROVIDERS, type AiProvider } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getEnvProviderApiKey, resolveAppMasterEncryptionKey } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";
import { invalidateProviderModelsCache } from "@/lib/openrouter-cache";

export const dynamic = "force-dynamic";

const SaveKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(8, "API key is too short").max(512, "API key is too long"),
});

const DeleteKeySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const keys = await getUserApiKeys(db, { userId: user.id });
    const envProviders = AI_PROVIDERS.filter((provider) => Boolean(getEnvProviderApiKey(provider)));

    return NextResponse.json({
      keys: keys.map((item) => ({
        provider: item.provider as AiProvider,
        keyHint: item.keyHint,
        updatedAt: item.updatedAt.toISOString(),
      })),
      envProviders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load API keys";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SaveKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid API key payload" },
      { status: 400 }
    );
  }

  try {
    const saved = await saveUserApiKey(
      db,
      {
        userId: user.id,
        provider: parsed.data.provider,
        rawKey: parsed.data.apiKey,
      },
      resolveAppMasterEncryptionKey()
    );

    invalidateProviderModelsCache(parsed.data.provider);

    return NextResponse.json({
      provider: saved.provider as AiProvider,
      keyHint: saved.keyHint,
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save API key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queryProvider = new URL(req.url).searchParams.get("provider");
  let rawPayload: unknown = queryProvider ? { provider: queryProvider } : undefined;

  if (!rawPayload) {
    try {
      rawPayload = await req.json();
    } catch {
      return NextResponse.json({ error: "Provider is required" }, { status: 400 });
    }
  }

  const parsed = DeleteKeySchema.safeParse(rawPayload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  try {
    const deleted = await deleteUserApiKey(db, {
      userId: user.id,
      provider: parsed.data.provider,
    });
    invalidateProviderModelsCache(parsed.data.provider);
    return NextResponse.json({ deleted, provider: parsed.data.provider });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete API key";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

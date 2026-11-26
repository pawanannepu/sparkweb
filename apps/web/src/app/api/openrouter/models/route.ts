import { type NextRequest, NextResponse } from "next/server";
import { fetchOpenRouterModelsForKey } from "@/lib/ai-models-fetcher";
import { getEnvProviderApiKey, resolveProviderApiKey } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refreshParam = req.nextUrl.searchParams.get("refresh");
  const forceRefresh = refreshParam === "1" || refreshParam === "true";

  const user = await getCurrentUser(req);
  const apiKey = user
    ? await resolveProviderApiKey({ userId: user.id, provider: "openrouter" })
    : getEnvProviderApiKey("openrouter");

  const result = await fetchOpenRouterModelsForKey(apiKey, forceRefresh);
  return NextResponse.json(result);
}

import { type NextRequest, NextResponse } from "next/server";
import { fetchAllProviderModels } from "@/lib/ai-models-fetcher";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refreshParam = req.nextUrl.searchParams.get("refresh");
  const forceRefresh = refreshParam === "1" || refreshParam === "true";

  const user = await getCurrentUser(req);
  const result = await fetchAllProviderModels({
    userId: user?.id ?? null,
    forceRefresh,
  });

  return NextResponse.json(result);
}

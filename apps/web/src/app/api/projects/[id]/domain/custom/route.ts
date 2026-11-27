import { clearProjectCustomDomain, db } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getHostingAdapter } from "@/lib/publishing";
import { handlePublishingRouteError, serializeProjectDomain } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  try {
    const result = await clearProjectCustomDomain(db, {
      projectId,
      userId: user.id,
    });

    const adapter = getHostingAdapter();
    if (result.clearedCustomDomain) {
      await adapter.deleteRoute(result.clearedCustomDomain);
    }
    if (result.clearedProviderHostnameId) {
      await adapter.deleteCustomHostname(result.clearedProviderHostnameId);
    }

    return NextResponse.json({
      domain: serializeProjectDomain(result.domain),
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to remove custom domain");
  }
}

import { db, unpublishProject } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getHostingAdapter, removeRoutesForDomain } from "@/lib/publishing";
import { handlePublishingRouteError } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  try {
    const { domain } = await unpublishProject(db, {
      projectId,
      userId: user.id,
    });

    if (domain) {
      await removeRoutesForDomain(getHostingAdapter(), domain);
    }

    return NextResponse.json({ unpublished: true });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to unpublish project");
  }
}

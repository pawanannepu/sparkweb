import { db, rollbackToDeployment } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getHostingAdapter, syncRoutesForDomain } from "@/lib/publishing";
import { handlePublishingRouteError, serializeDeployment } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> }
) {
  const { id: projectId, deploymentId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(deploymentId)) {
    return NextResponse.json({ error: "Invalid project or deployment ID" }, { status: 400 });
  }

  try {
    const { deployment, domain } = await rollbackToDeployment(db, {
      projectId,
      userId: user.id,
      targetDeploymentId: deploymentId,
    });

    const hostingAdapter = getHostingAdapter();
    await syncRoutesForDomain(hostingAdapter, domain, {
      deploymentId: deployment.id,
      projectId,
      artifactKey: deployment.artifactKey ?? "",
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      deployment: serializeDeployment(deployment),
      activeDeploymentId: deployment.id,
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to roll back deployment");
  }
}

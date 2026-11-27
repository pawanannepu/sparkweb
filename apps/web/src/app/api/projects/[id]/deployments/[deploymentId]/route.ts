import { db, getDeploymentById } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handlePublishingRouteError, serializeDeployment } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
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
    const deployment = await getDeploymentById(db, {
      projectId,
      deploymentId,
      userId: user.id,
    });

    return NextResponse.json({
      deployment: serializeDeployment(deployment),
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to load deployment");
  }
}

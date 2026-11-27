import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteProjectWithHostingCleanup } from "@/lib/publishing";
import { handlePublishingRouteError } from "@/lib/publishing/serializers";
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
    const result = await deleteProjectWithHostingCleanup({
      projectId,
      userId: user.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to delete project");
  }
}

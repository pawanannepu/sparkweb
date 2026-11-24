import { db, ForbiddenError, NotFoundError, switchBranch } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
) {
  const { id: projectId, branchId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await switchBranch(db, {
      projectId,
      userId: user.id,
      branchId,
    });

    return NextResponse.json({
      activeBranch: {
        id: result.activeBranch.id,
        name: result.activeBranch.name,
        headSnapshotId: result.activeBranch.headSnapshotId,
        isMain: result.activeBranch.isMain,
        isActive: true,
        createdAt: result.activeBranch.createdAt.toISOString(),
        updatedAt: result.activeBranch.updatedAt.toISOString(),
      },
      currentSnapshotId: result.currentSnapshotId,
      files: result.files,
    });
  } catch (err: unknown) {
    const errorObj = err as Error;
    if (errorObj instanceof NotFoundError) {
      return NextResponse.json({ error: errorObj.message }, { status: 404 });
    }
    if (errorObj instanceof ForbiddenError) {
      return NextResponse.json({ error: errorObj.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to switch branch", message: errorObj.message },
      { status: 500 }
    );
  }
}

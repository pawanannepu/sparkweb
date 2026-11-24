import { db, ForbiddenError, getSnapshotById, NotFoundError } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id: projectId, snapshotId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await getSnapshotById(db, {
      projectId,
      userId: user.id,
      snapshotId,
    });

    return NextResponse.json({
      id: snapshot.id,
      projectId: snapshot.projectId,
      parentId: snapshot.parentId,
      branchId: snapshot.branchId,
      branchName: snapshot.branchName,
      treeHash: snapshot.treeHash,
      files: snapshot.files,
      fileCount: snapshot.fileCount,
      message: snapshot.message,
      trigger: snapshot.trigger,
      tag: snapshot.tag,
      restoredFromSnapshotId: snapshot.restoredFromSnapshotId,
      createdAt: snapshot.createdAt.toISOString(),
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
      { error: "Failed to fetch snapshot", message: errorObj.message },
      { status: 500 }
    );
  }
}

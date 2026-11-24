import { db, ForbiddenError, getSnapshotById, NotFoundError } from "@spark/db";
import type { SnapshotFilesMap } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { computeSnapshotDiff } from "@/lib/diff";

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

  const { searchParams } = new URL(req.url);
  const baseId = searchParams.get("baseId") || undefined;

  try {
    const targetSnapshot = await getSnapshotById(db, {
      projectId,
      userId: user.id,
      snapshotId,
    });

    let baseFiles: SnapshotFilesMap = {};
    let resolvedBaseId: string | null = null;

    if (baseId) {
      const baseSnapshot = await getSnapshotById(db, {
        projectId,
        userId: user.id,
        snapshotId: baseId,
      });
      baseFiles = baseSnapshot.files;
      resolvedBaseId = baseSnapshot.id;
    } else if (targetSnapshot.parentId) {
      const parentSnapshot = await getSnapshotById(db, {
        projectId,
        userId: user.id,
        snapshotId: targetSnapshot.parentId,
      });
      baseFiles = parentSnapshot.files;
      resolvedBaseId = parentSnapshot.id;
    }

    const diffResult = computeSnapshotDiff(
      baseFiles,
      targetSnapshot.files,
      resolvedBaseId,
      targetSnapshot.id
    );

    return NextResponse.json(diffResult);
  } catch (err: unknown) {
    const errorObj = err as Error;
    if (errorObj instanceof NotFoundError) {
      return NextResponse.json({ error: errorObj.message }, { status: 404 });
    }
    if (errorObj instanceof ForbiddenError) {
      return NextResponse.json({ error: errorObj.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to compute diff", message: errorObj.message },
      { status: 500 }
    );
  }
}

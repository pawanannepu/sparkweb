import {
  ConflictError,
  db,
  ForbiddenError,
  NotFoundError,
  rollbackSnapshot,
  ValidationError,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const rollbackSchema = z.object({
  snapshotId: z.string().min(1, "Snapshot ID is required"),
  message: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rollbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid rollback payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { snapshotId, message } = parsed.data;

  try {
    const result = await rollbackSnapshot(db, {
      projectId,
      userId: user.id,
      snapshotId,
      message,
    });

    return NextResponse.json({
      snapshot: {
        id: result.snapshot.id,
        projectId: result.snapshot.projectId,
        parentId: result.snapshot.parentId,
        branchId: result.snapshot.branchId,
        branchName: result.snapshot.branchName,
        treeHash: result.snapshot.treeHash,
        fileCount: result.snapshot.fileCount,
        message: result.snapshot.message,
        trigger: result.snapshot.trigger,
        tag: result.snapshot.tag,
        restoredFromSnapshotId: result.snapshot.restoredFromSnapshotId,
        createdAt: (result.snapshot.createdAt instanceof Date
          ? result.snapshot.createdAt
          : new Date(result.snapshot.createdAt)
        ).toISOString(),
      },
      targetSnapshotId: result.targetSnapshot.id,
      activeBranch: {
        id: result.activeBranch.id,
        name: result.activeBranch.name,
        headSnapshotId: result.activeBranch.headSnapshotId,
      },
      files: result.snapshot.files,
    });
  } catch (err: unknown) {
    const errorObj = err as Error;
    if (errorObj instanceof ConflictError) {
      return NextResponse.json({ error: errorObj.message }, { status: 409 });
    }
    if (errorObj instanceof NotFoundError) {
      return NextResponse.json({ error: errorObj.message }, { status: 404 });
    }
    if (errorObj instanceof ForbiddenError) {
      return NextResponse.json({ error: errorObj.message }, { status: 403 });
    }
    if (errorObj instanceof ValidationError) {
      return NextResponse.json({ error: errorObj.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to rollback snapshot", message: errorObj.message },
      { status: 500 }
    );
  }
}

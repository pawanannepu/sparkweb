import {
  ConflictError,
  createBranch,
  db,
  ForbiddenError,
  getProjectBranches,
  NotFoundError,
  ValidationError,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await getProjectBranches(db, {
      projectId,
      userId: user.id,
    });

    return NextResponse.json({
      branches: result.branches.map((b) => ({
        id: b.id,
        projectId: b.projectId,
        name: b.name,
        headSnapshotId: b.headSnapshotId,
        isMain: b.isMain,
        isActive: b.isActive,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
      activeBranchId: result.activeBranchId,
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
      { error: "Failed to list branches", message: errorObj.message },
      { status: 500 }
    );
  }
}

const createBranchSchema = z.object({
  name: z.string().min(1, "Branch name is required"),
  fromSnapshotId: z.string().uuid().optional(),
  switchActive: z.boolean().optional(),
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

  const parsed = createBranchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid branch payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { name, fromSnapshotId, switchActive } = parsed.data;

  try {
    const branch = await createBranch(db, {
      projectId,
      userId: user.id,
      name,
      fromSnapshotId,
      switchActive,
    });

    return NextResponse.json({
      branch: {
        id: branch.id,
        projectId: branch.projectId,
        name: branch.name,
        headSnapshotId: branch.headSnapshotId,
        isMain: branch.name === "main",
        createdAt: branch.createdAt.toISOString(),
        updatedAt: branch.updatedAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    const errorObj = err as Error;
    if (errorObj instanceof ConflictError) {
      return NextResponse.json({ error: errorObj.message }, { status: 409 });
    }
    if (errorObj instanceof ValidationError) {
      return NextResponse.json({ error: errorObj.message }, { status: 422 });
    }
    if (errorObj instanceof NotFoundError) {
      return NextResponse.json({ error: errorObj.message }, { status: 404 });
    }
    if (errorObj instanceof ForbiddenError) {
      return NextResponse.json({ error: errorObj.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to create branch", message: errorObj.message },
      { status: 500 }
    );
  }
}

import { db, deleteBranch, ForbiddenError, NotFoundError, ValidationError } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; branchId: string }> }
) {
  const { id: projectId, branchId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteBranch(db, {
      projectId,
      userId: user.id,
      branchId,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorObj = err as Error;
    if (errorObj instanceof ValidationError) {
      return NextResponse.json({ error: errorObj.message }, { status: 400 });
    }
    if (errorObj instanceof NotFoundError) {
      return NextResponse.json({ error: errorObj.message }, { status: 404 });
    }
    if (errorObj instanceof ForbiddenError) {
      return NextResponse.json({ error: errorObj.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to delete branch", message: errorObj.message },
      { status: 500 }
    );
  }
}

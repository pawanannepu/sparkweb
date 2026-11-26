import { db, ForbiddenError, getProjectWithCurrentSnapshot, NotFoundError } from "@spark/db";
import { upgradeLegacyDbTemplate } from "@spark/sandbox";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  try {
    const { currentSnapshot } = await getProjectWithCurrentSnapshot(db, {
      projectId,
      userId: user.id,
    });

    if (!currentSnapshot) {
      return NextResponse.json({
        snapshotId: null,
        treeHash: null,
        tag: null,
        files: null,
      });
    }

    return NextResponse.json({
      snapshotId: currentSnapshot.id,
      treeHash: currentSnapshot.treeHash,
      tag: currentSnapshot.tag,
      files: upgradeLegacyDbTemplate(currentSnapshot.files),
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to load current snapshot", message },
      { status: 500 }
    );
  }
}

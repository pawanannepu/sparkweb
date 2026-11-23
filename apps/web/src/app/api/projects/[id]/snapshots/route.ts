import { and, db, eq, projects, saveSnapshot } from "@spark/db";
import { filterSourceFiles } from "@spark/sandbox";
import type { SnapshotFilesMap } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createSnapshotSchema = z.object({
  files: z.record(
    z.string(),
    z.object({
      content: z.string(),
      isBinary: z.boolean().optional(),
    })
  ),
  message: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  // 1. Authenticate user
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSnapshotSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid snapshot files payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { files, message } = parsed.data;

  // 3. Verify project ownership
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 4. Filter source files to prevent node_modules or caches from persisting
  const cleanFiles = filterSourceFiles(files as SnapshotFilesMap);

  try {
    // 5. Commit immutable snapshot to PostgreSQL
    const snapshot = await saveSnapshot(db, {
      projectId,
      userId: user.id,
      files: cleanFiles,
      message: message || "Visual canvas direct styling update",
      parentId: project.currentSnapshotId || undefined,
    });

    return NextResponse.json({
      id: snapshot.id,
      treeHash: snapshot.treeHash,
      createdAt: snapshot.createdAt,
    });
  } catch (err: unknown) {
    const errorObj = err as Error;
    console.error("Save snapshot error:", errorObj);
    return NextResponse.json(
      { error: "Failed to persist snapshot", message: errorObj.message },
      { status: 500 }
    );
  }
}

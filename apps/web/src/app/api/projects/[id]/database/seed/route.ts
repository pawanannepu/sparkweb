import {
  checkActiveGeneration,
  db,
  ForbiddenError,
  getProjectWithCurrentSnapshot,
  NotFoundError,
  saveSnapshot,
} from "@spark/db";
import {
  filterSourceFiles,
  MAX_SEED_SQL_BYTES,
  STARTER_TEMPLATE_FILES,
  upgradeLegacyDbTemplate,
} from "@spark/sandbox";
import type { SnapshotFilesMap } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const saveSeedSchema = z.object({
  sql: z.string().min(1, "Seed SQL cannot be empty"),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = saveSeedSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid seed SQL payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const byteSize = Buffer.byteLength(parsed.data.sql, "utf8");
  if (byteSize > MAX_SEED_SQL_BYTES) {
    return NextResponse.json(
      { error: "Seed SQL exceeds the 500KB maximum snapshot limit" },
      { status: 400 }
    );
  }

  try {
    const isStreaming = await checkActiveGeneration(db, { projectId });
    if (isStreaming) {
      return NextResponse.json(
        { error: "Cannot save seed snapshot while generation is streaming" },
        { status: 409 }
      );
    }

    const { project, currentSnapshot } = await getProjectWithCurrentSnapshot(db, {
      projectId,
      userId: user.id,
    });

    const baseFiles: SnapshotFilesMap = currentSnapshot?.files
      ? { ...currentSnapshot.files }
      : { ...STARTER_TEMPLATE_FILES };

    const updatedFiles = upgradeLegacyDbTemplate(
      filterSourceFiles({
        ...baseFiles,
        "seed.sql": { content: parsed.data.sql },
      })
    );

    const snapshot = await saveSnapshot(db, {
      projectId,
      userId: user.id,
      files: updatedFiles,
      parentId: project.currentSnapshotId ?? undefined,
      message: "Save preview database seed data",
      trigger: "manual",
      tag: "database_seed",
    });

    const createdAt =
      snapshot.createdAt instanceof Date ? snapshot.createdAt : new Date(snapshot.createdAt);

    return NextResponse.json({
      snapshotId: snapshot.id,
      treeHash: snapshot.treeHash,
      tag: snapshot.tag,
      createdAt: createdAt.toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "Failed to save seed snapshot", message }, { status: 500 });
  }
}

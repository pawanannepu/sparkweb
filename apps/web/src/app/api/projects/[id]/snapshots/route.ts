import {
  and,
  db,
  eq,
  ForbiddenError,
  getPaginatedSnapshots,
  NotFoundError,
  projects,
  promptMessages,
  promptThreads,
  type SnapshotTrigger,
  saveSnapshot,
} from "@spark/db";
import { filterSourceFiles } from "@spark/sandbox";
import type { HealingTelemetry, SnapshotFilesMap } from "@spark/shared";
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

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId") || undefined;
  const cursor = searchParams.get("cursor") || undefined;
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;

  try {
    const result = await getPaginatedSnapshots(db, {
      projectId,
      userId: user.id,
      branchId,
      cursor,
      limit,
    });

    return NextResponse.json({
      items: result.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
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
      { error: "Failed to list snapshots", message: errorObj.message },
      { status: 500 }
    );
  }
}

const createSnapshotSchema = z.object({
  files: z.record(
    z.string(),
    z.object({
      content: z.string(),
      isBinary: z.boolean().optional(),
    })
  ),
  message: z.string().optional(),
  messageId: z.string().optional(),
  branchId: z.string().optional(),
  trigger: z.enum(["generation", "canvas", "repair", "manual", "rollback"]).optional(),
  tag: z.string().optional(),
  restoredFromSnapshotId: z.string().optional(),
  healingTelemetry: z.custom<HealingTelemetry>().optional(),
  status: z.enum(["healed", "clean", "exhausted"]).optional(),
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

  const {
    files,
    message,
    messageId,
    branchId,
    trigger,
    tag,
    restoredFromSnapshotId,
    healingTelemetry,
    status,
  } = parsed.data;

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

  // 3b. Verify prompt message ownership if messageId is provided (AC-7)
  let existingToolCalls: Record<string, unknown> | undefined;
  if (messageId) {
    const existingMsg = await db
      .select({ toolCalls: promptMessages.toolCalls })
      .from(promptMessages)
      .innerJoin(promptThreads, eq(promptMessages.threadId, promptThreads.id))
      .where(and(eq(promptMessages.id, messageId), eq(promptThreads.projectId, projectId)))
      .limit(1);

    if (existingMsg.length === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    existingToolCalls = (existingMsg[0]?.toolCalls as Record<string, unknown>) || {};
  }

  // 4. Filter source files to prevent node_modules or caches from persisting
  const cleanFiles = filterSourceFiles(files as SnapshotFilesMap);

  try {
    let snapshotMessage = message || "Generated application code verified";
    if (status === "exhausted" && !snapshotMessage.includes("exhausted")) {
      snapshotMessage = `[Unverified - healing exhausted] ${snapshotMessage}`;
    }

    // 5. Commit immutable snapshot to PostgreSQL
    const snapshot = await saveSnapshot(db, {
      projectId,
      userId: user.id,
      files: cleanFiles,
      message: snapshotMessage,
      branchId,
      trigger: trigger as SnapshotTrigger | undefined,
      tag,
      restoredFromSnapshotId,
      parentId: project.currentSnapshotId || undefined,
    });

    // 6. Update associated prompt message if messageId is provided (AC-7)
    if (messageId) {
      const updatedToolCalls = {
        ...(existingToolCalls || {}),
        ...(healingTelemetry ? { healing: healingTelemetry } : {}),
        ...(status ? { verificationStatus: status } : {}),
      };

      await db
        .update(promptMessages)
        .set({
          snapshotId: snapshot.id,
          status: "completed",
          toolCalls: updatedToolCalls,
        })
        .where(eq(promptMessages.id, messageId));
    }

    const createdDate =
      snapshot.createdAt instanceof Date ? snapshot.createdAt : new Date(snapshot.createdAt);

    return NextResponse.json({
      id: snapshot.id,
      treeHash: snapshot.treeHash,
      fileCount: snapshot.fileCount ?? 0,
      trigger: snapshot.trigger ?? "generation",
      tag: snapshot.tag ?? null,
      createdAt: createdDate.toISOString(),
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

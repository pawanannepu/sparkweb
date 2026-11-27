import {
  and,
  checkActiveGeneration,
  createDeployment,
  db,
  eq,
  getProjectDomain,
  isSnapshotExhausted,
  listDeployments,
  projects,
  snapshots,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { executeDeploymentBuild } from "@/lib/publishing";
import {
  handlePublishingRouteError,
  serializeDeployment,
  serializeProjectDomain,
} from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const createDeploymentSchema = z.object({
  snapshotId: z.string().refine(isValidUuid, { message: "Invalid snapshotId UUID" }).optional(),
  previewClean: z.boolean(),
  isStreaming: z.boolean(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const cursor = searchParams.get("cursor") || undefined;

  try {
    const result = await listDeployments(db, {
      projectId,
      userId: user.id,
      limit: Number.isNaN(limit) ? undefined : limit,
      cursor,
    });

    return NextResponse.json({
      domain: result.domain ? serializeProjectDomain(result.domain) : null,
      activeDeployment: result.activeDeployment
        ? serializeDeployment(result.activeDeployment)
        : null,
      items: result.items.map(serializeDeployment),
      nextCursor: result.nextCursor,
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to list deployments");
  }
}

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

  const parsed = createDeploymentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { snapshotId, previewClean, isStreaming } = parsed.data;

  if (isStreaming) {
    return NextResponse.json(
      { error: "Cannot publish while AI generation is streaming" },
      { status: 409 }
    );
  }

  if (!previewClean) {
    return NextResponse.json(
      {
        error:
          "Preview has unresolved runtime or build errors. Heal or dismiss errors before publishing.",
      },
      { status: 409 }
    );
  }

  try {
    const projectRows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

    const project = projectRows[0];
    if (!project) {
      return NextResponse.json({ error: `Project ${projectId} not found` }, { status: 404 });
    }
    if (project.userId !== user.id) {
      return NextResponse.json(
        { error: "You do not have access to this project" },
        { status: 403 }
      );
    }

    const activeGen = await checkActiveGeneration(db, { projectId });
    if (activeGen) {
      return NextResponse.json(
        { error: "Cannot publish while an active generation stream is running" },
        { status: 409 }
      );
    }

    const targetSnapshotId = snapshotId ?? project.currentSnapshotId;
    if (!targetSnapshotId) {
      return NextResponse.json(
        { error: "Save or generate a snapshot before publishing" },
        { status: 422 }
      );
    }

    const snapshotRows = await db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.id, targetSnapshotId), eq(snapshots.projectId, projectId)))
      .limit(1);

    const snapshot = snapshotRows[0];
    if (!snapshot) {
      return NextResponse.json(
        { error: `Snapshot ${targetSnapshotId} not found for this project` },
        { status: 404 }
      );
    }

    const exhausted = await isSnapshotExhausted(db, targetSnapshotId);
    if (exhausted) {
      return NextResponse.json(
        { error: "Cannot publish an unhealed snapshot with exhausted verification" },
        { status: 409 }
      );
    }

    const deployment = await createDeployment(db, {
      projectId,
      userId: user.id,
      snapshotId: targetSnapshotId,
    });

    const domain = await getProjectDomain(db, { projectId, userId: user.id });
    if (!domain) {
      return NextResponse.json({ error: "Project domain record not initialized" }, { status: 500 });
    }

    // Launch isolated Vite build asynchronously so HTTP 202 returns immediately (AC-2, AC-3)
    void executeDeploymentBuild({
      projectId,
      deploymentId: deployment.id,
      artifactKey: deployment.artifactKey ?? `deployments/${projectId}/${deployment.id}`,
      snapshotFiles: snapshot.files,
      domain,
    });

    return NextResponse.json(
      {
        deployment: serializeDeployment(deployment),
        domain: serializeProjectDomain(domain),
      },
      { status: 202 }
    );
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to queue deployment");
  }
}

import { randomUUID } from "node:crypto";
import { createPendingDesignAttachment, db, resolveOrCreateProjectThread } from "@spark/db";
import { MAX_IMAGE_BYTES } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sweepStalePendingAttachments } from "@/lib/multimodal/cleanup";
import { ImageValidationError, normalizeDesignImage } from "@/lib/multimodal/image-pipeline";
import {
  handleMultimodalRouteError,
  serializeDesignAttachment,
} from "@/lib/multimodal/serializers";
import { getArtifactStore } from "@/lib/publishing/deploy-service";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data payload" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: "Image file field 'file' is required" }, { status: 400 });
  }

  if (fileEntry.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image exceeds the 5 MB upload limit." }, { status: 413 });
  }

  const rawThreadId = formData.get("threadId");
  const requestedThreadId =
    typeof rawThreadId === "string" && rawThreadId.trim().length > 0
      ? rawThreadId.trim()
      : undefined;

  if (requestedThreadId && !isValidUuid(requestedThreadId)) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  try {
    const thread = await resolveOrCreateProjectThread(db, {
      projectId,
      userId: user.id,
      threadId: requestedThreadId,
    });

    const inputBuffer = Buffer.from(await fileEntry.arrayBuffer());
    const normalized = await normalizeDesignImage(inputBuffer);

    const attachmentId = randomUUID();
    const storageKey = `attachments/${projectId}/${attachmentId}`;
    const artifactStore = getArtifactStore();

    await artifactStore.putObject(storageKey, normalized.buffer, normalized.mimeType);

    try {
      const created = await createPendingDesignAttachment(db, {
        id: attachmentId,
        projectId,
        threadId: thread.id,
        userId: user.id,
        storageKey,
        fileName: fileEntry.name || "design-reference",
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        width: normalized.width,
        height: normalized.height,
      });

      await sweepStalePendingAttachments().catch(() => {});

      return NextResponse.json(serializeDesignAttachment(created), { status: 201 });
    } catch (dbErr) {
      if (artifactStore.deleteObject) {
        await artifactStore.deleteObject(storageKey).catch(() => {});
      } else {
        await artifactStore.deletePrefix(storageKey).catch(() => {});
      }
      throw dbErr;
    }
  } catch (err) {
    if (err instanceof ImageValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    return handleMultimodalRouteError(err, "Failed to upload design attachment");
  }
}

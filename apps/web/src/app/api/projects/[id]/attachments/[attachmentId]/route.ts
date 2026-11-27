import { db, deletePendingDesignAttachment, getOwnedDesignAttachment } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { handleMultimodalRouteError } from "@/lib/multimodal/serializers";
import { getArtifactStore } from "@/lib/publishing/deploy-service";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: projectId, attachmentId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(attachmentId)) {
    return NextResponse.json({ error: "Invalid project or attachment ID" }, { status: 400 });
  }

  try {
    const attachment = await getOwnedDesignAttachment(db, {
      projectId,
      attachmentId,
      userId: user.id,
    });

    if (attachment.kind !== "image" || !attachment.storageKey) {
      return NextResponse.json({ error: "Attachment has no stored image" }, { status: 404 });
    }

    const artifactStore = getArtifactStore();
    const obj = await artifactStore.getObject(attachment.storageKey);
    if (!obj) {
      return NextResponse.json({ error: "Attachment object not found" }, { status: 404 });
    }

    return new NextResponse(Buffer.from(obj.body), {
      status: 200,
      headers: {
        "Content-Type": attachment.mimeType || obj.contentType || "application/octet-stream",
        "Content-Length": String(obj.size),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return handleMultimodalRouteError(err, "Failed to read attachment");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: projectId, attachmentId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId) || !isValidUuid(attachmentId)) {
    return NextResponse.json({ error: "Invalid project or attachment ID" }, { status: 400 });
  }

  try {
    const deleted = await deletePendingDesignAttachment(db, {
      projectId,
      attachmentId,
      userId: user.id,
    });

    if (deleted.storageKey) {
      const artifactStore = getArtifactStore();
      if (artifactStore.deleteObject) {
        await artifactStore.deleteObject(deleted.storageKey);
      } else {
        await artifactStore.deletePrefix(deleted.storageKey);
      }
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleMultimodalRouteError(err, "Failed to delete attachment");
  }
}

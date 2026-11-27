import { db, getThreadState, resolveOrCreateProjectThread } from "@spark/db";
import type { DesignAttachmentDto, ThreadStateResponse } from "@spark/shared";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  handleMultimodalRouteError,
  serializeDesignAttachment,
  serializeDesignOutline,
  serializePromptMessage,
} from "@/lib/multimodal/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; threadId: string }> }
) {
  const { id: projectId, threadId: rawThreadId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  if (rawThreadId !== "default" && !isValidUuid(rawThreadId)) {
    return NextResponse.json({ error: "Invalid thread ID" }, { status: 400 });
  }

  try {
    const targetThreadId =
      rawThreadId === "default"
        ? (await resolveOrCreateProjectThread(db, { projectId, userId: user.id })).id
        : rawThreadId;

    const state = await getThreadState(db, {
      projectId,
      threadId: targetThreadId,
      userId: user.id,
    });

    const attachmentsByMessageId: Record<string, DesignAttachmentDto[]> = {};
    const pendingAttachments: DesignAttachmentDto[] = [];

    for (const attachment of state.attachments) {
      const serialized = serializeDesignAttachment(attachment);
      if (serialized.messageId) {
        const bucket = attachmentsByMessageId[serialized.messageId] ?? [];
        bucket.push(serialized);
        attachmentsByMessageId[serialized.messageId] = bucket;
      } else {
        pendingAttachments.push(serialized);
      }
    }

    const payload: ThreadStateResponse = {
      threadId: state.thread.id,
      messages: state.messages.map(serializePromptMessage),
      attachmentsByMessageId,
      pendingAttachments,
      outlines: state.outlines.map(serializeDesignOutline),
    };

    return NextResponse.json(payload);
  } catch (err) {
    return handleMultimodalRouteError(err, "Failed to load thread state");
  }
}

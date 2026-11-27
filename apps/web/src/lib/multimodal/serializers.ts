import {
  ConflictError,
  type DesignAttachment,
  type DesignOutline,
  ForbiddenError,
  NotFoundError,
  type PromptMessage,
  ValidationError,
} from "@spark/db";
import type { DesignAttachmentDto, DesignOutlineDto, ThreadMessageDto } from "@spark/shared";
import { NextResponse } from "next/server";

export function serializeDesignAttachment(row: DesignAttachment): DesignAttachmentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId,
    messageId: row.messageId ?? null,
    kind: row.kind,
    fileName: row.fileName ?? null,
    mimeType: row.mimeType ?? null,
    sizeBytes: row.sizeBytes ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    previewUrl:
      row.kind === "image" ? `/api/projects/${row.projectId}/attachments/${row.id}` : null,
    sourceUrl: row.sourceUrl ?? null,
    urlSnapshot: row.urlSnapshot ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeDesignOutline(row: DesignOutline): DesignOutlineDto {
  return {
    id: row.id,
    projectId: row.projectId,
    threadId: row.threadId,
    sourceMessageId: row.sourceMessageId ?? null,
    clonedFromOutlineId: row.clonedFromOutlineId ?? null,
    outlineMessageId: row.outlineMessageId ?? null,
    buildMessageId: row.buildMessageId ?? null,
    status: row.status,
    modelId: row.modelId,
    extractedOutline: row.extractedOutline,
    editedOutline: row.editedOutline ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializePromptMessage(row: PromptMessage): ThreadMessageDto {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls ?? null,
    snapshotId: row.snapshotId ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function handleMultimodalRouteError(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
  }
  const message = err instanceof Error ? err.message : fallbackMessage;
  return NextResponse.json({ error: message || fallbackMessage }, { status: 500 });
}

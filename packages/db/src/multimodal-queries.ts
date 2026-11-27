import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { checkActiveGeneration, type DatabaseClient } from "./queries";
import {
  type DesignAttachment,
  type DesignOutline,
  type DesignOutlinePayloadRecord,
  designAttachments,
  designOutlines,
  type PromptMessage,
  type PromptThread,
  projects,
  promptMessages,
  promptThreads,
  type UrlSnapshotRecord,
} from "./schema/index";

async function assertOwnedProject(
  db: DatabaseClient,
  projectId: string,
  userId: string
): Promise<void> {
  const rows = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const project = rows[0];
  if (!project) {
    throw new NotFoundError(`Project ${projectId} not found`);
  }
  if (project.userId !== userId) {
    throw new ForbiddenError("You do not have access to this project");
  }
}

export async function resolveOrCreateProjectThread(
  db: DatabaseClient,
  params: { projectId: string; userId: string; threadId?: string }
): Promise<PromptThread> {
  await assertOwnedProject(db, params.projectId, params.userId);

  if (params.threadId) {
    const existing = await db
      .select()
      .from(promptThreads)
      .where(
        and(eq(promptThreads.id, params.threadId), eq(promptThreads.projectId, params.projectId))
      )
      .limit(1);

    const thread = existing[0];
    if (!thread) {
      throw new NotFoundError(`Prompt thread ${params.threadId} not found for this project`);
    }
    return thread;
  }

  const existing = await db
    .select()
    .from(promptThreads)
    .where(eq(promptThreads.projectId, params.projectId))
    .orderBy(asc(promptThreads.createdAt))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(promptThreads)
    .values({
      projectId: params.projectId,
      title: "Main thread",
    })
    .returning();

  const created = inserted[0];
  if (!created) {
    throw new Error("Failed to create prompt thread");
  }
  return created;
}

export async function getThreadState(
  db: DatabaseClient,
  params: { projectId: string; threadId: string; userId: string }
): Promise<{
  thread: PromptThread;
  messages: PromptMessage[];
  attachments: DesignAttachment[];
  outlines: DesignOutline[];
}> {
  const thread = await resolveOrCreateProjectThread(db, params);

  const [messages, attachments, outlines] = await Promise.all([
    db
      .select()
      .from(promptMessages)
      .where(eq(promptMessages.threadId, thread.id))
      .orderBy(asc(promptMessages.seq)),
    db
      .select()
      .from(designAttachments)
      .where(eq(designAttachments.threadId, thread.id))
      .orderBy(asc(designAttachments.createdAt)),
    db
      .select()
      .from(designOutlines)
      .where(eq(designOutlines.threadId, thread.id))
      .orderBy(asc(designOutlines.createdAt)),
  ]);

  return {
    thread,
    messages,
    attachments,
    outlines,
  };
}

export interface CreatePendingAttachmentParams {
  id?: string;
  projectId: string;
  threadId: string;
  userId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export async function createPendingDesignAttachment(
  db: DatabaseClient,
  params: CreatePendingAttachmentParams
): Promise<DesignAttachment> {
  const thread = await resolveOrCreateProjectThread(db, {
    projectId: params.projectId,
    userId: params.userId,
    threadId: params.threadId,
  });

  const inserted = await db
    .insert(designAttachments)
    .values({
      ...(params.id ? { id: params.id } : {}),
      projectId: params.projectId,
      threadId: thread.id,
      messageId: null,
      kind: "image",
      storageKey: params.storageKey,
      sourceUrl: null,
      fileName: params.fileName,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      width: params.width,
      height: params.height,
      urlSnapshot: null,
      createdAt: new Date(),
    })
    .returning();

  const created = inserted[0];
  if (!created) {
    throw new Error("Failed to persist design attachment");
  }
  return created;
}

export async function getOwnedDesignAttachment(
  db: DatabaseClient,
  params: { projectId: string; attachmentId: string; userId: string }
): Promise<DesignAttachment> {
  const rows = await db
    .select({
      attachment: designAttachments,
      ownerUserId: projects.userId,
    })
    .from(designAttachments)
    .innerJoin(projects, eq(designAttachments.projectId, projects.id))
    .where(
      and(
        eq(designAttachments.id, params.attachmentId),
        eq(designAttachments.projectId, params.projectId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Design attachment ${params.attachmentId} not found`);
  }
  if (row.ownerUserId !== params.userId) {
    throw new ForbiddenError("You do not have access to this attachment");
  }
  return row.attachment;
}

export async function deletePendingDesignAttachment(
  db: DatabaseClient,
  params: { projectId: string; attachmentId: string; userId: string }
): Promise<DesignAttachment> {
  const existing = await getOwnedDesignAttachment(db, params);
  if (existing.messageId !== null) {
    throw new ConflictError("Cannot delete an attachment that is already attached to a message");
  }

  const deleted = await db
    .delete(designAttachments)
    .where(
      and(
        eq(designAttachments.id, params.attachmentId),
        eq(designAttachments.projectId, params.projectId),
        isNull(designAttachments.messageId)
      )
    )
    .returning();

  const row = deleted[0];
  if (!row) {
    throw new ConflictError("Attachment could not be deleted because it was already attached");
  }
  return row;
}

export async function listStalePendingAttachments(
  db: DatabaseClient,
  params?: { olderThanMs?: number; limit?: number }
): Promise<DesignAttachment[]> {
  const olderThanMs = params?.olderThanMs ?? 24 * 60 * 60 * 1000;
  const limit = params?.limit ?? 25;
  const cutoff = new Date(Date.now() - olderThanMs);

  return db
    .select()
    .from(designAttachments)
    .where(and(isNull(designAttachments.messageId), lt(designAttachments.createdAt, cutoff)))
    .orderBy(asc(designAttachments.createdAt))
    .limit(limit);
}

export async function deleteUnattachedAttachmentRow(
  db: DatabaseClient,
  attachmentId: string
): Promise<boolean> {
  const deleted = await db
    .delete(designAttachments)
    .where(and(eq(designAttachments.id, attachmentId), isNull(designAttachments.messageId)))
    .returning({ id: designAttachments.id });

  return deleted.length > 0;
}

export async function getPendingAttachmentsByIds(
  db: DatabaseClient,
  params: { projectId: string; threadId: string; attachmentIds: string[] }
): Promise<DesignAttachment[]> {
  if (params.attachmentIds.length === 0) {
    return [];
  }

  const uniqueIds = Array.from(new Set(params.attachmentIds));
  const rows = await db
    .select()
    .from(designAttachments)
    .where(
      and(
        inArray(designAttachments.id, uniqueIds),
        eq(designAttachments.projectId, params.projectId),
        eq(designAttachments.threadId, params.threadId),
        eq(designAttachments.kind, "image"),
        isNull(designAttachments.messageId)
      )
    )
    .orderBy(asc(designAttachments.createdAt));

  if (rows.length !== uniqueIds.length) {
    throw new ValidationError(
      "One or more attachments are missing, belong to another thread, or were already used"
    );
  }

  return rows;
}

export async function acquireOutlineExtractionLease(
  db: DatabaseClient,
  params: { projectId: string; threadId: string; userId: string; ttlMs?: number }
): Promise<PromptThread> {
  await resolveOrCreateProjectThread(db, {
    projectId: params.projectId,
    userId: params.userId,
    threadId: params.threadId,
  });

  const activeGen = await checkActiveGeneration(db, { projectId: params.projectId });
  if (activeGen) {
    throw new ConflictError("A code generation run is currently active for this project.");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMs ?? 60_000));

  const updated = await db
    .update(promptThreads)
    .set({
      outlineLockExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(promptThreads.id, params.threadId),
        eq(promptThreads.projectId, params.projectId),
        or(isNull(promptThreads.outlineLockExpiresAt), lt(promptThreads.outlineLockExpiresAt, now))
      )
    )
    .returning();

  const locked = updated[0];
  if (!locked) {
    throw new ConflictError("An outline extraction is already in progress for this thread.");
  }

  return locked;
}

export async function releaseOutlineExtractionLease(
  db: DatabaseClient,
  params: { threadId: string }
): Promise<void> {
  await db
    .update(promptThreads)
    .set({
      outlineLockExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(promptThreads.id, params.threadId));
}

export interface CreateExtractedOutlineTurnParams {
  projectId: string;
  threadId: string;
  userId: string;
  promptText: string;
  modelId: string;
  attachmentIds: string[];
  sourceUrl?: string | null;
  urlSnapshot?: UrlSnapshotRecord | null;
  extractedOutline: DesignOutlinePayloadRecord;
}

export async function createExtractedOutlineTurn(
  db: DatabaseClient,
  params: CreateExtractedOutlineTurnParams
): Promise<{
  outline: DesignOutline;
  userMessage: PromptMessage;
  outlineMessage: PromptMessage;
  attachments: DesignAttachment[];
}> {
  await assertOwnedProject(db, params.projectId, params.userId);

  return db.transaction(async (tx) => {
    const threadRows = await tx
      .select()
      .from(promptThreads)
      .where(
        and(eq(promptThreads.id, params.threadId), eq(promptThreads.projectId, params.projectId))
      )
      .limit(1);

    if (!threadRows[0]) {
      throw new NotFoundError(`Prompt thread ${params.threadId} not found`);
    }

    const pendingImages = await getPendingAttachmentsByIds(tx as unknown as DatabaseClient, {
      projectId: params.projectId,
      threadId: params.threadId,
      attachmentIds: params.attachmentIds,
    });

    await tx
      .update(designOutlines)
      .set({
        status: "superseded",
        updatedAt: new Date(),
      })
      .where(and(eq(designOutlines.threadId, params.threadId), eq(designOutlines.status, "ready")));

    const maxSeqRows = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${promptMessages.seq}), 0)::int` })
      .from(promptMessages)
      .where(eq(promptMessages.threadId, params.threadId));
    const baseSeq = maxSeqRows[0]?.maxSeq ?? 0;

    const insertedUser = await tx
      .insert(promptMessages)
      .values({
        threadId: params.threadId,
        seq: baseSeq + 1,
        role: "user",
        content: params.promptText,
        status: "completed",
        toolCalls: null,
      })
      .returning();

    const userMessage = insertedUser[0];
    if (!userMessage) {
      throw new Error("Failed to insert user prompt message");
    }

    const linkedAttachments: DesignAttachment[] = [];
    if (pendingImages.length > 0) {
      const updatedImages = await tx
        .update(designAttachments)
        .set({ messageId: userMessage.id })
        .where(
          and(
            inArray(
              designAttachments.id,
              pendingImages.map((img) => img.id)
            ),
            isNull(designAttachments.messageId)
          )
        )
        .returning();

      if (updatedImages.length !== pendingImages.length) {
        throw new ConflictError("One or more pending attachments were consumed concurrently");
      }
      linkedAttachments.push(...updatedImages);
    }

    if (params.sourceUrl) {
      const insertedUrl = await tx
        .insert(designAttachments)
        .values({
          projectId: params.projectId,
          threadId: params.threadId,
          messageId: userMessage.id,
          kind: "url",
          storageKey: null,
          sourceUrl: params.sourceUrl,
          fileName: null,
          mimeType: "text/html",
          sizeBytes: null,
          width: null,
          height: null,
          urlSnapshot: params.urlSnapshot ?? null,
        })
        .returning();

      if (insertedUrl[0]) {
        linkedAttachments.push(insertedUrl[0]);
      }
    }

    const insertedAssistant = await tx
      .insert(promptMessages)
      .values({
        threadId: params.threadId,
        seq: baseSeq + 2,
        role: "assistant",
        content: params.extractedOutline.appSummary,
        status: "completed",
        toolCalls: null,
      })
      .returning();

    const outlineMessage = insertedAssistant[0];
    if (!outlineMessage) {
      throw new Error("Failed to insert outline assistant message");
    }

    const insertedOutline = await tx
      .insert(designOutlines)
      .values({
        projectId: params.projectId,
        threadId: params.threadId,
        sourceMessageId: userMessage.id,
        clonedFromOutlineId: null,
        outlineMessageId: outlineMessage.id,
        buildMessageId: null,
        status: "ready",
        modelId: params.modelId,
        extractedOutline: params.extractedOutline,
        editedOutline: null,
      })
      .returning();

    const outline = insertedOutline[0];
    if (!outline) {
      throw new Error("Failed to insert design outline");
    }

    return {
      outline,
      userMessage,
      outlineMessage,
      attachments: linkedAttachments,
    };
  });
}

export async function getOwnedDesignOutline(
  db: DatabaseClient,
  params: { projectId: string; outlineId: string; userId: string }
): Promise<DesignOutline> {
  const rows = await db
    .select({
      outline: designOutlines,
      ownerUserId: projects.userId,
    })
    .from(designOutlines)
    .innerJoin(projects, eq(designOutlines.projectId, projects.id))
    .where(
      and(eq(designOutlines.id, params.outlineId), eq(designOutlines.projectId, params.projectId))
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Design outline ${params.outlineId} not found`);
  }
  if (row.ownerUserId !== params.userId) {
    throw new ForbiddenError("You do not have access to this design outline");
  }
  return row.outline;
}

export async function updateDesignOutline(
  db: DatabaseClient,
  params: {
    projectId: string;
    outlineId: string;
    userId: string;
    editedOutline?: DesignOutlinePayloadRecord;
    reset?: boolean;
  }
): Promise<DesignOutline> {
  const existing = await getOwnedDesignOutline(db, params);
  if (existing.status !== "ready") {
    throw new ConflictError("Only ready outlines can be edited");
  }

  const nextEditedOutline = params.reset ? null : (params.editedOutline ?? existing.editedOutline);
  const updatedRows = await db
    .update(designOutlines)
    .set({
      editedOutline: nextEditedOutline,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(designOutlines.id, params.outlineId),
        eq(designOutlines.projectId, params.projectId),
        eq(designOutlines.status, "ready")
      )
    )
    .returning();

  const updated = updatedRows[0];
  if (!updated) {
    throw new ConflictError("Outline is no longer in ready state");
  }
  return updated;
}

export async function cloneDesignOutline(
  db: DatabaseClient,
  params: { projectId: string; outlineId: string; userId: string }
): Promise<{ outline: DesignOutline; outlineMessage: PromptMessage }> {
  const source = await getOwnedDesignOutline(db, params);

  return db.transaction(async (tx) => {
    await tx
      .update(designOutlines)
      .set({
        status: "superseded",
        updatedAt: new Date(),
      })
      .where(and(eq(designOutlines.threadId, source.threadId), eq(designOutlines.status, "ready")));

    const maxSeqRows = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${promptMessages.seq}), 0)::int` })
      .from(promptMessages)
      .where(eq(promptMessages.threadId, source.threadId));
    const nextSeq = (maxSeqRows[0]?.maxSeq ?? 0) + 1;

    const effective = source.editedOutline ?? source.extractedOutline;
    const insertedMessage = await tx
      .insert(promptMessages)
      .values({
        threadId: source.threadId,
        seq: nextSeq,
        role: "assistant",
        content: effective.appSummary,
        status: "completed",
        toolCalls: null,
      })
      .returning();

    const outlineMessage = insertedMessage[0];
    if (!outlineMessage) {
      throw new Error("Failed to insert cloned outline assistant message");
    }

    const insertedOutline = await tx
      .insert(designOutlines)
      .values({
        projectId: source.projectId,
        threadId: source.threadId,
        sourceMessageId: null,
        clonedFromOutlineId: source.id,
        outlineMessageId: outlineMessage.id,
        buildMessageId: null,
        status: "ready",
        modelId: source.modelId,
        extractedOutline: source.extractedOutline,
        editedOutline: source.editedOutline,
      })
      .returning();

    const outline = insertedOutline[0];
    if (!outline) {
      throw new Error("Failed to clone design outline");
    }

    return { outline, outlineMessage };
  });
}

export async function startOutlineBuildTransaction(
  db: DatabaseClient,
  params: {
    projectId: string;
    outlineId: string;
    userId: string;
    editedOutline?: DesignOutlinePayloadRecord;
  }
): Promise<{
  outline: DesignOutline;
  assistantMessage: PromptMessage;
  threadId: string;
  sourceUserContent: string | null;
}> {
  const existing = await getOwnedDesignOutline(db, params);

  return db.transaction(async (tx) => {
    const activeGen = await checkActiveGeneration(tx as unknown as DatabaseClient, {
      projectId: params.projectId,
    });
    if (activeGen) {
      throw new ConflictError("Another generation is already running for this project");
    }

    if (existing.status !== "ready") {
      throw new ConflictError(
        "This design outline is already confirmed or superseded. Clone it to start a new build."
      );
    }

    const maxSeqRows = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${promptMessages.seq}), 0)::int` })
      .from(promptMessages)
      .where(eq(promptMessages.threadId, existing.threadId));
    const nextSeq = (maxSeqRows[0]?.maxSeq ?? 0) + 1;

    const insertedAssistant = await tx
      .insert(promptMessages)
      .values({
        threadId: existing.threadId,
        seq: nextSeq,
        role: "assistant",
        content: "",
        status: "streaming",
        toolCalls: null,
      })
      .returning();

    const assistantMessage = insertedAssistant[0];
    if (!assistantMessage) {
      throw new Error("Failed to create assistant build message");
    }

    const updatedOutlines = await tx
      .update(designOutlines)
      .set({
        status: "confirmed",
        editedOutline:
          params.editedOutline !== undefined ? params.editedOutline : existing.editedOutline,
        buildMessageId: assistantMessage.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(designOutlines.id, existing.id),
          eq(designOutlines.projectId, params.projectId),
          eq(designOutlines.status, "ready")
        )
      )
      .returning();

    const confirmed = updatedOutlines[0];
    if (!confirmed) {
      throw new ConflictError("Design outline could not be locked for build");
    }

    let sourceUserContent: string | null = null;
    if (confirmed.sourceMessageId) {
      const sourceRows = await tx
        .select({ content: promptMessages.content })
        .from(promptMessages)
        .where(eq(promptMessages.id, confirmed.sourceMessageId))
        .limit(1);
      sourceUserContent = sourceRows[0]?.content ?? null;
    }

    return {
      outline: confirmed,
      assistantMessage,
      threadId: existing.threadId,
      sourceUserContent,
    };
  });
}

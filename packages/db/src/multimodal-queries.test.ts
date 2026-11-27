import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase } from "./client";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { runPgliteMigrations } from "./migrate";
import {
  acquireOutlineExtractionLease,
  cloneDesignOutline,
  createExtractedOutlineTurn,
  createPendingDesignAttachment,
  deletePendingDesignAttachment,
  deleteUnattachedAttachmentRow,
  getOwnedDesignAttachment,
  getOwnedDesignOutline,
  getPendingAttachmentsByIds,
  getThreadState,
  listStalePendingAttachments,
  releaseOutlineExtractionLease,
  resolveOrCreateProjectThread,
  startOutlineBuildTransaction,
  updateDesignOutline,
} from "./multimodal-queries";
import { createProject, deleteProject } from "./queries";
import {
  type DesignOutlinePayloadRecord,
  designAttachments,
  designOutlines,
  promptMessages,
  promptThreads,
  users,
} from "./schema/index";

function sampleOutline(summary = "Tracker App"): DesignOutlinePayloadRecord {
  return {
    appSummary: summary,
    palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "Buttons" }],
    typography: {
      headingFont: "Plus Jakarta Sans",
      bodyFont: "Inter",
      scaleNotes: "Clear hierarchy",
    },
    layoutSections: [{ id: "s1", name: "Header", description: "Top nav", enabled: true }],
    componentHierarchy: [{ id: "c1", name: "AppShell", role: "Layout", enabled: true }],
    additionalNotes: "",
  };
}

describe("multimodal queries integration with PGlite", () => {
  let pglite: PGlite;
  let testDb: ReturnType<typeof createPgliteDatabase>;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    pglite = new PGlite();
    testDb = createPgliteDatabase(pglite);
    await runPgliteMigrations(testDb);

    const [owner] = await testDb
      .insert(users)
      .values({ email: "mm-owner@example.com", name: "Owner" })
      .returning();
    const [other] = await testDb
      .insert(users)
      .values({ email: "mm-other@example.com", name: "Other" })
      .returning();
    if (!owner || !other) throw new Error("Failed to seed users");
    ownerId = owner.id;
    otherId = other.id;
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  }, 15_000);

  // covers: AC-1, AC-4
  it("resolves project thread, enforces tenant ownership, and manages pending attachments", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "MM Project" });
    const thread = await resolveOrCreateProjectThread(testDb, {
      projectId: project.id,
      userId: ownerId,
    });

    await expect(
      resolveOrCreateProjectThread(testDb, { projectId: project.id, userId: otherId })
    ).rejects.toThrow(ForbiddenError);

    const attachment = await createPendingDesignAttachment(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      storageKey: `attachments/${project.id}/att-1`,
      fileName: "shot.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      width: 800,
      height: 600,
    });

    const loaded = await getOwnedDesignAttachment(testDb, {
      projectId: project.id,
      attachmentId: attachment.id,
      userId: ownerId,
    });
    expect(loaded.fileName).toBe("shot.png");

    await expect(
      getOwnedDesignAttachment(testDb, {
        projectId: project.id,
        attachmentId: attachment.id,
        userId: otherId,
      })
    ).rejects.toThrow(ForbiddenError);

    const pending = await getPendingAttachmentsByIds(testDb, {
      projectId: project.id,
      threadId: thread.id,
      attachmentIds: [attachment.id, attachment.id],
    });
    expect(pending).toHaveLength(1);

    const deleted = await deletePendingDesignAttachment(testDb, {
      projectId: project.id,
      attachmentId: attachment.id,
      userId: ownerId,
    });
    expect(deleted.id).toBe(attachment.id);
  });

  // covers: AC-6
  it("enforces exclusive 60s extraction lease and rejects concurrent extraction or active generation", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "Lease Project" });
    const thread = await resolveOrCreateProjectThread(testDb, {
      projectId: project.id,
      userId: ownerId,
    });

    await acquireOutlineExtractionLease(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      ttlMs: 60_000,
    });

    await expect(
      acquireOutlineExtractionLease(testDb, {
        projectId: project.id,
        threadId: thread.id,
        userId: ownerId,
      })
    ).rejects.toThrow(ConflictError);

    await releaseOutlineExtractionLease(testDb, { threadId: thread.id });

    // Expired lease can be reclaimed
    await testDb
      .update(promptThreads)
      .set({ outlineLockExpiresAt: new Date(Date.now() - 10_000) })
      .where(eq(promptThreads.id, thread.id));

    await acquireOutlineExtractionLease(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
    });
    await releaseOutlineExtractionLease(testDb, { threadId: thread.id });

    // Active streaming message blocks outline lease
    await testDb.insert(promptMessages).values({
      threadId: thread.id,
      seq: 1,
      role: "assistant",
      content: "",
      status: "streaming",
    });

    await expect(
      acquireOutlineExtractionLease(testDb, {
        projectId: project.id,
        threadId: thread.id,
        userId: ownerId,
      })
    ).rejects.toThrow(ConflictError);
  });

  // covers: AC-1, AC-6, AC-8, AC-9
  it("persists outline turns, supersedes prior ready outlines, edits, builds, clones, and enforces unique index", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "Lifecycle Project" });
    const thread = await resolveOrCreateProjectThread(testDb, {
      projectId: project.id,
      userId: ownerId,
    });

    const att = await createPendingDesignAttachment(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      storageKey: `attachments/${project.id}/img-a`,
      fileName: "ref.webp",
      mimeType: "image/webp",
      sizeBytes: 1024,
      width: 640,
      height: 480,
    });

    const turn1 = await createExtractedOutlineTurn(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      promptText: "First prompt",
      modelId: "claude-3-7-sonnet",
      attachmentIds: [att.id],
      sourceUrl: "https://example.com",
      urlSnapshot: {
        title: "Example",
        headings: ["Hero"],
        colors: ["#2563EB"],
        fonts: ["Inter"],
        landmarkCount: 2,
      },
      extractedOutline: sampleOutline("First App"),
    });

    expect(turn1.outline.status).toBe("ready");
    expect(turn1.attachments).toHaveLength(2);

    // Once attached, deleting the attachment fails with 409 ConflictError
    await expect(
      deletePendingDesignAttachment(testDb, {
        projectId: project.id,
        attachmentId: att.id,
        userId: ownerId,
      })
    ).rejects.toThrow(ConflictError);

    // Already used attachment ID cannot be reused
    await expect(
      getPendingAttachmentsByIds(testDb, {
        projectId: project.id,
        threadId: thread.id,
        attachmentIds: [att.id],
      })
    ).rejects.toThrow(ValidationError);

    // Partial unique index rejects duplicate uncloned outline for same sourceMessageId
    await expect(
      testDb.insert(designOutlines).values({
        projectId: project.id,
        threadId: thread.id,
        sourceMessageId: turn1.userMessage.id,
        clonedFromOutlineId: null,
        status: "ready",
        modelId: "claude-3-7-sonnet",
        extractedOutline: sampleOutline("Dup"),
      })
    ).rejects.toThrow();

    // Second extraction supersedes turn1 outline
    const turn2 = await createExtractedOutlineTurn(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      promptText: "Second prompt",
      modelId: "claude-3-7-sonnet",
      attachmentIds: [],
      extractedOutline: sampleOutline("Second App"),
    });

    const reloadedTurn1 = await getOwnedDesignOutline(testDb, {
      projectId: project.id,
      outlineId: turn1.outline.id,
      userId: ownerId,
    });
    expect(reloadedTurn1.status).toBe("superseded");

    // Edit and reset on ready outline
    const edited = await updateDesignOutline(testDb, {
      projectId: project.id,
      outlineId: turn2.outline.id,
      userId: ownerId,
      editedOutline: sampleOutline("Edited Second App"),
    });
    expect(edited.editedOutline?.appSummary).toBe("Edited Second App");

    const reset = await updateDesignOutline(testDb, {
      projectId: project.id,
      outlineId: turn2.outline.id,
      userId: ownerId,
      reset: true,
    });
    expect(reset.editedOutline).toBeNull();

    // Build transaction atomically confirms outline and creates streaming assistant buildMessage
    const buildStart = await startOutlineBuildTransaction(testDb, {
      projectId: project.id,
      outlineId: turn2.outline.id,
      userId: ownerId,
      editedOutline: sampleOutline("Final Build Summary"),
    });
    expect(buildStart.outline.status).toBe("confirmed");
    expect(buildStart.outline.buildMessageId).toBe(buildStart.assistantMessage.id);
    expect(buildStart.sourceUserContent).toBe("Second prompt");

    // Editing or rebuilding confirmed outline returns ConflictError
    await expect(
      updateDesignOutline(testDb, {
        projectId: project.id,
        outlineId: turn2.outline.id,
        userId: ownerId,
        reset: true,
      })
    ).rejects.toThrow(ConflictError);

    // Clone confirmed outline into a fresh ready draft without synthetic user message
    const cloned = await cloneDesignOutline(testDb, {
      projectId: project.id,
      outlineId: turn2.outline.id,
      userId: ownerId,
    });
    expect(cloned.outline.status).toBe("ready");
    expect(cloned.outline.sourceMessageId).toBeNull();
    expect(cloned.outline.clonedFromOutlineId).toBe(turn2.outline.id);
    expect(cloned.outline.editedOutline?.appSummary).toBe("Final Build Summary");

    const threadState = await getThreadState(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
    });
    expect(threadState.outlines).toHaveLength(3);
    expect(threadState.attachments).toHaveLength(2);
  });

  // covers: AC-1, AC-10
  it("lists stale unattached attachments in bounded batches and cascades deletes with project", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "Cleanup Project" });
    const thread = await resolveOrCreateProjectThread(testDb, {
      projectId: project.id,
      userId: ownerId,
    });

    const staleCreatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [staleRow] = await testDb
      .insert(designAttachments)
      .values({
        projectId: project.id,
        threadId: thread.id,
        kind: "image",
        storageKey: `attachments/${project.id}/stale-1`,
        fileName: "stale.png",
        mimeType: "image/png",
        sizeBytes: 100,
        width: 10,
        height: 10,
        createdAt: staleCreatedAt,
      })
      .returning();

    const fresh = await createPendingDesignAttachment(testDb, {
      projectId: project.id,
      threadId: thread.id,
      userId: ownerId,
      storageKey: `attachments/${project.id}/fresh-1`,
      fileName: "fresh.png",
      mimeType: "image/png",
      sizeBytes: 100,
      width: 10,
      height: 10,
    });

    const staleList = await listStalePendingAttachments(testDb, { limit: 25 });
    expect(staleList.some((r) => r.id === staleRow?.id)).toBe(true);
    expect(staleList.some((r) => r.id === fresh.id)).toBe(false);

    if (staleRow) {
      expect(await deleteUnattachedAttachmentRow(testDb, staleRow.id)).toBe(true);
      expect(await deleteUnattachedAttachmentRow(testDb, staleRow.id)).toBe(false);
    }

    await deleteProject(testDb, { projectId: project.id, userId: ownerId });
    const remaining = await testDb
      .select()
      .from(designAttachments)
      .where(eq(designAttachments.projectId, project.id));
    expect(remaining).toHaveLength(0);
  });
});

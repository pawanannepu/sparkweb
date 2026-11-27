// @vitest-environment node
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@spark/db";
import { describe, expect, it } from "vitest";
import {
  handleMultimodalRouteError,
  serializeDesignAttachment,
  serializeDesignOutline,
  serializePromptMessage,
} from "./serializers";

describe("multimodal serializers and error mapping", () => {
  // covers: AC-4
  it("serializes image and url attachments with previewUrl only for images", () => {
    const createdAt = new Date("2026-11-28T00:00:00.000Z");

    const imageDto = serializeDesignAttachment({
      id: "att-1",
      projectId: "proj-1",
      threadId: "thread-1",
      messageId: null,
      kind: "image",
      storageKey: "attachments/proj-1/att-1",
      sourceUrl: null,
      fileName: "mockup.png",
      mimeType: "image/png",
      sizeBytes: 4096,
      width: 1200,
      height: 800,
      urlSnapshot: null,
      createdAt,
    });

    expect(imageDto.previewUrl).toBe("/api/projects/proj-1/attachments/att-1");
    expect(imageDto.createdAt).toBe("2026-11-28T00:00:00.000Z");

    const urlDto = serializeDesignAttachment({
      id: "att-2",
      projectId: "proj-1",
      threadId: "thread-1",
      messageId: "msg-1",
      kind: "url",
      storageKey: null,
      sourceUrl: "https://example.com",
      fileName: null,
      mimeType: "text/html",
      sizeBytes: null,
      width: null,
      height: null,
      urlSnapshot: {
        title: "Example",
        headings: ["Hi"],
        colors: ["#2563EB"],
        fonts: ["Inter"],
        landmarkCount: 1,
      },
      createdAt,
    });

    expect(urlDto.previewUrl).toBeNull();
    expect(urlDto.sourceUrl).toBe("https://example.com");
  });

  // covers: AC-8
  it("serializes design outlines and prompt messages with ISO timestamps", () => {
    const now = new Date("2026-11-28T01:00:00.000Z");
    const outlineDto = serializeDesignOutline({
      id: "out-1",
      projectId: "proj-1",
      threadId: "thread-1",
      sourceMessageId: "msg-1",
      clonedFromOutlineId: null,
      outlineMessageId: "msg-2",
      buildMessageId: null,
      status: "ready",
      modelId: "claude-3-7-sonnet",
      extractedOutline: {
        appSummary: "App",
        palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "CTA" }],
        typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
        layoutSections: [{ id: "s1", name: "Header", description: "Top", enabled: true }],
        componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root", enabled: true }],
        additionalNotes: "",
      },
      editedOutline: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(outlineDto.createdAt).toBe("2026-11-28T01:00:00.000Z");
    expect(outlineDto.editedOutline).toBeNull();

    const msgDto = serializePromptMessage({
      id: "msg-1",
      threadId: "thread-1",
      seq: 1,
      role: "user",
      content: "Build this",
      toolCalls: null,
      snapshotId: null,
      status: "completed",
      createdAt: now,
    });
    expect(msgDto.createdAt).toBe("2026-11-28T01:00:00.000Z");
  });

  // covers: AC-7
  it("maps domain errors to expected HTTP status codes", async () => {
    expect(handleMultimodalRouteError(new NotFoundError("missing"), "fallback").status).toBe(404);
    expect(handleMultimodalRouteError(new ForbiddenError("denied"), "fallback").status).toBe(403);
    expect(handleMultimodalRouteError(new ConflictError("busy"), "fallback").status).toBe(409);
    expect(handleMultimodalRouteError(new ValidationError("bad"), "fallback").status).toBe(422);

    const errRes = handleMultimodalRouteError(new Error("boom"), "fallback");
    expect(errRes.status).toBe(500);
    expect(await errRes.json()).toEqual({ error: "boom" });
  });
});

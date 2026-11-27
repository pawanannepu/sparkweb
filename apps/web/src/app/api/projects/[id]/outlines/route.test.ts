// @vitest-environment node
import { ConflictError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UrlExtractionError } from "@/lib/multimodal/url-extractor";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveProviderApiKey: vi.fn(),
  resolveOrCreateProjectThread: vi.fn(),
  acquireOutlineExtractionLease: vi.fn(),
  releaseOutlineExtractionLease: vi.fn(),
  getPendingAttachmentsByIds: vi.fn(),
  createExtractedOutlineTurn: vi.fn(),
  extractDesignFromUrl: vi.fn(),
  extractDesignOutline: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/ai-provider", () => ({
  resolveProviderApiKey: mocks.resolveProviderApiKey,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    resolveOrCreateProjectThread: mocks.resolveOrCreateProjectThread,
    acquireOutlineExtractionLease: mocks.acquireOutlineExtractionLease,
    releaseOutlineExtractionLease: mocks.releaseOutlineExtractionLease,
    getPendingAttachmentsByIds: mocks.getPendingAttachmentsByIds,
    createExtractedOutlineTurn: mocks.createExtractedOutlineTurn,
  };
});

vi.mock("@/lib/multimodal/url-extractor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/multimodal/url-extractor")>();
  return {
    ...actual,
    extractDesignFromUrl: mocks.extractDesignFromUrl,
  };
});

vi.mock("@/lib/multimodal/outline-extractor", () => ({
  extractDesignOutline: mocks.extractDesignOutline,
}));

vi.mock("@/lib/publishing/deploy-service", () => ({
  getArtifactStore: () => ({
    getObject: mocks.getObject,
  }),
}));

import { DEFAULT_MULTIMODAL_PROMPT } from "@spark/shared";
import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const THREAD_ID = "00000000-0000-0000-0000-000000000002";
const ATTACHMENT_ID = "00000000-0000-0000-0000-000000000010";
const USER_ID = "00000000-0000-0000-0000-000000000003";

const SAMPLE_OUTLINE = {
  appSummary: "Extracted app",
  palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "Buttons" }],
  typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
  layoutSections: [{ id: "s1", name: "Header", description: "Top nav", enabled: true }],
  componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root", enabled: true }],
  additionalNotes: "",
};

describe("POST /api/projects/[id]/outlines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.resolveProviderApiKey.mockResolvedValue("sk-test");
    mocks.resolveOrCreateProjectThread.mockResolvedValue({
      id: THREAD_ID,
      projectId: PROJECT_ID,
    });
    mocks.acquireOutlineExtractionLease.mockResolvedValue({ id: THREAD_ID });
    mocks.releaseOutlineExtractionLease.mockResolvedValue(undefined);
    mocks.getPendingAttachmentsByIds.mockResolvedValue([]);
    mocks.extractDesignOutline.mockResolvedValue(SAMPLE_OUTLINE);
  });

  // covers: AC-2, AC-3
  it("validates auth, empty inputs, and vision gating unless visionOverride is true", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, { method: "POST" }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const emptyRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, {
        method: "POST",
        body: JSON.stringify({ prompt: "  ", attachmentIds: [] }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(emptyRes.status).toBe(400);

    const gatedRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "Build this",
          model: "deepseek/deepseek-r1",
          attachmentIds: [ATTACHMENT_ID],
        }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(gatedRes.status).toBe(400);
    expect(await gatedRes.json()).toMatchObject({ code: "VISION_MODEL_REQUIRED" });
  });

  // covers: AC-6, AC-7
  it("returns 409 on active extraction lease and structured 422/502 on UrlExtractionError while releasing lease", async () => {
    mocks.acquireOutlineExtractionLease.mockRejectedValueOnce(
      new ConflictError("An outline extraction is already in progress for this thread.")
    );
    const leaseRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, {
        method: "POST",
        body: JSON.stringify({ sourceUrl: "https://example.com" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(leaseRes.status).toBe(409);

    mocks.extractDesignFromUrl.mockRejectedValueOnce(
      new UrlExtractionError("URL_JS_SHELL", 422, "Empty JS shell", "Paste a screenshot instead.")
    );
    const urlErrRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, {
        method: "POST",
        body: JSON.stringify({ sourceUrl: "https://spa.example.com" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(urlErrRes.status).toBe(422);
    expect(await urlErrRes.json()).toEqual({
      error: "Empty JS shell",
      code: "URL_JS_SHELL",
      suggestion: "Paste a screenshot instead.",
    });
    expect(mocks.releaseOutlineExtractionLease).toHaveBeenCalledWith(expect.anything(), {
      threadId: THREAD_ID,
    });
  });

  // covers: AC-2, AC-3, AC-5, AC-6
  it("extracts URL and image references, applies fallback prompt when blank, and persists outline turn", async () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    mocks.getPendingAttachmentsByIds.mockResolvedValueOnce([
      {
        id: ATTACHMENT_ID,
        storageKey: `attachments/${PROJECT_ID}/${ATTACHMENT_ID}`,
        fileName: "wireframe.png",
        mimeType: "image/png",
      },
    ]);
    mocks.getObject.mockResolvedValueOnce({
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
      size: 4,
    });
    mocks.extractDesignFromUrl.mockResolvedValueOnce({
      finalUrl: "https://example.com/",
      snapshot: {
        title: "Example",
        headings: ["Hero"],
        colors: ["#2563EB"],
        fonts: ["Inter"],
        landmarkCount: 2,
      },
      sanitizedContextXml: "<untrusted-website-reference></untrusted-website-reference>",
    });
    mocks.createExtractedOutlineTurn.mockResolvedValueOnce({
      outline: {
        id: "00000000-0000-0000-0000-000000000020",
        projectId: PROJECT_ID,
        threadId: THREAD_ID,
        sourceMessageId: "00000000-0000-0000-0000-000000000030",
        clonedFromOutlineId: null,
        outlineMessageId: "00000000-0000-0000-0000-000000000031",
        buildMessageId: null,
        status: "ready",
        modelId: "deepseek/deepseek-r1",
        extractedOutline: SAMPLE_OUTLINE,
        editedOutline: null,
        createdAt: now,
        updatedAt: now,
      },
      userMessage: {
        id: "00000000-0000-0000-0000-000000000030",
        threadId: THREAD_ID,
        seq: 1,
        role: "user",
        content: DEFAULT_MULTIMODAL_PROMPT,
        toolCalls: null,
        snapshotId: null,
        status: "completed",
        createdAt: now,
      },
      outlineMessage: {
        id: "00000000-0000-0000-0000-000000000031",
        threadId: THREAD_ID,
        seq: 2,
        role: "assistant",
        content: "Extracted app",
        toolCalls: null,
        snapshotId: null,
        status: "completed",
        createdAt: now,
      },
      attachments: [],
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines`, {
        method: "POST",
        body: JSON.stringify({
          prompt: "   ",
          model: "deepseek/deepseek-r1",
          visionOverride: true,
          attachmentIds: [ATTACHMENT_ID],
          sourceUrl: "https://example.com",
        }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(201);
    expect(mocks.extractDesignOutline).toHaveBeenCalledWith(
      expect.objectContaining({
        promptText: DEFAULT_MULTIMODAL_PROMPT,
        images: [expect.objectContaining({ fileName: "wireframe.png", mimeType: "image/png" })],
      })
    );
    expect(mocks.releaseOutlineExtractionLease).toHaveBeenCalledTimes(1);
  });
});

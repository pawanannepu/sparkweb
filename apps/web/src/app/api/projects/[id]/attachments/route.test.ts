// @vitest-environment node
import { MAX_IMAGE_BYTES } from "@spark/shared";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveOrCreateProjectThread: vi.fn(),
  createPendingDesignAttachment: vi.fn(),
  sweepStalePendingAttachments: vi.fn(),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  deletePrefix: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    resolveOrCreateProjectThread: mocks.resolveOrCreateProjectThread,
    createPendingDesignAttachment: mocks.createPendingDesignAttachment,
  };
});

vi.mock("@/lib/multimodal/cleanup", () => ({
  sweepStalePendingAttachments: mocks.sweepStalePendingAttachments,
}));

vi.mock("@/lib/publishing/deploy-service", () => ({
  getArtifactStore: () => ({
    putObject: mocks.putObject,
    deleteObject: mocks.deleteObject,
    deletePrefix: mocks.deletePrefix,
  }),
}));

import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const THREAD_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("POST /api/projects/[id]/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.resolveOrCreateProjectThread.mockResolvedValue({
      id: THREAD_ID,
      projectId: PROJECT_ID,
    });
    mocks.putObject.mockResolvedValue(undefined);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.sweepStalePendingAttachments.mockResolvedValue(0);
  });

  // covers: AC-4
  it("returns 401 when unauthenticated and 400 for invalid project or thread UUIDs", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badProjectRes = await POST(
      new NextRequest("http://localhost/api/projects/bad-id/attachments", { method: "POST" }),
      { params: Promise.resolve({ id: "bad-id" }) }
    );
    expect(badProjectRes.status).toBe(400);

    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" }));
    form.append("threadId", "not-a-uuid");
    const badThreadRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(badThreadRes.status).toBe(400);
  });

  // covers: AC-4
  it("rejects missing file, oversized uploads (>5MB), and invalid magic bytes", async () => {
    const missingForm = new FormData();
    const missingRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: missingForm,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(missingRes.status).toBe(400);

    const bigForm = new FormData();
    bigForm.append(
      "file",
      new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "huge.png", { type: "image/png" })
    );
    const bigRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: bigForm,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(bigRes.status).toBe(413);

    const fakeForm = new FormData();
    fakeForm.append(
      "file",
      new File([Buffer.from("<svg>bad</svg>")], "fake.png", { type: "image/png" })
    );
    const fakeRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: fakeForm,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(fakeRes.status).toBe(400);
  });

  // covers: AC-4, AC-10
  it("normalizes image, stores in ArtifactStore, persists DB row, and triggers stale sweep", async () => {
    const pngBuffer = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 20, g: 100, b: 220 } },
    })
      .png()
      .toBuffer();

    mocks.createPendingDesignAttachment.mockImplementation(async (_db, input) => ({
      id: input.id,
      projectId: input.projectId,
      threadId: input.threadId,
      messageId: null,
      kind: "image",
      storageKey: input.storageKey,
      sourceUrl: null,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      urlSnapshot: null,
      createdAt: new Date("2026-11-28T00:00:00.000Z"),
    }));

    const form = new FormData();
    form.append("file", new File([new Uint8Array(pngBuffer)], "mockup.png", { type: "image/png" }));
    form.append("threadId", THREAD_ID);

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe("image");
    expect(body.mimeType).toBe("image/png");
    expect(body.width).toBe(120);
    expect(body.height).toBe(80);
    expect(body.previewUrl).toBe(`/api/projects/${PROJECT_ID}/attachments/${body.id}`);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.sweepStalePendingAttachments).toHaveBeenCalledTimes(1);
  });

  // covers: AC-4
  it("deletes uploaded blob if DB persistence throws", async () => {
    const pngBuffer = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();

    mocks.createPendingDesignAttachment.mockRejectedValueOnce(new Error("DB write failed"));

    const form = new FormData();
    form.append("file", new File([new Uint8Array(pngBuffer)], "fail.png", { type: "image/png" }));

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments`, {
        method: "POST",
        body: form,
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(500);
    expect(mocks.putObject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteObject).toHaveBeenCalledTimes(1);
  });
});

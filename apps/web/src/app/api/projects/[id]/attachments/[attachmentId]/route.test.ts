// @vitest-environment node
import { ConflictError, ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getOwnedDesignAttachment: vi.fn(),
  deletePendingDesignAttachment: vi.fn(),
  getObject: vi.fn(),
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
    getOwnedDesignAttachment: mocks.getOwnedDesignAttachment,
    deletePendingDesignAttachment: mocks.deletePendingDesignAttachment,
  };
});

vi.mock("@/lib/publishing/deploy-service", () => ({
  getArtifactStore: () => ({
    getObject: mocks.getObject,
    deleteObject: mocks.deleteObject,
    deletePrefix: mocks.deletePrefix,
  }),
}));

import { DELETE, GET } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const ATTACHMENT_ID = "00000000-0000-0000-0000-000000000010";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("/api/projects/[id]/attachments/[attachmentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-4
  it("GET validates auth, UUIDs, missing attachment, and streams bytes with nosniff header", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badRes = await GET(new NextRequest("http://localhost/api/projects/bad/attachments/bad"), {
      params: Promise.resolve({ id: "bad", attachmentId: "bad" }),
    });
    expect(badRes.status).toBe(400);

    mocks.getOwnedDesignAttachment.mockResolvedValueOnce({
      id: ATTACHMENT_ID,
      kind: "image",
      storageKey: `attachments/${PROJECT_ID}/${ATTACHMENT_ID}`,
      mimeType: "image/png",
    });
    mocks.getObject.mockResolvedValueOnce(null);
    const missingBlobRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(missingBlobRes.status).toBe(404);

    mocks.getOwnedDesignAttachment.mockResolvedValueOnce({
      id: ATTACHMENT_ID,
      kind: "image",
      storageKey: `attachments/${PROJECT_ID}/${ATTACHMENT_ID}`,
      mimeType: "image/png",
    });
    mocks.getObject.mockResolvedValueOnce({
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
      size: 4,
    });

    const okRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("content-type")).toBe("image/png");
    expect(okRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await okRes.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  // covers: AC-4, AC-10
  it("DELETE removes pending attachment row and stored object, and maps 403/404/409 errors", async () => {
    mocks.deletePendingDesignAttachment.mockRejectedValueOnce(
      new ConflictError("Already attached")
    );
    const conflictRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(conflictRes.status).toBe(409);

    mocks.deletePendingDesignAttachment.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);

    mocks.deletePendingDesignAttachment.mockRejectedValueOnce(new NotFoundError("Missing"));
    const notFoundRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(notFoundRes.status).toBe(404);

    mocks.deletePendingDesignAttachment.mockResolvedValueOnce({
      id: ATTACHMENT_ID,
      storageKey: `attachments/${PROJECT_ID}/${ATTACHMENT_ID}`,
    });
    const okRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/attachments/${ATTACHMENT_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, attachmentId: ATTACHMENT_ID }) }
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ deleted: true });
    expect(mocks.deleteObject).toHaveBeenCalledWith(`attachments/${PROJECT_ID}/${ATTACHMENT_ID}`);
  });
});

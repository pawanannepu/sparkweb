// @vitest-environment node
import { ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  cloneDesignOutline: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    cloneDesignOutline: mocks.cloneDesignOutline,
  };
});

import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const OUTLINE_ID = "00000000-0000-0000-0000-000000000020";
const THREAD_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("POST /api/projects/[id]/outlines/[outlineId]/clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-9
  it("validates auth and UUIDs and maps NotFound/Forbidden errors", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}/clone`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await POST(
      new NextRequest("http://localhost/api/projects/bad/outlines/bad/clone", { method: "POST" }),
      { params: Promise.resolve({ id: "bad", outlineId: "bad" }) }
    );
    expect(badIdRes.status).toBe(400);

    mocks.cloneDesignOutline.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}/clone`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);

    mocks.cloneDesignOutline.mockRejectedValueOnce(new NotFoundError("Not found"));
    const notFoundRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}/clone`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(notFoundRes.status).toBe(404);
  });

  // covers: AC-9
  it("returns 201 with cloned ready outline and assistant message without synthetic user message", async () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    mocks.cloneDesignOutline.mockResolvedValueOnce({
      outline: {
        id: "00000000-0000-0000-0000-000000000021",
        projectId: PROJECT_ID,
        threadId: THREAD_ID,
        sourceMessageId: null,
        clonedFromOutlineId: OUTLINE_ID,
        outlineMessageId: "00000000-0000-0000-0000-000000000031",
        buildMessageId: null,
        status: "ready",
        modelId: "claude-3-7-sonnet",
        extractedOutline: {
          appSummary: "Cloned",
          palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "CTA" }],
          typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
          layoutSections: [{ id: "s1", name: "Header", description: "Top", enabled: true }],
          componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root", enabled: true }],
          additionalNotes: "",
        },
        editedOutline: null,
        createdAt: now,
        updatedAt: now,
      },
      outlineMessage: {
        id: "00000000-0000-0000-0000-000000000031",
        threadId: THREAD_ID,
        seq: 5,
        role: "assistant",
        content: "Cloned",
        toolCalls: null,
        snapshotId: null,
        status: "completed",
        createdAt: now,
      },
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}/clone`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.outline.status).toBe("ready");
    expect(json.outline.sourceMessageId).toBeNull();
    expect(json.outline.clonedFromOutlineId).toBe(OUTLINE_ID);
    expect(json.outlineMessage.role).toBe("assistant");
  });
});

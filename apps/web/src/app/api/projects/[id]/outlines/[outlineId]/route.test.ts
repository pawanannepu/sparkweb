// @vitest-environment node
import { ConflictError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  updateDesignOutline: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    updateDesignOutline: mocks.updateDesignOutline,
  };
});

import { PATCH } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const OUTLINE_ID = "00000000-0000-0000-0000-000000000020";
const USER_ID = "00000000-0000-0000-0000-000000000003";

const VALID_PAYLOAD = {
  appSummary: "Updated summary",
  palette: [{ id: "p1", role: "Primary", hex: "#2563EB", usage: "CTA" }],
  typography: { headingFont: "Inter", bodyFont: "Inter", scaleNotes: "Clean" },
  layoutSections: [{ id: "s1", name: "Header", description: "Top", enabled: true }],
  componentHierarchy: [{ id: "c1", name: "AppShell", role: "Root", enabled: true }],
  additionalNotes: "Notes",
};

describe("PATCH /api/projects/[id]/outlines/[outlineId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-8
  it("validates auth, UUIDs, JSON payload, and requires editedOutline or reset", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ reset: true }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await PATCH(
      new NextRequest("http://localhost/api/projects/bad/outlines/bad", {
        method: "PATCH",
        body: JSON.stringify({ reset: true }),
      }),
      { params: Promise.resolve({ id: "bad", outlineId: "bad" }) }
    );
    expect(badIdRes.status).toBe(400);

    const emptyBodyRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(emptyBodyRes.status).toBe(400);
  });

  // covers: AC-8
  it("persists editedOutline, supports reset, and maps non ready conflict to 409", async () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    mocks.updateDesignOutline.mockResolvedValueOnce({
      id: OUTLINE_ID,
      projectId: PROJECT_ID,
      threadId: "00000000-0000-0000-0000-000000000002",
      sourceMessageId: null,
      clonedFromOutlineId: null,
      outlineMessageId: null,
      buildMessageId: null,
      status: "ready",
      modelId: "claude-3-7-sonnet",
      extractedOutline: VALID_PAYLOAD,
      editedOutline: VALID_PAYLOAD,
      createdAt: now,
      updatedAt: now,
    });

    const editRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ editedOutline: VALID_PAYLOAD }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(editRes.status).toBe(200);
    const editJson = await editRes.json();
    expect(editJson.outline.editedOutline.appSummary).toBe("Updated summary");

    mocks.updateDesignOutline.mockRejectedValueOnce(
      new ConflictError("Only ready outlines can be edited")
    );
    const conflictRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/outlines/${OUTLINE_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ reset: true }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID, outlineId: OUTLINE_ID }) }
    );
    expect(conflictRes.status).toBe(409);
  });
});

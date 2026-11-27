// @vitest-environment node
import { ForbiddenError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  resolveOrCreateProjectThread: vi.fn(),
  getThreadState: vi.fn(),
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
    getThreadState: mocks.getThreadState,
  };
});

import { GET } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const THREAD_ID = "00000000-0000-0000-0000-000000000002";
const MSG_ID = "00000000-0000-0000-0000-000000000030";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("GET /api/projects/[id]/threads/[threadId]/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-4, AC-8
  it("validates auth and UUIDs and supports default thread resolution", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/threads/default/state`),
      { params: Promise.resolve({ id: PROJECT_ID, threadId: "default" }) }
    );
    expect(unauthRes.status).toBe(401);

    const badThreadRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/threads/not-uuid/state`),
      { params: Promise.resolve({ id: PROJECT_ID, threadId: "not-uuid" }) }
    );
    expect(badThreadRes.status).toBe(400);

    mocks.resolveOrCreateProjectThread.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/threads/default/state`),
      { params: Promise.resolve({ id: PROJECT_ID, threadId: "default" }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });

  // covers: AC-4, AC-8
  it("hydrates messages, outlines, and separates pending vs attached attachments", async () => {
    const now = new Date("2026-11-28T00:00:00.000Z");
    mocks.resolveOrCreateProjectThread.mockResolvedValueOnce({ id: THREAD_ID });
    mocks.getThreadState.mockResolvedValueOnce({
      thread: { id: THREAD_ID, projectId: PROJECT_ID },
      messages: [
        {
          id: MSG_ID,
          threadId: THREAD_ID,
          seq: 1,
          role: "user",
          content: "Build",
          toolCalls: null,
          snapshotId: null,
          status: "completed",
          createdAt: now,
        },
      ],
      attachments: [
        {
          id: "00000000-0000-0000-0000-000000000010",
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          messageId: MSG_ID,
          kind: "image",
          storageKey: `attachments/${PROJECT_ID}/10`,
          sourceUrl: null,
          fileName: "attached.png",
          mimeType: "image/png",
          sizeBytes: 100,
          width: 50,
          height: 50,
          urlSnapshot: null,
          createdAt: now,
        },
        {
          id: "00000000-0000-0000-0000-000000000011",
          projectId: PROJECT_ID,
          threadId: THREAD_ID,
          messageId: null,
          kind: "image",
          storageKey: `attachments/${PROJECT_ID}/11`,
          sourceUrl: null,
          fileName: "pending.png",
          mimeType: "image/png",
          sizeBytes: 200,
          width: 80,
          height: 80,
          urlSnapshot: null,
          createdAt: now,
        },
      ],
      outlines: [],
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/threads/default/state`),
      { params: Promise.resolve({ id: PROJECT_ID, threadId: "default" }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threadId).toBe(THREAD_ID);
    expect(json.messages).toHaveLength(1);
    expect(json.attachmentsByMessageId[MSG_ID]).toHaveLength(1);
    expect(json.pendingAttachments).toHaveLength(1);
    expect(json.pendingAttachments[0].fileName).toBe("pending.png");
  });
});

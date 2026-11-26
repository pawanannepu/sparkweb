import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckActiveGeneration, mockGetProjectWithCurrentSnapshot, mockSaveSnapshot } =
  vi.hoisted(() => ({
    mockCheckActiveGeneration: vi.fn(),
    mockGetProjectWithCurrentSnapshot: vi.fn(),
    mockSaveSnapshot: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    checkActiveGeneration: mockCheckActiveGeneration,
    getProjectWithCurrentSnapshot: mockGetProjectWithCurrentSnapshot,
    saveSnapshot: mockSaveSnapshot,
  };
});

import { ForbiddenError, NotFoundError } from "@spark/db";
import { MAX_SEED_SQL_BYTES } from "@spark/sandbox";
import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

const VALID_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const MOCK_USER = {
  id: "user-123",
  email: "creator@example.com",
  name: "Creator",
};

describe("POST /api/projects/[id]/database/seed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckActiveGeneration.mockResolvedValue(false);
    mockGetProjectWithCurrentSnapshot.mockResolvedValue({
      project: {
        id: VALID_PROJECT_ID,
        userId: MOCK_USER.id,
        currentSnapshotId: "snap-parent-1",
      },
      currentSnapshot: {
        id: "snap-parent-1",
        files: {
          "src/App.tsx": { content: "export default function App() { return null; }" },
        },
      },
      threadCount: 1,
    });
    mockSaveSnapshot.mockResolvedValue({
      id: "snap-seed-1",
      treeHash: "hash-seed-1",
      tag: "database_seed",
      createdAt: new Date("2026-11-25T12:00:00.000Z"),
    });
  });

  // covers: AC-8
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: JSON.stringify({ sql: "SELECT 1;" }) }
    );

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });

    expect(res.status).toBe(401);
  });

  // covers: AC-8
  it("returns 400 for invalid project UUID, bad JSON, or empty SQL", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);

    const badIdReq = new NextRequest("http://localhost:3000/api/projects/bad-id/database/seed", {
      method: "POST",
      body: JSON.stringify({ sql: "SELECT 1;" }),
    });
    expect((await POST(badIdReq, { params: Promise.resolve({ id: "bad-id" }) })).status).toBe(400);

    const badJsonReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: "{not-json" }
    );
    expect(
      (await POST(badJsonReq, { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(400);

    const emptySqlReq = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: JSON.stringify({ sql: "" }) }
    );
    expect(
      (await POST(emptySqlReq, { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(400);
  });

  // covers: AC-8
  it("rejects seed SQL payloads larger than 500KB with HTTP 400", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    const oversizedSql = "x".repeat(MAX_SEED_SQL_BYTES + 1);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: JSON.stringify({ sql: oversizedSql }) }
    );

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("500KB");
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
  });

  // covers: AC-8, AC-9
  it("returns 409 Conflict when an active generation is streaming", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    mockCheckActiveGeneration.mockResolvedValueOnce(true);
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: JSON.stringify({ sql: "INSERT INTO t VALUES (1);" }) }
    );

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });

    expect(res.status).toBe(409);
    expect(mockSaveSnapshot).not.toHaveBeenCalled();
  });

  // covers: AC-8
  it("persists seed.sql into a manual snapshot tagged database_seed", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(MOCK_USER);
    const seedSql = 'INSERT INTO "demo_items" ("id", "name") VALUES (1, \'Sample\');';
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`,
      { method: "POST", body: JSON.stringify({ sql: seedSql }) }
    );

    const res = await POST(req, { params: Promise.resolve({ id: VALID_PROJECT_ID }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: VALID_PROJECT_ID,
        userId: MOCK_USER.id,
        parentId: "snap-parent-1",
        trigger: "manual",
        tag: "database_seed",
        files: expect.objectContaining({
          "src/App.tsx": { content: "export default function App() { return null; }" },
          "seed.sql": { content: seedSql },
        }),
      })
    );
    expect(data).toEqual({
      snapshotId: "snap-seed-1",
      treeHash: "hash-seed-1",
      tag: "database_seed",
      createdAt: "2026-11-25T12:00:00.000Z",
    });
  });

  // covers: AC-8
  it("falls back to starter template files when project has no prior snapshot and maps 403/404", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(MOCK_USER);
    mockGetProjectWithCurrentSnapshot.mockResolvedValueOnce({
      project: { id: VALID_PROJECT_ID, userId: MOCK_USER.id, currentSnapshotId: null },
      currentSnapshot: null,
      threadCount: 0,
    });

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/projects/${VALID_PROJECT_ID}/database/seed`, {
        method: "POST",
        body: JSON.stringify({ sql: "SELECT 1;" }),
      });

    const okRes = await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) });
    expect(okRes.status).toBe(200);
    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentId: undefined,
        files: expect.objectContaining({
          "package.json": expect.any(Object),
          "seed.sql": { content: "SELECT 1;" },
        }),
      })
    );

    mockGetProjectWithCurrentSnapshot.mockRejectedValueOnce(new NotFoundError("Missing project"));
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(404);

    mockGetProjectWithCurrentSnapshot.mockRejectedValueOnce(new ForbiddenError("Not owner"));
    expect(
      (await POST(makeReq(), { params: Promise.resolve({ id: VALID_PROJECT_ID }) })).status
    ).toBe(403);
  });
});

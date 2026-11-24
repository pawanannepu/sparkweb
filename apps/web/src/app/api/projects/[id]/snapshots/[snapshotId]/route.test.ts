import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSnapshotById } = vi.hoisted(() => ({
  mockGetSnapshotById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    getSnapshotById: mockGetSnapshotById,
  };
});

import { NotFoundError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { GET } from "./route";

describe("GET /api/projects/[id]/snapshots/[snapshotId]", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/s1");
    const res = await GET(req, {
      params: Promise.resolve({ id: "p1", snapshotId: "s1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns full snapshot details when authenticated (AC-2, AC-6)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetSnapshotById.mockResolvedValueOnce({
      id: "s1",
      projectId: "p1",
      parentId: null,
      branchId: "b1",
      branchName: "main",
      treeHash: "hash-123",
      files: { "src/App.tsx": { content: "console.log('hi');" } },
      fileCount: 1,
      message: "Initial commit",
      trigger: "manual",
      tag: "v1.0",
      restoredFromSnapshotId: null,
      createdAt: new Date("2026-11-24T12:00:00Z"),
    });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/s1");
    const res = await GET(req, {
      params: Promise.resolve({ id: "p1", snapshotId: "s1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("s1");
    expect(body.files["src/App.tsx"].content).toBe("console.log('hi');");
    expect(body.trigger).toBe("manual");
    expect(body.tag).toBe("v1.0");
  });

  it("returns 404 when snapshot is not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetSnapshotById.mockRejectedValueOnce(new NotFoundError("Snapshot not found"));

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/non-existent");
    const res = await GET(req, {
      params: Promise.resolve({ id: "p1", snapshotId: "non-existent" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Snapshot not found");
  });
});

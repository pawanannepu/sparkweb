import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRollbackSnapshot } = vi.hoisted(() => ({
  mockRollbackSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    rollbackSnapshot: mockRollbackSnapshot,
  };
});

import { ConflictError, NotFoundError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/projects/[id]/snapshots/rollback", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/rollback", {
      method: "POST",
      body: JSON.stringify({ snapshotId: "11111111-1111-1111-1111-111111111111" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(401);
  });

  it("executes forward rollback commit and returns restored files (AC-7)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    mockRollbackSnapshot.mockResolvedValueOnce({
      snapshot: {
        id: "new-snap-uuid",
        projectId: "p1",
        parentId: "prev-head-uuid",
        branchId: "main-branch-uuid",
        branchName: "main",
        treeHash: "new-tree-hash",
        fileCount: 2,
        message: "Rolled back to snapshot target-snap",
        trigger: "rollback",
        tag: null,
        restoredFromSnapshotId: "11111111-1111-1111-1111-111111111111",
        createdAt: new Date(),
        files: { "src/App.tsx": { content: "old content" } },
      },
      targetSnapshot: {
        id: "11111111-1111-1111-1111-111111111111",
      },
      activeBranch: {
        id: "main-branch-uuid",
        name: "main",
        headSnapshotId: "new-snap-uuid",
      },
    });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/rollback", {
      method: "POST",
      body: JSON.stringify({ snapshotId: "11111111-1111-1111-1111-111111111111" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot.id).toBe("new-snap-uuid");
    expect(body.snapshot.trigger).toBe("rollback");
    expect(body.files["src/App.tsx"].content).toBe("old content");
  });

  it("returns 409 Conflict when active generation stream is running (AC-8)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockRollbackSnapshot.mockRejectedValueOnce(
      new ConflictError("Cannot rollback while code generation is streaming")
    );

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/rollback", {
      method: "POST",
      body: JSON.stringify({ snapshotId: "11111111-1111-1111-1111-111111111111" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("Cannot rollback while code generation is streaming");
  });

  it("returns 400 Bad Request when snapshotId is missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/rollback", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(400);
  });

  it("returns 404 when target snapshot does not exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockRollbackSnapshot.mockRejectedValueOnce(new NotFoundError("Snapshot not found"));

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/rollback", {
      method: "POST",
      body: JSON.stringify({ snapshotId: "non-existent-snap" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(404);
  });
});

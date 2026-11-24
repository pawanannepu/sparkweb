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

import { getCurrentUser } from "@/lib/auth";
import { GET } from "./route";

describe("GET /api/projects/[id]/snapshots/[snapshotId]/diff", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/s2/diff");
    const res = await GET(req, { params: Promise.resolve({ id: "p1", snapshotId: "s2" }) });
    expect(res.status).toBe(401);
  });

  it("computes diff between target and parent snapshot", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);

    mockGetSnapshotById
      .mockResolvedValueOnce({
        id: "s2",
        parentId: "s1",
        files: {
          "src/App.tsx": { content: "line 1\nline 2 new" },
        },
      })
      .mockResolvedValueOnce({
        id: "s1",
        files: {
          "src/App.tsx": { content: "line 1\nline 2 old" },
        },
      });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/snapshots/s2/diff");
    const res = await GET(req, { params: Promise.resolve({ id: "p1", snapshotId: "s2" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.targetSnapshotId).toBe("s2");
    expect(body.baseSnapshotId).toBe("s1");
    expect(body.summary.modifiedFiles).toBe(1);
    expect(body.fileDiffs[0]?.path).toBe("src/App.tsx");
    expect(body.fileDiffs[0]?.status).toBe("modified");
  });
});

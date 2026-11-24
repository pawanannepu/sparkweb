import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetProjectBranches, mockCreateBranch } = vi.hoisted(() => ({
  mockGetProjectBranches: vi.fn(),
  mockCreateBranch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    getProjectBranches: mockGetProjectBranches,
    createBranch: mockCreateBranch,
  };
});

import { getCurrentUser } from "@/lib/auth";
import { GET, POST } from "./route";

describe("Branches API /api/projects/[id]/branches", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists project branches with active indicator (AC-4)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockGetProjectBranches.mockResolvedValueOnce({
      branches: [
        {
          id: "b1",
          projectId: "p1",
          name: "main",
          headSnapshotId: "s1",
          isMain: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      activeBranchId: "b1",
    });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches");
    const res = await GET(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].name).toBe("main");
    expect(body.activeBranchId).toBe("b1");
  });

  it("creates a new branch (AC-4)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockCreateBranch.mockResolvedValueOnce({
      id: "b2",
      projectId: "p1",
      name: "feat-auth",
      headSnapshotId: "s1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches", {
      method: "POST",
      body: JSON.stringify({ name: "feat-auth", switchActive: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "p1" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branch.name).toBe("feat-auth");
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSwitchBranch } = vi.hoisted(() => ({
  mockSwitchBranch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    switchBranch: mockSwitchBranch,
  };
});

import { NotFoundError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/projects/[id]/branches/[branchId]/switch", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/b1/switch", {
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "p1", branchId: "b1" }),
    });

    expect(res.status).toBe(401);
  });

  it("switches active branch and returns updated files (AC-4)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSwitchBranch.mockResolvedValueOnce({
      activeBranch: {
        id: "b-feat",
        name: "feature-branch",
        headSnapshotId: "s-feat",
        isMain: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      currentSnapshotId: "s-feat",
      files: {
        "src/Feature.tsx": { content: "export function Feature() {}" },
      },
    });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/b-feat/switch", {
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "p1", branchId: "b-feat" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeBranch.name).toBe("feature-branch");
    expect(body.currentSnapshotId).toBe("s-feat");
    expect(body.files["src/Feature.tsx"]).toBeDefined();
  });

  it("returns 404 when target branch is not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockSwitchBranch.mockRejectedValueOnce(new NotFoundError("Branch not found"));

    const req = new NextRequest(
      "http://localhost:3000/api/projects/p1/branches/non-existent/switch",
      { method: "POST" }
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: "p1", branchId: "non-existent" }),
    });

    expect(res.status).toBe(404);
  });
});

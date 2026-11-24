import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteBranch } = vi.hoisted(() => ({
  mockDeleteBranch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    db: {},
    deleteBranch: mockDeleteBranch,
  };
});

import { NotFoundError, ValidationError } from "@spark/db";
import { getCurrentUser } from "@/lib/auth";
import { DELETE } from "./route";

describe("DELETE /api/projects/[id]/branches/[branchId]", () => {
  const mockUser = { id: "user-1", email: "user@test.com" };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/b1", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "p1", branchId: "b1" }),
    });

    expect(res.status).toBe(401);
  });

  it("deletes a non-active branch successfully (AC-4)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockDeleteBranch.mockResolvedValueOnce({ success: true });

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/b-exp", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "p1", branchId: "b-exp" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 400 when attempting to delete main branch (AC-1, AC-8)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockDeleteBranch.mockRejectedValueOnce(
      new ValidationError("Cannot delete the default main branch")
    );

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/b-main", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "p1", branchId: "b-main" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot delete the default main branch");
  });

  it("returns 404 when branch does not exist", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(mockUser);
    mockDeleteBranch.mockRejectedValueOnce(new NotFoundError("Branch not found"));

    const req = new NextRequest("http://localhost:3000/api/projects/p1/branches/non-existent", {
      method: "DELETE",
    });
    const res = await DELETE(req, {
      params: Promise.resolve({ id: "p1", branchId: "non-existent" }),
    });

    expect(res.status).toBe(404);
  });
});

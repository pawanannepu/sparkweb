import { ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  deleteProjectWithHostingCleanup: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", () => ({
  deleteProjectWithHostingCleanup: mocks.deleteProjectWithHostingCleanup,
}));

import { DELETE } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

describe("DELETE /api/projects/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-9
  it("returns 401 when unauthenticated and 400 for invalid project UUID", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badRes = await DELETE(
      new NextRequest("http://localhost/api/projects/not-uuid", { method: "DELETE" }),
      { params: Promise.resolve({ id: "not-uuid" }) }
    );
    expect(badRes.status).toBe(400);
  });

  // covers: AC-9
  it("deletes project via deleteProjectWithHostingCleanup and returns success", async () => {
    mocks.deleteProjectWithHostingCleanup.mockResolvedValueOnce({ success: true });
    const res = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mocks.deleteProjectWithHostingCleanup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
  });

  // covers: AC-9
  it("maps ForbiddenError to 403 and NotFoundError to 404", async () => {
    mocks.deleteProjectWithHostingCleanup.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);

    mocks.deleteProjectWithHostingCleanup.mockRejectedValueOnce(new NotFoundError("Not found"));
    const notFoundRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(notFoundRes.status).toBe(404);
  });
});

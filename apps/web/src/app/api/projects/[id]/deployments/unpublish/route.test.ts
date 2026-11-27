import { ConflictError, ForbiddenError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  unpublishProject: vi.fn(),
  getHostingAdapter: vi.fn(),
  removeRoutesForDomain: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", () => ({
  getHostingAdapter: mocks.getHostingAdapter,
  removeRoutesForDomain: mocks.removeRoutesForDomain,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    unpublishProject: mocks.unpublishProject,
  };
});

import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

describe("POST /api/projects/[id]/deployments/unpublish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.getHostingAdapter.mockReturnValue({ kind: "mock-adapter" });
    mocks.removeRoutesForDomain.mockResolvedValue(undefined);
  });

  // covers: AC-7
  it("returns 401 when unauthenticated and 400 on invalid UUID", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/unpublish`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badRes = await POST(
      new NextRequest("http://localhost/api/projects/not-uuid/deployments/unpublish", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "not-uuid" }) }
    );
    expect(badRes.status).toBe(400);
  });

  // covers: AC-5, AC-7
  it("removes hosting routes when domain exists and returns unpublished true", async () => {
    const domain = { subdomain: "demo-app", customDomain: "app.example.com" };
    mocks.unpublishProject.mockResolvedValueOnce({ domain });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/unpublish`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unpublished: true });
    expect(mocks.removeRoutesForDomain).toHaveBeenCalledWith({ kind: "mock-adapter" }, domain);
  });

  // covers: AC-7
  it("skips route removal when project has no domain record and maps 409/403 errors", async () => {
    mocks.unpublishProject.mockResolvedValueOnce({ domain: null });
    const noDomainRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/unpublish`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(noDomainRes.status).toBe(200);
    expect(mocks.removeRoutesForDomain).not.toHaveBeenCalled();

    mocks.unpublishProject.mockRejectedValueOnce(new ConflictError("Build running"));
    const conflictRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/unpublish`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(conflictRes.status).toBe(409);

    mocks.unpublishProject.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/unpublish`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });
});

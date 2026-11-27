import { ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  clearProjectCustomDomain: vi.fn(),
  adapter: {
    deleteRoute: vi.fn(),
    deleteCustomHostname: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", () => ({
  getHostingAdapter: () => mocks.adapter,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    clearProjectCustomDomain: mocks.clearProjectCustomDomain,
  };
});

import { DELETE } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

describe("DELETE /api/projects/[id]/domain/custom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.adapter.deleteRoute.mockResolvedValue(undefined);
    mocks.adapter.deleteCustomHostname.mockResolvedValue(undefined);
  });

  // covers: AC-6
  it("returns 401 when unauthenticated and 400 on invalid project UUID", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/custom`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badRes = await DELETE(
      new NextRequest("http://localhost/api/projects/bad/domain/custom", { method: "DELETE" }),
      { params: Promise.resolve({ id: "bad" }) }
    );
    expect(badRes.status).toBe(400);
  });

  // covers: AC-6
  it("clears custom domain, deletes hosting route and custom hostname", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    mocks.clearProjectCustomDomain.mockResolvedValueOnce({
      domain: {
        id: "dom-1",
        projectId: PROJECT_ID,
        subdomain: "demo-app",
        customDomain: null,
        recordType: null,
        verificationToken: null,
        verificationStatus: "unconfigured",
        sslStatus: "unconfigured",
        providerHostnameId: null,
        failureReason: null,
        lastCheckedAt: null,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      clearedCustomDomain: "app.example.com",
      clearedProviderHostnameId: "cf-host-1",
      activeDeployment: null,
    });

    const res = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/custom`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.customDomain).toBeNull();
    expect(mocks.adapter.deleteRoute).toHaveBeenCalledWith("app.example.com");
    expect(mocks.adapter.deleteCustomHostname).toHaveBeenCalledWith("cf-host-1");
  });

  // covers: AC-6
  it("maps ForbiddenError to 403 and NotFoundError to 404", async () => {
    mocks.clearProjectCustomDomain.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/custom`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);

    mocks.clearProjectCustomDomain.mockRejectedValueOnce(new NotFoundError("Missing"));
    const notFoundRes = await DELETE(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/custom`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(notFoundRes.status).toBe(404);
  });
});

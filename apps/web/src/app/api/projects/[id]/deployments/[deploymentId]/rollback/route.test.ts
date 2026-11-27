import { ConflictError, ForbiddenError, ValidationError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rollbackToDeployment: vi.fn(),
  getHostingAdapter: vi.fn(),
  syncRoutesForDomain: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", () => ({
  getHostingAdapter: mocks.getHostingAdapter,
  syncRoutesForDomain: mocks.syncRoutesForDomain,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    rollbackToDeployment: mocks.rollbackToDeployment,
  };
});

import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const DEPLOYMENT_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("POST /api/projects/[id]/deployments/[deploymentId]/rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.getHostingAdapter.mockReturnValue({ kind: "mock-adapter" });
    mocks.syncRoutesForDomain.mockResolvedValue(undefined);
  });

  // covers: AC-7
  it("returns 401 when unauthenticated and 400 for invalid UUIDs", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await POST(
      new NextRequest(
        `http://localhost/api/projects/invalid/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: "invalid", deploymentId: DEPLOYMENT_ID }) }
    );
    expect(badIdRes.status).toBe(400);
  });

  // covers: AC-5, AC-7
  it("promotes prior deployment artifactKey and syncs hosting routes without rebuilding", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const domain = {
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "renamed-app",
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
    };
    mocks.rollbackToDeployment.mockResolvedValueOnce({
      deployment: {
        id: "dep-promoted",
        projectId: PROJECT_ID,
        snapshotId: "snap-1",
        subdomain: "renamed-app",
        customDomain: null,
        status: "active",
        deploymentUrl: "http://renamed-app.localhost:3000",
        artifactKey: `deployments/${PROJECT_ID}/${DEPLOYMENT_ID}`,
        buildLogs: "Promoted",
        buildDurationMs: 0,
        errorMessage: null,
        trigger: "rollback",
        promotedFromDeploymentId: DEPLOYMENT_ID,
        retiredAt: null,
        createdAt: now,
        updatedAt: now,
      },
      domain,
    });

    const res = await POST(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeDeploymentId).toBe("dep-promoted");
    expect(body.deployment.trigger).toBe("rollback");
    expect(mocks.syncRoutesForDomain).toHaveBeenCalledWith(
      { kind: "mock-adapter" },
      domain,
      expect.objectContaining({
        deploymentId: "dep-promoted",
        projectId: PROJECT_ID,
        artifactKey: `deployments/${PROJECT_ID}/${DEPLOYMENT_ID}`,
      })
    );
  });

  // covers: AC-7
  it("maps ConflictError (409), ValidationError (422), and ForbiddenError (403)", async () => {
    mocks.rollbackToDeployment.mockRejectedValueOnce(new ConflictError("Build in progress"));
    const conflictRes = await POST(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(conflictRes.status).toBe(409);

    mocks.rollbackToDeployment.mockRejectedValueOnce(new ValidationError("Missing artifactKey"));
    const valRes = await POST(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(valRes.status).toBe(422);

    mocks.rollbackToDeployment.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await POST(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}/rollback`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });
});

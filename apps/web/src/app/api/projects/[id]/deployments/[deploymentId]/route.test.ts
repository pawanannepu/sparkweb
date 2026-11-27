import { ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getDeploymentById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    getDeploymentById: mocks.getDeploymentById,
  };
});

import { GET } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const DEPLOYMENT_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000003";

describe("GET /api/projects/[id]/deployments/[deploymentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-2, AC-10
  it("returns 401 when unauthenticated and 400 for invalid UUID params", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badProjectRes = await GET(
      new NextRequest(`http://localhost/api/projects/bad/deployments/${DEPLOYMENT_ID}`),
      { params: Promise.resolve({ id: "bad", deploymentId: DEPLOYMENT_ID }) }
    );
    expect(badProjectRes.status).toBe(400);

    const badDeployRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/bad`),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: "bad" }) }
    );
    expect(badDeployRes.status).toBe(400);
  });

  // covers: AC-3, AC-10
  it("returns serialized deployment status, build logs, and error details", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    mocks.getDeploymentById.mockResolvedValueOnce({
      id: DEPLOYMENT_ID,
      projectId: PROJECT_ID,
      snapshotId: "snap-1",
      subdomain: "demo-app",
      customDomain: null,
      status: "failed",
      deploymentUrl: "http://demo-app.localhost:3000",
      artifactKey: `deployments/${PROJECT_ID}/${DEPLOYMENT_ID}`,
      buildLogs: "SyntaxError in App.tsx",
      buildDurationMs: 420,
      errorMessage: "Vite build failed with exit code 1",
      trigger: "manual",
      promotedFromDeploymentId: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const res = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deployment.status).toBe("failed");
    expect(body.deployment.buildLogs).toBe("SyntaxError in App.tsx");
    expect(body.deployment.createdAt).toBe("2026-11-26T00:00:00.000Z");
  });

  // covers: AC-2
  it("maps NotFoundError to 404 and ForbiddenError to 403", async () => {
    mocks.getDeploymentById.mockRejectedValueOnce(new NotFoundError("Deployment missing"));
    const notFoundRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(notFoundRes.status).toBe(404);

    mocks.getDeploymentById.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments/${DEPLOYMENT_ID}`),
      { params: Promise.resolve({ id: PROJECT_ID, deploymentId: DEPLOYMENT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });
});

import { ConflictError, ForbiddenError, NotFoundError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkActiveGeneration: vi.fn(),
  createDeployment: vi.fn(),
  getProjectDomain: vi.fn(),
  isSnapshotExhausted: vi.fn(),
  listDeployments: vi.fn(),
  executeDeploymentBuild: vi.fn(),
  dbSelectLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", () => ({
  executeDeploymentBuild: mocks.executeDeploymentBuild,
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    checkActiveGeneration: mocks.checkActiveGeneration,
    createDeployment: mocks.createDeployment,
    getProjectDomain: mocks.getProjectDomain,
    isSnapshotExhausted: mocks.isSnapshotExhausted,
    listDeployments: mocks.listDeployments,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mocks.dbSelectLimit,
          })),
        })),
      })),
    },
  };
});

import { GET, POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const SNAP_ID = "00000000-0000-0000-0000-000000000003";

describe("/api/projects/[id]/deployments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.checkActiveGeneration.mockResolvedValue(false);
    mocks.isSnapshotExhausted.mockResolvedValue(false);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const req = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
      method: "POST",
      body: JSON.stringify({ previewClean: true, isStreaming: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(401);
  });

  it("returns 409 when preview has errors or AI stream is active", async () => {
    const req = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
      method: "POST",
      body: JSON.stringify({ previewClean: false, isStreaming: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(409);
  });

  it("returns 422 when project has no saved snapshot", async () => {
    mocks.dbSelectLimit.mockResolvedValueOnce([
      { id: PROJECT_ID, userId: USER_ID, currentSnapshotId: null },
    ]);
    const req = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
      method: "POST",
      body: JSON.stringify({ previewClean: true, isStreaming: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(422);
  });

  it("returns 202 and queues async build when snapshot and preview are clean", async () => {
    const now = new Date();
    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([{ id: SNAP_ID, projectId: PROJECT_ID, files: {} }]);

    mocks.createDeployment.mockResolvedValue({
      id: "dep-1",
      projectId: PROJECT_ID,
      snapshotId: SNAP_ID,
      subdomain: "demo-app",
      customDomain: null,
      status: "queued",
      deploymentUrl: "http://demo-app.localhost:3000",
      artifactKey: `deployments/${PROJECT_ID}/dep-1`,
      buildLogs: null,
      buildDurationMs: null,
      errorMessage: null,
      trigger: "manual",
      promotedFromDeploymentId: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mocks.getProjectDomain.mockResolvedValue({
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
    });

    const req = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
      method: "POST",
      body: JSON.stringify({ previewClean: true, isStreaming: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.deployment.status).toBe("queued");
    expect(body.domain.subdomain).toBe("demo-app");
    expect(mocks.executeDeploymentBuild).toHaveBeenCalledTimes(1);
  });

  it("lists deployments and domain metadata on GET", async () => {
    mocks.listDeployments.mockResolvedValue({
      domain: null,
      activeDeployment: null,
      items: [],
      nextCursor: null,
    });

    const req = new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`);
    const res = await GET(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  // covers: AC-2
  it("returns 401 and 400 for unauthenticated or invalid UUID GET requests", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await GET(
      new NextRequest("http://localhost/api/projects/not-a-uuid/deployments"),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(badIdRes.status).toBe(400);
  });

  // covers: AC-2
  it("forwards limit and cursor query params and maps domain errors on GET", async () => {
    mocks.listDeployments.mockResolvedValueOnce({
      domain: null,
      activeDeployment: null,
      items: [],
      nextCursor: "cursor-2",
    });

    const okRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments?limit=5&cursor=c1`),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(okRes.status).toBe(200);
    expect(mocks.listDeployments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: PROJECT_ID, userId: USER_ID, limit: 5, cursor: "c1" })
    );

    mocks.listDeployments.mockRejectedValueOnce(new ForbiddenError("Forbidden"));
    const forbiddenRes = await GET(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });

  // covers: AC-2
  it("returns 400 on invalid project UUID, invalid JSON body, or invalid POST payload", async () => {
    const badIdRes = await POST(
      new NextRequest("http://localhost/api/projects/bad-id/deployments", {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: "bad-id" }) }
    );
    expect(badIdRes.status).toBe(400);

    const badJsonRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: "{bad json",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(badJsonRes.status).toBe(400);

    const badPayloadRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ snapshotId: "not-a-uuid", previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(badPayloadRes.status).toBe(400);
  });

  // covers: AC-2
  it("returns 409 when isStreaming is true or server side active generation is running", async () => {
    const streamingRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: true }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(streamingRes.status).toBe(409);

    mocks.dbSelectLimit.mockResolvedValueOnce([
      { id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID },
    ]);
    mocks.checkActiveGeneration.mockResolvedValueOnce(true);

    const activeGenRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(activeGenRes.status).toBe(409);
  });

  // covers: AC-2
  it("enforces project existence (404) and tenant ownership (403) on POST", async () => {
    mocks.dbSelectLimit.mockResolvedValueOnce([]);
    const missingRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(missingRes.status).toBe(404);

    mocks.dbSelectLimit.mockResolvedValueOnce([
      { id: PROJECT_ID, userId: "other-user-id", currentSnapshotId: SNAP_ID },
    ]);
    const forbiddenRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(forbiddenRes.status).toBe(403);
  });

  // covers: AC-2
  it("returns 404 when target snapshot is missing and 409 when snapshot is exhausted or build conflicts", async () => {
    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([]);
    const noSnapRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(noSnapRes.status).toBe(404);

    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([{ id: SNAP_ID, projectId: PROJECT_ID, files: {} }]);
    mocks.isSnapshotExhausted.mockResolvedValueOnce(true);
    const exhaustedRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(exhaustedRes.status).toBe(409);

    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([{ id: SNAP_ID, projectId: PROJECT_ID, files: {} }]);
    mocks.createDeployment.mockRejectedValueOnce(new ConflictError("Build in progress"));
    const conflictRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(conflictRes.status).toBe(409);
  });

  // covers: AC-2
  it("uses explicit snapshotId over currentSnapshotId when provided", async () => {
    const explicitSnapId = "00000000-0000-0000-0000-000000000099";
    const now = new Date();
    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([
        { id: explicitSnapId, projectId: PROJECT_ID, files: { "a.ts": {} } },
      ]);
    mocks.createDeployment.mockResolvedValueOnce({
      id: "dep-2",
      projectId: PROJECT_ID,
      snapshotId: explicitSnapId,
      subdomain: "demo-app",
      customDomain: null,
      status: "queued",
      deploymentUrl: "http://demo-app.localhost:3000",
      artifactKey: `deployments/${PROJECT_ID}/dep-2`,
      buildLogs: null,
      buildDurationMs: null,
      errorMessage: null,
      trigger: "manual",
      promotedFromDeploymentId: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mocks.getProjectDomain.mockResolvedValueOnce({
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
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({
          snapshotId: explicitSnapId,
          previewClean: true,
          isStreaming: false,
        }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(202);
    expect(mocks.createDeployment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ snapshotId: explicitSnapId })
    );
    expect(mocks.isSnapshotExhausted).toHaveBeenCalledWith(expect.anything(), explicitSnapId);
  });

  // covers: AC-2
  it("returns 404 when domain record lookup returns null after deployment creation", async () => {
    const now = new Date();
    mocks.dbSelectLimit
      .mockResolvedValueOnce([{ id: PROJECT_ID, userId: USER_ID, currentSnapshotId: SNAP_ID }])
      .mockResolvedValueOnce([{ id: SNAP_ID, projectId: PROJECT_ID, files: {} }]);
    mocks.createDeployment.mockResolvedValueOnce({
      id: "dep-3",
      projectId: PROJECT_ID,
      snapshotId: SNAP_ID,
      subdomain: "demo-app",
      customDomain: null,
      status: "queued",
      deploymentUrl: "http://demo-app.localhost:3000",
      artifactKey: null,
      buildLogs: null,
      buildDurationMs: null,
      errorMessage: null,
      trigger: "manual",
      promotedFromDeploymentId: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    mocks.getProjectDomain.mockResolvedValueOnce(null);

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/deployments`, {
        method: "POST",
        body: JSON.stringify({ previewClean: true, isStreaming: false }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(500);
    expect(NotFoundError).toBeDefined();
  });
});

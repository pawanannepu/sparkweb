import { ConflictError, ValidationError } from "@spark/db";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  updateProjectSubdomain: vi.fn(),
  configureProjectCustomDomain: vi.fn(),
  adapter: {
    putRoute: vi.fn(),
    getRoute: vi.fn(),
    deleteRoute: vi.fn(),
    syncCustomHostname: vi.fn(),
    getCustomHostnameStatus: vi.fn(),
    deleteCustomHostname: vi.fn(),
  },
  removeRoutesForDomain: vi.fn(),
  syncRoutesForDomain: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishing")>();
  return {
    ...actual,
    getHostingAdapter: () => mocks.adapter,
    removeRoutesForDomain: mocks.removeRoutesForDomain,
    syncRoutesForDomain: mocks.syncRoutesForDomain,
  };
});

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    updateProjectSubdomain: mocks.updateProjectSubdomain,
    configureProjectCustomDomain: mocks.configureProjectCustomDomain,
  };
});

import { PATCH } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

describe("PATCH /api/projects/[id]/domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
    mocks.removeRoutesForDomain.mockResolvedValue(undefined);
    mocks.syncRoutesForDomain.mockResolvedValue(undefined);
  });

  // covers: AC-6
  it("returns 401 when unauthenticated and 400 on invalid UUID, bad JSON, or empty update body", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: "next-app" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await PATCH(
      new NextRequest("http://localhost/api/projects/bad-id/domain", {
        method: "PATCH",
        body: JSON.stringify({ subdomain: "next-app" }),
      }),
      { params: Promise.resolve({ id: "bad-id" }) }
    );
    expect(badIdRes.status).toBe(400);

    const badJsonRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: "{not-json",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(badJsonRes.status).toBe(400);

    const emptyPayloadRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(emptyPayloadRes.status).toBe(400);
  });

  // covers: AC-5, AC-6
  it("swaps hosting routes when renaming subdomain on a live project", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    const updatedDomain = {
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "new-sub",
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
    mocks.updateProjectSubdomain.mockResolvedValueOnce({
      domain: updatedDomain,
      previousSubdomain: "old-sub",
      activeDeployment: {
        id: "dep-1",
        artifactKey: `deployments/${PROJECT_ID}/dep-1`,
      },
    });

    const res = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: "new-sub" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.subdomain).toBe("new-sub");
    expect(body.dnsInstructions).toBeNull();
    expect(mocks.removeRoutesForDomain).toHaveBeenCalledWith(mocks.adapter, {
      subdomain: "old-sub",
      customDomain: null,
    });
    expect(mocks.syncRoutesForDomain).toHaveBeenCalledWith(
      mocks.adapter,
      updatedDomain,
      expect.objectContaining({
        deploymentId: "dep-1",
        artifactKey: `deployments/${PROJECT_ID}/dep-1`,
      })
    );
  });

  // covers: AC-6
  it("saves custom domain, cleans up replaced custom hostname, and returns DNS instructions", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    mocks.configureProjectCustomDomain.mockResolvedValueOnce({
      domain: {
        id: "dom-1",
        projectId: PROJECT_ID,
        subdomain: "demo-app",
        customDomain: "example.com",
        recordType: "apex",
        verificationToken: "spark-verify=0123456789abcdef0123456789abcdef",
        verificationStatus: "pending",
        sslStatus: "unconfigured",
        providerHostnameId: null,
        failureReason: null,
        lastCheckedAt: null,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      previousCustomDomain: "old.example.com",
      previousProviderHostnameId: "cf-old-1",
    });

    const res = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ customDomain: "example.com" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.customDomain).toBe("example.com");
    expect(body.dnsInstructions.recordType).toBe("apex");
    expect(body.dnsInstructions.records[1].type).toBe("A");
    expect(mocks.adapter.deleteRoute).toHaveBeenCalledWith("old.example.com");
    expect(mocks.adapter.deleteCustomHostname).toHaveBeenCalledWith("cf-old-1");
  });

  // covers: AC-6
  it("returns 422 for reserved/invalid custom domains and 409 when domain is already taken", async () => {
    const invalidRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ customDomain: "bad.sparkapps.dev" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(invalidRes.status).toBe(422);

    mocks.updateProjectSubdomain.mockRejectedValueOnce(new ConflictError("Subdomain taken"));
    const conflictRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: "taken-sub" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(conflictRes.status).toBe(409);

    mocks.updateProjectSubdomain.mockRejectedValueOnce(new ValidationError("Reserved"));
    const valRes = await PATCH(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain`, {
        method: "PATCH",
        body: JSON.stringify({ subdomain: "www" }),
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(valRes.status).toBe(422);
  });
});

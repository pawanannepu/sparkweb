import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetVerifyRateLimitForTests } from "@/lib/publishing";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getProjectDomain: vi.fn(),
  updateCustomDomainVerificationState: vi.fn(),
  verifyDomainDnsRecords: vi.fn(),
  adapter: {
    putRoute: vi.fn(),
    getRoute: vi.fn(),
    deleteRoute: vi.fn(),
    syncCustomHostname: vi.fn(),
    getCustomHostnameStatus: vi.fn(),
    deleteCustomHostname: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/publishing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/publishing")>();
  return {
    ...actual,
    getHostingAdapter: () => mocks.adapter,
    verifyDomainDnsRecords: mocks.verifyDomainDnsRecords,
  };
});

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    getProjectDomain: mocks.getProjectDomain,
    updateCustomDomainVerificationState: mocks.updateCustomDomainVerificationState,
  };
});

import { POST } from "./route";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

describe("POST /api/projects/[id]/domain/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetVerifyRateLimitForTests();
    mocks.getCurrentUser.mockResolvedValue({ id: USER_ID, email: "owner@example.com" });
  });

  // covers: AC-6
  it("returns 401 when unauthenticated, 400 on bad UUID, and 404 when no custom domain is configured", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const unauthRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(unauthRes.status).toBe(401);

    const badIdRes = await POST(
      new NextRequest("http://localhost/api/projects/bad/domain/verify", { method: "POST" }),
      { params: Promise.resolve({ id: "bad" }) }
    );
    expect(badIdRes.status).toBe(400);

    mocks.getProjectDomain.mockResolvedValueOnce({
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "demo-app",
      customDomain: null,
      recordType: null,
      verificationToken: null,
    });
    const missingRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(missingRes.status).toBe(404);
  });

  // covers: AC-6
  it("persists failed verification when TXT ownership check does not match", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    mocks.getProjectDomain.mockResolvedValueOnce({
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "demo-app",
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=expected",
      providerHostnameId: null,
      verifiedAt: null,
    });
    mocks.verifyDomainDnsRecords.mockResolvedValueOnce({
      txtVerified: false,
      routingVerified: false,
      failureReason: "TXT record not found",
    });
    mocks.updateCustomDomainVerificationState.mockResolvedValueOnce({
      domain: {
        id: "dom-1",
        projectId: PROJECT_ID,
        subdomain: "demo-app",
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=expected",
        verificationStatus: "failed",
        sslStatus: "unconfigured",
        failureReason: "TXT record not found",
        lastCheckedAt: now,
        verifiedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      activeDeployment: null,
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.verificationStatus).toBe("failed");
    expect(mocks.adapter.syncCustomHostname).not.toHaveBeenCalled();
  });

  // covers: AC-5, AC-6
  it("syncs custom hostname and pushes live route once TXT and SSL are active", async () => {
    const now = new Date("2026-11-26T00:00:00.000Z");
    mocks.getProjectDomain.mockResolvedValueOnce({
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "demo-app",
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=expected",
      providerHostnameId: null,
      verifiedAt: null,
    });
    mocks.verifyDomainDnsRecords.mockResolvedValueOnce({
      txtVerified: true,
      routingVerified: true,
      failureReason: null,
    });
    mocks.adapter.syncCustomHostname.mockResolvedValueOnce({
      providerHostnameId: "cf-host-1",
      sslStatus: "active",
      failureReason: null,
    });
    mocks.updateCustomDomainVerificationState.mockResolvedValueOnce({
      domain: {
        id: "dom-1",
        projectId: PROJECT_ID,
        subdomain: "demo-app",
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=expected",
        verificationStatus: "verified",
        sslStatus: "active",
        failureReason: null,
        lastCheckedAt: now,
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      activeDeployment: {
        id: "dep-1",
        artifactKey: `deployments/${PROJECT_ID}/dep-1`,
      },
    });

    const res = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.domain.verificationStatus).toBe("verified");
    expect(body.domain.sslStatus).toBe("active");
    expect(mocks.adapter.putRoute).toHaveBeenCalledWith(
      "app.example.com",
      expect.objectContaining({
        deploymentId: "dep-1",
        projectId: PROJECT_ID,
        artifactKey: `deployments/${PROJECT_ID}/dep-1`,
      })
    );
  });

  // covers: AC-6
  it("enforces 5 requests per minute rate limit with 429 and Retry-After header", async () => {
    mocks.getProjectDomain.mockResolvedValue({
      id: "dom-1",
      projectId: PROJECT_ID,
      subdomain: "demo-app",
      customDomain: null,
      recordType: null,
      verificationToken: null,
    });

    for (let i = 0; i < 5; i++) {
      const res = await POST(
        new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
          method: "POST",
        }),
        { params: Promise.resolve({ id: PROJECT_ID }) }
      );
      expect(res.status).toBe(404);
    }

    const limitedRes = await POST(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/domain/verify`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PROJECT_ID }) }
    );
    expect(limitedRes.status).toBe(429);
    expect(Number(limitedRes.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

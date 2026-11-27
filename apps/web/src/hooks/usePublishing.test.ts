import type { DeploymentSummary, ProjectDomainSummary } from "@spark/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublishing } from "./usePublishing";

const baseDomain: ProjectDomainSummary = {
  id: "dom-1",
  projectId: "proj-1",
  subdomain: "demo-app",
  customDomain: null,
  recordType: null,
  verificationToken: null,
  verificationStatus: "unconfigured",
  sslStatus: "unconfigured",
  failureReason: null,
  lastCheckedAt: null,
  verifiedAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

const activeDeployment: DeploymentSummary = {
  id: "dep-1",
  projectId: "proj-1",
  snapshotId: "snap-1",
  subdomain: "demo-app",
  customDomain: null,
  status: "active",
  deploymentUrl: "http://demo-app.localhost:3000",
  artifactKey: "deployments/proj-1/dep-1",
  buildLogs: "Built",
  buildDurationMs: 500,
  errorMessage: null,
  trigger: "manual",
  promotedFromDeploymentId: null,
  retiredAt: null,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

describe("usePublishing hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // covers: AC-10
  it("hydrates domain and deployments on mount and handles publish errors", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/deployments?limit=10")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domain: baseDomain,
              activeDeployment,
              items: [activeDeployment],
              nextCursor: null,
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/deployments") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Preview has errors" }), { status: 409 })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePublishing({ projectId: "proj-1" }));

    await waitFor(() => {
      expect(result.current.domain?.subdomain).toBe("demo-app");
      expect(result.current.activeDeployment?.id).toBe("dep-1");
    });

    let triggered: DeploymentSummary | null = null;
    await act(async () => {
      triggered = await result.current.publishNow({ previewClean: false, isStreaming: false });
    });
    expect(triggered).toBeNull();
    expect(result.current.error).toBe("Preview has errors");

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  // covers: AC-2, AC-10
  it("polls in progress deployments every 1.5 seconds until active and refreshes history", async () => {
    vi.useFakeTimers();

    const queuedDeployment: DeploymentSummary = {
      ...activeDeployment,
      id: "dep-2",
      status: "queued",
    };
    const buildingDeployment: DeploymentSummary = {
      ...queuedDeployment,
      status: "building",
    };
    const completedDeployment: DeploymentSummary = {
      ...queuedDeployment,
      status: "active",
    };

    let pollCount = 0;
    let listCount = 0;

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/deployments?limit=10")) {
        listCount += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domain: baseDomain,
              activeDeployment: listCount > 1 ? completedDeployment : null,
              items: listCount > 1 ? [completedDeployment] : [],
              nextCursor: null,
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/deployments") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              deployment: queuedDeployment,
              domain: baseDomain,
            }),
            { status: 202 }
          )
        );
      }
      if (url.endsWith("/deployments/dep-2")) {
        pollCount += 1;
        const nextDep = pollCount === 1 ? buildingDeployment : completedDeployment;
        return Promise.resolve(
          new Response(JSON.stringify({ deployment: nextDep }), { status: 200 })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePublishing({ projectId: "proj-1" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.publishNow({ previewClean: true, isStreaming: false });
    });
    expect(result.current.inProgressDeployment?.id).toBe("dep-2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(pollCount).toBe(1);
    expect(result.current.deployments[0]?.status).toBe("building");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(pollCount).toBe(2);
    expect(result.current.activeDeployment?.id).toBe("dep-2");
    expect(result.current.inProgressDeployment).toBeUndefined();
  });

  // covers: AC-6, AC-7, AC-10
  it("handles rollback, unpublish, subdomain update, custom domain save, verify, and remove", async () => {
    const customDomain: ProjectDomainSummary = {
      ...baseDomain,
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=1234",
      verificationStatus: "pending",
    };

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/deployments?limit=10")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domain: baseDomain,
              activeDeployment,
              items: [activeDeployment],
              nextCursor: null,
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/rollback") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ activeDeploymentId: "dep-0" }), { status: 200 })
        );
      }
      if (url.endsWith("/unpublish") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ unpublished: true }), { status: 200 })
        );
      }
      if (url.endsWith("/domain") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { subdomain?: string; customDomain?: string };
        if (body.subdomain) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                domain: { ...baseDomain, subdomain: body.subdomain },
                dnsInstructions: null,
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domain: customDomain,
              dnsInstructions: {
                customDomain: "app.example.com",
                recordType: "cname",
                records: [],
              },
            }),
            { status: 200 }
          )
        );
      }
      if (url.endsWith("/domain/verify") && init?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "Too many DNS verification attempts" }), {
            status: 429,
          })
        );
      }
      if (url.endsWith("/domain/custom") && init?.method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ domain: baseDomain }), { status: 200 })
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePublishing({ projectId: "proj-1" }));
    await waitFor(() => expect(result.current.domain).not.toBeNull());

    await act(async () => {
      expect(await result.current.rollbackDeployment("dep-0")).toBe(true);
      expect(await result.current.unpublish()).toBe(true);
      expect(await result.current.updateSubdomain("next-sub")).toBe(true);
      expect(await result.current.saveCustomDomain("app.example.com")).toBe(true);
    });
    expect(result.current.dnsInstructions?.customDomain).toBe("app.example.com");

    await act(async () => {
      expect(await result.current.verifyCustomDomain()).toBe(false);
    });
    expect(result.current.domainError).toContain("Too many DNS verification attempts");

    act(() => {
      result.current.clearDomainError();
    });
    expect(result.current.domainError).toBeNull();

    await act(async () => {
      expect(await result.current.removeCustomDomain()).toBe(true);
    });
    expect(result.current.dnsInstructions).toBeNull();
  });
});

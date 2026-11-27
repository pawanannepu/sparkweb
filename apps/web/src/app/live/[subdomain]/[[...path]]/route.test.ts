import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLiveDeploymentBySubdomain: vi.fn(),
  getRoute: vi.fn(),
  getObject: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    resolveLiveDeploymentBySubdomain: mocks.resolveLiveDeploymentBySubdomain,
  };
});

vi.mock("@/lib/publishing", () => ({
  getHostingAdapter: () => ({ getRoute: mocks.getRoute }),
  getArtifactStore: () => ({ getObject: mocks.getObject }),
  getPlatformHostnames: (sub: string) => [`${sub}.sparkapps.dev`, `${sub}.localhost`],
}));

import { GET } from "./route";

describe("GET /live/[subdomain]/[[...path]]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLiveDeploymentBySubdomain.mockResolvedValue(null);
  });

  // covers: AC-8
  it("redirects direct localhost or 127.0.0.1 builder origin hits to isolated subdomain origin", async () => {
    const req = new NextRequest("http://localhost:3000/live/demo-app/settings?tab=profile", {
      headers: { host: "localhost:3000" },
    });
    const res = await GET(req, {
      params: Promise.resolve({ subdomain: "demo-app", path: ["settings"] }),
    });

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://demo-app.localhost:3000/settings?tab=profile");
  });

  // covers: AC-8
  it("serves index.html and hashed assets with security headers and no auth cookies", async () => {
    mocks.getRoute.mockResolvedValueOnce({
      deploymentId: "dep-1",
      projectId: "proj-1",
      artifactKey: "deployments/proj-1/dep-1",
      updatedAt: "2026-11-26T00:00:00.000Z",
    });
    mocks.getObject.mockResolvedValueOnce({
      body: new TextEncoder().encode("<h1>Live App</h1>"),
      contentType: "text/html; charset=utf-8",
      size: 17,
    });

    const htmlRes = await GET(
      new NextRequest("http://demo-app.localhost:3000/live/demo-app", {
        headers: { host: "demo-app.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "demo-app" }) }
    );
    expect(htmlRes.status).toBe(200);
    expect(await htmlRes.text()).toBe("<h1>Live App</h1>");
    expect(htmlRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(htmlRes.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(htmlRes.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(htmlRes.headers.get("Cache-Control")).toBe("no-cache");
    expect(htmlRes.headers.get("Set-Cookie")).toBeNull();

    mocks.getRoute.mockResolvedValueOnce({
      deploymentId: "dep-1",
      projectId: "proj-1",
      artifactKey: "deployments/proj-1/dep-1",
      updatedAt: "2026-11-26T00:00:00.000Z",
    });
    mocks.getObject.mockResolvedValueOnce({
      body: new TextEncoder().encode("console.log(1)"),
      contentType: "application/javascript; charset=utf-8",
      size: 14,
    });

    const assetRes = await GET(
      new NextRequest("http://demo-app.localhost:3000/live/demo-app/assets/main-abc.js", {
        headers: { host: "demo-app.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "demo-app", path: ["assets", "main-abc.js"] }) }
    );
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  // covers: AC-8
  it("falls back to DB route lookup, serves SPA index.html for extensionless routes, and returns 404 for missing assets", async () => {
    mocks.getRoute.mockResolvedValue(null);
    mocks.resolveLiveDeploymentBySubdomain.mockResolvedValue({
      subdomain: "demo-app",
      customDomain: null,
      projectId: "proj-1",
      deploymentId: "dep-1",
      artifactKey: "deployments/proj-1/dep-1",
    });
    mocks.getObject.mockResolvedValueOnce(null).mockResolvedValueOnce({
      body: new TextEncoder().encode("<h1>SPA</h1>"),
      contentType: "text/html; charset=utf-8",
      size: 12,
    });

    const spaRes = await GET(
      new NextRequest("http://demo-app.localhost:3000/live/demo-app/settings/profile", {
        headers: { host: "demo-app.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "demo-app", path: ["settings", "profile"] }) }
    );
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toBe("<h1>SPA</h1>");

    mocks.getObject.mockResolvedValueOnce(null);
    const missingFileRes = await GET(
      new NextRequest("http://demo-app.localhost:3000/live/demo-app/assets/missing.js", {
        headers: { host: "demo-app.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "demo-app", path: ["assets", "missing.js"] }) }
    );
    expect(missingFileRes.status).toBe(404);
  });

  // covers: AC-8
  it("returns 404 on path traversal segments or unpublished sites", async () => {
    mocks.getRoute.mockResolvedValueOnce(null);
    const unpublishedRes = await GET(
      new NextRequest("http://missing.localhost:3000/live/missing", {
        headers: { host: "missing.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "missing" }) }
    );
    expect(unpublishedRes.status).toBe(404);

    mocks.getRoute.mockResolvedValueOnce({
      deploymentId: "dep-1",
      projectId: "proj-1",
      artifactKey: "deployments/proj-1/dep-1",
      updatedAt: "2026-11-26T00:00:00.000Z",
    });
    const traversalRes = await GET(
      new NextRequest("http://demo-app.localhost:3000/live/demo-app/../secret", {
        headers: { host: "demo-app.localhost:3000" },
      }),
      { params: Promise.resolve({ subdomain: "demo-app", path: ["..", "secret"] }) }
    );
    expect(traversalRes.status).toBe(404);
  });
});

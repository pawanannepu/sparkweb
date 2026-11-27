import { describe, expect, it } from "vitest";
import { type EdgeRouterEnv, edgeWorker, handleEdgeRequest } from "./index";

function createMockEnv(
  routes: Record<
    string,
    { deploymentId: string; projectId: string; artifactKey: string; updatedAt: string }
  >,
  objects: Record<string, { body: string; contentType?: string }>
): EdgeRouterEnv {
  return {
    SPARK_ROUTES: {
      async get(key: string) {
        return (routes[key] ?? null) as never;
      },
    },
    SPARK_ARTIFACTS: {
      async get(key: string) {
        const entry = objects[key];
        if (!entry) return null;
        return {
          body: entry.body,
          httpMetadata: entry.contentType ? { contentType: entry.contentType } : undefined,
        };
      },
    },
  };
}

describe("edge-router Worker", () => {
  const env = createMockEnv(
    {
      "host:demo.sparkapps.dev": {
        deploymentId: "dep-1",
        projectId: "proj-1",
        artifactKey: "deployments/proj-1/dep-1",
        updatedAt: "2026-11-26T00:00:00.000Z",
      },
    },
    {
      "deployments/proj-1/dep-1/index.html": {
        body: "<html><body>Hello Live</body></html>",
        contentType: "text/html; charset=utf-8",
      },
      "deployments/proj-1/dep-1/assets/app-123.js": {
        body: "console.log('ok');",
        contentType: "application/javascript; charset=utf-8",
      },
    }
  );

  it("serves index.html with security headers and no-cache", async () => {
    const res = await handleEdgeRequest(new Request("https://demo.sparkapps.dev/"), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Hello Live");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("serves hashed assets with immutable cache control", async () => {
    const res = await handleEdgeRequest(
      new Request("https://demo.sparkapps.dev/assets/app-123.js"),
      env
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("falls back to index.html for extensionless SPA routes and 404s missing assets", async () => {
    const spaRes = await handleEdgeRequest(
      new Request("https://demo.sparkapps.dev/settings/billing"),
      env
    );
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toContain("Hello Live");

    const missingAssetRes = await handleEdgeRequest(
      new Request("https://demo.sparkapps.dev/assets/missing.js"),
      env
    );
    expect(missingAssetRes.status).toBe(404);
  });

  it("returns 404 for unknown or unpublished hosts", async () => {
    const res = await handleEdgeRequest(new Request("https://unknown.sparkapps.dev/"), env);
    expect(res.status).toBe(404);
  });

  // covers: AC-8
  it("returns 405 for non-GET/HEAD methods and serves empty body on HEAD", async () => {
    const postRes = await handleEdgeRequest(
      new Request("https://demo.sparkapps.dev/", { method: "POST" }),
      env
    );
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const headRes = await edgeWorker.fetch(
      new Request("https://demo.sparkapps.dev/", { method: "HEAD" }),
      env
    );
    expect(headRes.status).toBe(200);
    expect(await headRes.text()).toBe("");
    expect(headRes.headers.get("Cache-Control")).toBe("no-cache");
  });

  // covers: AC-8
  it("normalizes host port and casing, infers MIME types for non-assets, and blocks path traversal", async () => {
    const envWithStatic = createMockEnv(
      {
        "host:demo.sparkapps.dev": {
          deploymentId: "dep-1",
          projectId: "proj-1",
          artifactKey: "deployments/proj-1/dep-1",
          updatedAt: "2026-11-26T00:00:00.000Z",
        },
      },
      {
        "deployments/proj-1/dep-1/favicon.ico": { body: "icon-bytes" },
      }
    );

    const iconRes = await handleEdgeRequest(
      new Request("https://DEMO.SparkApps.dev:8443/favicon.ico"),
      envWithStatic
    );
    expect(iconRes.status).toBe(200);
    expect(iconRes.headers.get("Content-Type")).toBe("image/x-icon");
    expect(iconRes.headers.get("Cache-Control")).toBe("public, max-age=300");

    const traversalRes = await handleEdgeRequest(
      new Request("https://demo.sparkapps.dev/assets/..%00/secret"),
      envWithStatic
    );
    expect(traversalRes.status).toBe(404);
  });
});

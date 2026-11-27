// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inferContentType, LocalFsArtifactStore, S3ArtifactStore } from "./artifact-store";

describe("artifact-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // covers: AC-4
  it("infers content types for html, js, wasm, data, and unknown extensions", () => {
    expect(inferContentType("index.html")).toBe("text/html; charset=utf-8");
    expect(inferContentType("assets/main.js")).toBe("application/javascript; charset=utf-8");
    expect(inferContentType("assets/pglite.wasm")).toBe("application/wasm");
    expect(inferContentType("assets/pglite.data")).toBe("application/octet-stream");
    expect(inferContentType("assets/file.unknown")).toBe("application/octet-stream");
  });

  // covers: AC-4
  it("rejects path traversal keys in LocalFsArtifactStore", async () => {
    const store = new LocalFsArtifactStore("/tmp/spark-safe-root");
    await expect(store.getObject("../etc/passwd")).rejects.toThrow("Invalid artifact key");
    await expect(store.putObject("a/../../b", new Uint8Array([1]), "text/plain")).rejects.toThrow(
      "Invalid artifact key"
    );
  });

  // covers: AC-4, AC-9
  it("signs S3 putObject, getObject, and paginated deletePrefix requests", async () => {
    const requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ url, method: init?.method ?? "GET", headers });

      if (init?.method === "PUT") {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (
        init?.method === "GET" &&
        url.includes("list-type=2") &&
        !url.includes("continuation-token")
      ) {
        return Promise.resolve(
          new Response(
            `<ListBucketResult><Key>deployments/p1/d1/index.html</Key><NextContinuationToken>tok-2</NextContinuationToken></ListBucketResult>`,
            { status: 200 }
          )
        );
      }
      if (init?.method === "GET" && url.includes("continuation-token=tok-2")) {
        return Promise.resolve(
          new Response(
            `<ListBucketResult><Key>deployments/p1/d1/assets/app.js</Key></ListBucketResult>`,
            { status: 200 }
          )
        );
      }
      if (init?.method === "GET" && url.includes("missing.js")) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      if (init?.method === "GET") {
        return Promise.resolve(
          new Response("<h1>R2</h1>", {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      }
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(null, { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const s3 = new S3ArtifactStore({
      endpoint: "https://r2.example.com",
      bucket: "spark-bundles",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "SECRET_TEST",
    });

    await s3.putObject(
      "deployments/p1/d1/index.html",
      new TextEncoder().encode("<h1>R2</h1>"),
      "text/html; charset=utf-8"
    );
    expect(requests[0]?.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(requests[0]?.headers["x-amz-content-sha256"]).toBeTruthy();

    const fetched = await s3.getObject("deployments/p1/d1/index.html");
    expect(Buffer.from(fetched?.body ?? []).toString("utf-8")).toBe("<h1>R2</h1>");
    expect(fetched?.contentType).toBe("text/html; charset=utf-8");

    expect(await s3.getObject("deployments/p1/d1/missing.js")).toBeNull();

    await s3.deletePrefix("deployments/p1/d1");
    const deleteUrls = requests.filter((r) => r.method === "DELETE").map((r) => r.url);
    expect(deleteUrls).toEqual([
      "https://r2.example.com/spark-bundles/deployments/p1/d1/index.html",
      "https://r2.example.com/spark-bundles/deployments/p1/d1/assets/app.js",
    ]);
  });

  // covers: AC-4, AC-10
  it("supports deleteObject on LocalFsArtifactStore and S3ArtifactStore", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const tempDir = await mkdtemp(path.join(tmpdir(), "spark-artifact-del-"));

    try {
      const localStore = new LocalFsArtifactStore(tempDir);
      await localStore.putObject("attachments/p1/a1", new Uint8Array([1, 2, 3]), "image/png");
      expect(await localStore.getObject("attachments/p1/a1")).not.toBeNull();
      await localStore.deleteObject("attachments/p1/a1");
      expect(await localStore.getObject("attachments/p1/a1")).toBeNull();
      await expect(localStore.deleteObject("../escape")).rejects.toThrow("Invalid artifact key");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const s3 = new S3ArtifactStore({
      endpoint: "https://r2.example.com",
      bucket: "spark-bundles",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "SECRET_TEST",
    });

    await expect(s3.deleteObject("attachments/p1/missing")).resolves.toBeUndefined();
    await expect(s3.deleteObject("attachments/p1/err")).rejects.toThrow("S3 deleteObject failed");
  });
});

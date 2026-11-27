import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STARTER_TEMPLATE_FILES } from "@spark/sandbox";
import { describe, expect, it } from "vitest";
import {
  buildDnsInstructions,
  checkVerifyRateLimit,
  LocalDevHostingAdapter,
  LocalFsArtifactStore,
  prepareProductionFiles,
  resetVerifyRateLimitForTests,
  resolveSafeTempPath,
  stripMainEntryContent,
  stripViteConfigContent,
  validateCustomDomainInput,
  verifyDomainDnsRecords,
} from "./index";

describe("publishing core helpers", () => {
  it("strips builder-only scripts and configures Vite for static PGlite production builds (AC-3)", () => {
    const prodFiles = prepareProductionFiles(STARTER_TEMPLATE_FILES);

    expect(prodFiles["plugins/spark-inspector.js"]).toBeUndefined();
    expect(prodFiles["src/spark-inspector-client.ts"]).toBeUndefined();
    expect(prodFiles["src/spark-db-bridge.ts"]).toBeUndefined();

    const mainTsx = prodFiles["src/main.tsx"]?.content ?? "";
    expect(mainTsx).not.toContain("spark-inspector-client");
    expect(mainTsx).not.toContain("spark-db-bridge");
    expect(mainTsx).toContain("ReactDOM.createRoot");

    const viteConfig = prodFiles["vite.config.ts"]?.content ?? "";
    expect(viteConfig).not.toContain("spark-inspector");
    expect(viteConfig).not.toContain("sparkInspector");
    expect(viteConfig).toContain('base: "/"');
    expect(viteConfig).toContain('worker: { format: "es" }');
  });

  it("rejects directory traversal paths in temp build writer", () => {
    expect(() => resolveSafeTempPath("/tmp/build-123", "../etc/passwd")).toThrow();
    expect(() => resolveSafeTempPath("/tmp/build-123", "src/../../secret")).toThrow();
    expect(resolveSafeTempPath("/tmp/build-123", "src/App.tsx")).toBe("/tmp/build-123/src/App.tsx");
  });

  it("stores, retrieves, and deletes static bundle objects via LocalFsArtifactStore (AC-4, AC-9)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "spark-artifact-test-"));
    const distDir = await mkdtemp(path.join(os.tmpdir(), "spark-dist-test-"));

    try {
      await writeFile(path.join(distDir, "index.html"), "<h1>Live</h1>", "utf-8");
      const store = new LocalFsArtifactStore(tempDir);
      const summary = await store.uploadDirectory("deployments/proj-1/dep-1", distDir);

      expect(summary.fileCount).toBe(1);
      expect(summary.totalBytes).toBeGreaterThan(0);

      const obj = await store.getObject("deployments/proj-1/dep-1/index.html");
      expect(obj?.contentType).toContain("text/html");
      expect(Buffer.from(obj?.body ?? []).toString("utf-8")).toBe("<h1>Live</h1>");

      await store.deletePrefix("deployments/proj-1/dep-1");
      const afterDelete = await store.getObject("deployments/proj-1/dep-1/index.html");
      expect(afterDelete).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await rm(distDir, { recursive: true, force: true });
    }
  });

  it("reads, writes, and deletes host routes via LocalDevHostingAdapter (AC-5)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "spark-routes-test-"));
    const routesFile = path.join(tempDir, "routes.json");
    try {
      const adapter = new LocalDevHostingAdapter(routesFile);
      await adapter.putRoute("demo-app.localhost:3000", {
        deploymentId: "dep-1",
        projectId: "proj-1",
        artifactKey: "deployments/proj-1/dep-1",
        updatedAt: "2026-11-26T00:00:00.000Z",
      });

      const found = await adapter.getRoute("demo-app.localhost");
      expect(found?.deploymentId).toBe("dep-1");

      await adapter.deleteRoute("demo-app.localhost");
      expect(await adapter.getRoute("demo-app.localhost")).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent putRoute and deleteRoute calls in LocalDevHostingAdapter (AC-5, AC-9)", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "spark-routes-race-test-"));
    const routesFile = path.join(tempDir, "routes.json");
    try {
      const adapter = new LocalDevHostingAdapter(routesFile);
      const route = {
        deploymentId: "dep-1",
        projectId: "proj-1",
        artifactKey: "deployments/proj-1/dep-1",
        updatedAt: "2026-11-26T00:00:00.000Z",
      };

      await Promise.all([
        adapter.putRoute("demo-app.sparkapps.dev", route),
        adapter.putRoute("demo-app.localhost", route),
      ]);

      expect(await adapter.getRoute("demo-app.sparkapps.dev")).toEqual(route);
      expect(await adapter.getRoute("demo-app.localhost")).toEqual(route);

      await Promise.all([
        adapter.deleteRoute("demo-app.sparkapps.dev"),
        adapter.deleteRoute("demo-app.localhost"),
      ]);

      expect(await adapter.getRoute("demo-app.sparkapps.dev")).toBeNull();
      expect(await adapter.getRoute("demo-app.localhost")).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates custom domains, rejects reserved/IP hosts, and builds DNS instructions (AC-6)", () => {
    expect(() => validateCustomDomainInput("https://app.example.com")).toThrow();
    expect(() => validateCustomDomainInput("127.0.0.1")).toThrow();
    expect(() => validateCustomDomainInput("foo.sparkapps.dev")).toThrow();
    expect(() => validateCustomDomainInput("localhost")).toThrow();

    const cname = validateCustomDomainInput("app.example.com");
    expect(cname).toEqual({ customDomain: "app.example.com", recordType: "cname" });

    const apex = validateCustomDomainInput("example.com");
    expect(apex).toEqual({ customDomain: "example.com", recordType: "apex" });

    const instructions = buildDnsInstructions("app.example.com", "cname", "spark-verify=abc123");
    expect(instructions.records).toHaveLength(2);
    expect(instructions.records[0]?.host).toBe("_sparkweb-verify.app.example.com");
    expect(instructions.records[1]?.type).toBe("CNAME");
  });

  it("verifies TXT ownership and enforces 5/min verification rate limit (AC-6)", async () => {
    resetVerifyRateLimitForTests();

    const failCheck = await verifyDomainDnsRecords(
      {
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=expected",
      },
      {
        async resolveTxt() {
          return [["spark-verify=wrong"]];
        },
        async resolveCname() {
          return ["edge.sparkapps.dev"];
        },
        async resolve4() {
          return [];
        },
      }
    );
    expect(failCheck.txtVerified).toBe(false);

    const passCheck = await verifyDomainDnsRecords(
      {
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=expected",
      },
      {
        async resolveTxt() {
          return [["spark-verify=expected"]];
        },
        async resolveCname() {
          return ["edge.sparkapps.dev"];
        },
        async resolve4() {
          return [];
        },
      }
    );
    expect(passCheck.txtVerified).toBe(true);
    expect(passCheck.routingVerified).toBe(true);

    for (let i = 0; i < 5; i++) {
      expect(checkVerifyRateLimit("proj-rate", 10_000 + i).allowed).toBe(true);
    }
    const blocked = checkVerifyRateLimit("proj-rate", 10_010);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  // covers: AC-3
  it("normalizes existing base/worker config and injects default vite.config.ts when absent", () => {
    const strippedMain = stripMainEntryContent(
      'import "./spark-inspector-client";\nimport { createRoot } from "react-dom/client";\nimport "./spark-db-bridge";\n'
    );
    expect(strippedMain).not.toContain("spark-inspector-client");
    expect(strippedMain).not.toContain("spark-db-bridge");
    expect(strippedMain).toContain("createRoot");

    const updatedVite = stripViteConfigContent(`
import { defineConfig } from "vite";
import sparkInspector from "./plugins/spark-inspector";
export default defineConfig({
  base: "/subpath/",
  worker: { format: "iife" },
  plugins: [react(), sparkInspector()],
});
`);
    expect(updatedVite).toContain('base: "/"');
    expect(updatedVite).toContain('format: "es"');
    expect(updatedVite).not.toContain("sparkInspector");

    const prepared = prepareProductionFiles({
      "/src/App.tsx": { content: "export default function App() { return null; }" },
    });
    expect(prepared["vite.config.ts"]?.content).toContain('worker: { format: "es" }');
    expect(prepared["src/App.tsx"]?.content).toContain("export default function App");
  });

  // covers: AC-6
  it("handles apex A records, TXT chunk flattening, and domain validation edges", async () => {
    expect(() => validateCustomDomainInput("foo.sparkweb.dev")).toThrow();
    expect(() => validateCustomDomainInput("sub:8080.example.com")).toThrow();
    expect(() => validateCustomDomainInput("invalid_domain")).toThrow();
    expect(validateCustomDomainInput("  APP.Example.COM. ")).toEqual({
      customDomain: "app.example.com",
      recordType: "cname",
    });

    const apexInstructions = buildDnsInstructions("example.com", "apex", "spark-verify=tok");
    expect(apexInstructions.records[1]?.type).toBe("A");
    expect(apexInstructions.records[1]?.host).toBe("@");

    const apexResult = await verifyDomainDnsRecords(
      {
        customDomain: "example.com",
        recordType: "apex",
        verificationToken: "spark-verify=tok",
      },
      {
        async resolveTxt() {
          return [["spark-verify=", "tok"]];
        },
        async resolveCname() {
          return [];
        },
        async resolve4() {
          return ["192.0.2.1"];
        },
      }
    );
    expect(apexResult.txtVerified).toBe(true);
    expect(apexResult.routingVerified).toBe(true);
    expect(apexResult.failureReason).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  markDeploymentBuilding: vi.fn().mockResolvedValue(null),
  activateDeployment: vi.fn().mockResolvedValue({}),
  failDeployment: vi.fn().mockResolvedValue(null),
  getProjectDeletionResources: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@spark/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spark/db")>();
  return {
    ...actual,
    markDeploymentBuilding: dbMocks.markDeploymentBuilding,
    activateDeployment: dbMocks.activateDeployment,
    failDeployment: dbMocks.failDeployment,
    getProjectDeletionResources: dbMocks.getProjectDeletionResources,
    deleteProject: dbMocks.deleteProject,
  };
});

import {
  deleteProjectWithHostingCleanup,
  executeDeploymentBuild,
  getPlatformHostnames,
  removeRoutesForDomain,
  syncRoutesForDomain,
} from "./deploy-service";
import type { ArtifactStore, HostingAdapter } from "./types";

function createMockArtifactStore(): ArtifactStore {
  return {
    putObject: vi.fn().mockResolvedValue(undefined),
    uploadDirectory: vi.fn().mockResolvedValue({ fileCount: 3, totalBytes: 1024 }),
    getObject: vi.fn().mockResolvedValue(null),
    deletePrefix: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHostingAdapter(): HostingAdapter {
  return {
    putRoute: vi.fn().mockResolvedValue(undefined),
    getRoute: vi.fn().mockResolvedValue(null),
    deleteRoute: vi.fn().mockResolvedValue(undefined),
    syncCustomHostname: vi.fn(),
    getCustomHostnameStatus: vi.fn(),
    deleteCustomHostname: vi.fn().mockResolvedValue(undefined),
  };
}

describe("deploy-service orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // covers: AC-4, AC-5
  it("runs build, uploads artifacts, activates deployment, syncs routes, and runs cleanup on success", async () => {
    const artifactStore = createMockArtifactStore();
    const hostingAdapter = createMockHostingAdapter();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const buildRunner = vi.fn().mockResolvedValue({
      success: true,
      distDir: "/tmp/build-1/dist",
      buildLogs: "Built cleanly",
      durationMs: 850,
      errorMessage: null,
      cleanup,
    });

    await executeDeploymentBuild({
      projectId: "proj-1",
      deploymentId: "dep-1",
      artifactKey: "deployments/proj-1/dep-1",
      snapshotFiles: { "index.html": { content: "<h1>Hi</h1>" } },
      domain: {
        subdomain: "demo-app",
        customDomain: "app.example.com",
        verificationStatus: "verified",
        sslStatus: "active",
      },
      database: {} as never,
      artifactStore,
      hostingAdapter,
      buildRunner,
    });

    expect(dbMocks.markDeploymentBuilding).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: "dep-1",
    });
    expect(artifactStore.uploadDirectory).toHaveBeenCalledWith(
      "deployments/proj-1/dep-1",
      "/tmp/build-1/dist"
    );
    expect(dbMocks.activateDeployment).toHaveBeenCalledWith(expect.anything(), {
      projectId: "proj-1",
      deploymentId: "dep-1",
      buildLogs: "Built cleanly",
      buildDurationMs: 850,
      artifactKey: "deployments/proj-1/dep-1",
    });
    expect(hostingAdapter.putRoute).toHaveBeenCalledWith(
      "app.example.com",
      expect.objectContaining({ deploymentId: "dep-1" })
    );
    expect(hostingAdapter.putRoute).toHaveBeenCalledWith(
      "demo-app.localhost",
      expect.objectContaining({ deploymentId: "dep-1" })
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  // covers: AC-3, AC-4
  it("marks deployment failed without uploading or modifying routes when build fails", async () => {
    const artifactStore = createMockArtifactStore();
    const hostingAdapter = createMockHostingAdapter();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const buildRunner = vi.fn().mockResolvedValue({
      success: false,
      distDir: null,
      buildLogs: "Syntax error",
      durationMs: 320,
      errorMessage: "Vite build failed",
      cleanup,
    });

    await executeDeploymentBuild({
      projectId: "proj-1",
      deploymentId: "dep-2",
      artifactKey: "deployments/proj-1/dep-2",
      snapshotFiles: {},
      domain: {
        subdomain: "demo-app",
        customDomain: null,
        verificationStatus: "unconfigured",
        sslStatus: "unconfigured",
      },
      database: {} as never,
      artifactStore,
      hostingAdapter,
      buildRunner,
    });

    expect(dbMocks.failDeployment).toHaveBeenCalledWith(expect.anything(), {
      deploymentId: "dep-2",
      buildLogs: "Syntax error",
      buildDurationMs: 320,
      errorMessage: "Vite build failed",
    });
    expect(artifactStore.uploadDirectory).not.toHaveBeenCalled();
    expect(dbMocks.activateDeployment).not.toHaveBeenCalled();
    expect(hostingAdapter.putRoute).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  // covers: AC-4
  it("catches unexpected upload exceptions, marks deployment failed, and cleans up", async () => {
    const artifactStore = createMockArtifactStore();
    vi.mocked(artifactStore.uploadDirectory).mockRejectedValueOnce(new Error("R2 unreachable"));
    const hostingAdapter = createMockHostingAdapter();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const buildRunner = vi.fn().mockResolvedValue({
      success: true,
      distDir: "/tmp/build-3/dist",
      buildLogs: "ok",
      durationMs: 200,
      errorMessage: null,
      cleanup,
    });

    await executeDeploymentBuild({
      projectId: "proj-1",
      deploymentId: "dep-3",
      artifactKey: "deployments/proj-1/dep-3",
      snapshotFiles: {},
      domain: {
        subdomain: "demo-app",
        customDomain: null,
        verificationStatus: "unconfigured",
        sslStatus: "unconfigured",
      },
      database: {} as never,
      artifactStore,
      hostingAdapter,
      buildRunner,
    });

    expect(dbMocks.failDeployment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deploymentId: "dep-3",
        errorMessage: "R2 unreachable",
      })
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  // covers: AC-5, AC-9, AC-10
  it("cleans up routes, custom hostnames, artifact prefixes, and attachment objects before deleting project in DB", async () => {
    const artifactStore = createMockArtifactStore();
    artifactStore.deleteObject = vi.fn().mockResolvedValue(undefined);
    const hostingAdapter = createMockHostingAdapter();

    dbMocks.getProjectDeletionResources.mockResolvedValueOnce({
      project: { id: "proj-1" },
      domain: {
        subdomain: "demo-app",
        customDomain: "app.example.com",
        providerHostnameId: "cf-host-99",
      },
      artifactKeys: ["deployments/proj-1/dep-1", "deployments/proj-1/dep-2"],
      attachmentStorageKeys: ["attachments/proj-1/att-1", "attachments/proj-1/att-2"],
    });
    dbMocks.deleteProject.mockResolvedValueOnce({ success: true });

    const result = await deleteProjectWithHostingCleanup({
      projectId: "proj-1",
      userId: "user-1",
      database: {} as never,
      artifactStore,
      hostingAdapter,
    });

    expect(result).toEqual({ success: true });
    expect(hostingAdapter.deleteRoute).toHaveBeenCalledWith("app.example.com");
    expect(hostingAdapter.deleteRoute).toHaveBeenCalledWith("demo-app.localhost");
    expect(hostingAdapter.deleteCustomHostname).toHaveBeenCalledWith("cf-host-99");
    expect(artifactStore.deletePrefix).toHaveBeenCalledTimes(2);
    expect(artifactStore.deleteObject).toHaveBeenCalledTimes(2);
    expect(artifactStore.deleteObject).toHaveBeenCalledWith("attachments/proj-1/att-1");
    expect(dbMocks.deleteProject).toHaveBeenCalledWith(expect.anything(), {
      projectId: "proj-1",
      userId: "user-1",
    });
  });

  // covers: AC-5
  it("syncs custom domain route only when verified and SSL is active", async () => {
    const adapter = createMockHostingAdapter();
    const route = {
      deploymentId: "dep-1",
      projectId: "proj-1",
      artifactKey: "deployments/proj-1/dep-1",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };

    await syncRoutesForDomain(
      adapter,
      {
        subdomain: "demo",
        customDomain: "app.example.com",
        verificationStatus: "verified",
        sslStatus: "pending",
      },
      route
    );
    expect(adapter.putRoute).not.toHaveBeenCalledWith("app.example.com", route);
    expect(getPlatformHostnames("Demo")).toContain("demo.localhost");

    await removeRoutesForDomain(adapter, {
      subdomain: "demo",
      customDomain: "app.example.com",
    });
    expect(adapter.deleteRoute).toHaveBeenCalledWith("app.example.com");
  });
});

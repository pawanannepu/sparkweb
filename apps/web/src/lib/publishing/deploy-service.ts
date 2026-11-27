import {
  activateDeployment,
  type DatabaseClient,
  db,
  deleteProject,
  failDeployment,
  getProjectDeletionResources,
  markDeploymentBuilding,
  type ProjectDomain,
} from "@spark/db";
import type { HostRouteRecord, SnapshotFilesMap } from "@spark/shared";
import { LocalFsArtifactStore, S3ArtifactStore } from "./artifact-store";
import { runIsolatedViteBuild } from "./build-runner";
import { CloudflareSaasHostingAdapter, LocalDevHostingAdapter } from "./hosting-adapter";
import type { ArtifactStore, BuildRunnerOptions, HostingAdapter } from "./types";

let cachedArtifactStore: ArtifactStore | null = null;
let cachedHostingAdapter: HostingAdapter | null = null;

export function getArtifactStore(): ArtifactStore {
  if (cachedArtifactStore) return cachedArtifactStore;

  const driver = process.env.ARTIFACT_STORAGE_DRIVER || "local";
  if (driver === "s3") {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "ARTIFACT_STORAGE_DRIVER=s3 requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY"
      );
    }

    cachedArtifactStore = new S3ArtifactStore({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
    });
    return cachedArtifactStore;
  }

  cachedArtifactStore = new LocalFsArtifactStore();
  return cachedArtifactStore;
}

export function getHostingAdapter(): HostingAdapter {
  if (cachedHostingAdapter) return cachedHostingAdapter;

  const driver = process.env.HOSTING_DRIVER || "local";
  if (driver === "cloudflare") {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    const kvNamespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;

    if (!apiToken || !accountId || !zoneId || !kvNamespaceId) {
      throw new Error(
        "HOSTING_DRIVER=cloudflare requires CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, and CLOUDFLARE_KV_NAMESPACE_ID"
      );
    }

    cachedHostingAdapter = new CloudflareSaasHostingAdapter({
      apiToken,
      accountId,
      zoneId,
      kvNamespaceId,
    });
    return cachedHostingAdapter;
  }

  cachedHostingAdapter = new LocalDevHostingAdapter();
  return cachedHostingAdapter;
}

export function getPlatformHostnames(subdomain: string): string[] {
  const platformDomain = (process.env.PLATFORM_DOMAIN || "sparkapps.dev")
    .toLowerCase()
    .trim()
    .replace(/:\d+$/, "");
  const cleanSub = subdomain.toLowerCase().trim();
  const hosts = new Set<string>([`${cleanSub}.${platformDomain}`, `${cleanSub}.localhost`]);
  return Array.from(hosts);
}

export async function syncRoutesForDomain(
  adapter: HostingAdapter,
  domain: Pick<ProjectDomain, "subdomain" | "customDomain" | "verificationStatus" | "sslStatus">,
  route: HostRouteRecord
): Promise<void> {
  const platformHosts = getPlatformHostnames(domain.subdomain);
  await Promise.all(platformHosts.map((host) => adapter.putRoute(host, route)));

  if (
    domain.customDomain &&
    domain.verificationStatus === "verified" &&
    domain.sslStatus === "active"
  ) {
    await adapter.putRoute(domain.customDomain, route);
  }
}

export async function removeRoutesForDomain(
  adapter: HostingAdapter,
  domain: Pick<ProjectDomain, "subdomain" | "customDomain">
): Promise<void> {
  const hosts = [...getPlatformHostnames(domain.subdomain)];
  if (domain.customDomain) {
    hosts.push(domain.customDomain);
  }
  await Promise.all(hosts.map((host) => adapter.deleteRoute(host)));
}

export interface ExecuteDeploymentParams {
  projectId: string;
  deploymentId: string;
  artifactKey: string;
  snapshotFiles: SnapshotFilesMap;
  domain: Pick<ProjectDomain, "subdomain" | "customDomain" | "verificationStatus" | "sslStatus">;
  database?: DatabaseClient;
  artifactStore?: ArtifactStore;
  hostingAdapter?: HostingAdapter;
  buildRunner?: typeof runIsolatedViteBuild;
  buildOptions?: BuildRunnerOptions;
}

export async function executeDeploymentBuild(params: ExecuteDeploymentParams): Promise<void> {
  const database = params.database ?? db;
  const artifactStore = params.artifactStore ?? getArtifactStore();
  const hostingAdapter = params.hostingAdapter ?? getHostingAdapter();
  const buildRunner = params.buildRunner ?? runIsolatedViteBuild;

  let cleanup: (() => Promise<void>) | null = null;
  try {
    await markDeploymentBuilding(database, { deploymentId: params.deploymentId });

    const buildResult = await buildRunner(params.snapshotFiles, params.buildOptions);
    cleanup = buildResult.cleanup;

    if (!buildResult.success || !buildResult.distDir) {
      await failDeployment(database, {
        deploymentId: params.deploymentId,
        buildLogs: buildResult.buildLogs,
        buildDurationMs: buildResult.durationMs,
        errorMessage: buildResult.errorMessage || "Build failed",
      });
      return;
    }

    await artifactStore.uploadDirectory(params.artifactKey, buildResult.distDir);

    await activateDeployment(database, {
      projectId: params.projectId,
      deploymentId: params.deploymentId,
      buildLogs: buildResult.buildLogs,
      buildDurationMs: buildResult.durationMs,
      artifactKey: params.artifactKey,
    });

    const routeRecord: HostRouteRecord = {
      deploymentId: params.deploymentId,
      projectId: params.projectId,
      artifactKey: params.artifactKey,
      updatedAt: new Date().toISOString(),
    };

    await syncRoutesForDomain(hostingAdapter, params.domain, routeRecord);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected deployment error";
    await failDeployment(database, {
      deploymentId: params.deploymentId,
      buildLogs: message,
      buildDurationMs: 0,
      errorMessage: message,
    }).catch(() => {});
  } finally {
    if (cleanup) {
      await cleanup().catch(() => {});
    }
  }
}

export async function deleteProjectWithHostingCleanup(params: {
  projectId: string;
  userId: string;
  database?: DatabaseClient;
  artifactStore?: ArtifactStore;
  hostingAdapter?: HostingAdapter;
}): Promise<{ success: true }> {
  const database = params.database ?? db;
  const artifactStore = params.artifactStore ?? getArtifactStore();
  const hostingAdapter = params.hostingAdapter ?? getHostingAdapter();

  const resources = await getProjectDeletionResources(database, {
    projectId: params.projectId,
    userId: params.userId,
  });

  if (resources.domain) {
    await removeRoutesForDomain(hostingAdapter, resources.domain);
    if (resources.domain.providerHostnameId) {
      await hostingAdapter.deleteCustomHostname(resources.domain.providerHostnameId);
    }
  }

  await Promise.all(resources.artifactKeys.map((key) => artifactStore.deletePrefix(key)));

  const attachmentStorageKeys = resources.attachmentStorageKeys ?? [];
  if (attachmentStorageKeys.length > 0) {
    await Promise.all(
      attachmentStorageKeys.map((key) =>
        artifactStore.deleteObject
          ? artifactStore.deleteObject(key)
          : artifactStore.deletePrefix(key)
      )
    );
  }

  return deleteProject(database, { projectId: params.projectId, userId: params.userId });
}

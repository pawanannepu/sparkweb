import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { DatabaseClient } from "./queries";
import {
  type Deployment,
  type DeploymentTrigger,
  type DomainRecordType,
  type DomainSslStatus,
  type DomainVerificationStatus,
  deployments,
  designAttachments,
  type Project,
  type ProjectDomain,
  projectDomains,
  projects,
  promptMessages,
  snapshots,
} from "./schema/index";

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "cdn",
  "edge",
  "spark",
  "sparkweb",
  "localhost",
  "auth",
  "status",
  "docs",
  "sandbox",
  "live",
]);

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export function normalizeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "project";
}

export function validateSubdomain(raw: string): string {
  const normalized = raw.toLowerCase().trim();
  if (!SUBDOMAIN_PATTERN.test(normalized)) {
    throw new ValidationError(
      "Subdomain must be 3 to 63 characters using lowercase letters, numbers, and hyphens"
    );
  }
  if (RESERVED_SUBDOMAINS.has(normalized)) {
    throw new ValidationError(`Subdomain '${normalized}' is reserved`);
  }
  return normalized;
}

export function buildDeploymentUrl(domain: {
  subdomain: string;
  customDomain: string | null;
  verificationStatus: DomainVerificationStatus;
  sslStatus: DomainSslStatus;
}): string {
  if (
    domain.customDomain &&
    domain.verificationStatus === "verified" &&
    domain.sslStatus === "active"
  ) {
    return `https://${domain.customDomain}`;
  }
  const defaultPlatformDomain =
    process.env.HOSTING_DRIVER === "cloudflare" ? "sparkapps.dev" : "localhost:3000";
  const platformDomain = process.env.PLATFORM_DOMAIN || defaultPlatformDomain;
  const protocol = platformDomain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain.subdomain}.${platformDomain}`;
}

async function getOwnedProject(
  db: DatabaseClient,
  projectId: string,
  userId: string
): Promise<Project> {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const project = rows[0];
  if (!project) {
    throw new NotFoundError(`Project ${projectId} not found`);
  }
  if (project.userId !== userId) {
    throw new ForbiddenError("You do not have access to this project");
  }
  return project;
}

async function generateAvailableSubdomain(db: DatabaseClient, baseSlug: string): Promise<string> {
  const cleanBase = normalizeSlug(baseSlug).slice(0, 50);
  const candidate =
    cleanBase.length >= 3 && !RESERVED_SUBDOMAINS.has(cleanBase)
      ? cleanBase
      : `app-${cleanBase}`.slice(0, 50);

  const existing = await db
    .select({ id: projectDomains.id })
    .from(projectDomains)
    .where(eq(projectDomains.subdomain, candidate))
    .limit(1);

  if (existing.length === 0) {
    return candidate;
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomBytes(2).toString("hex");
    const nextCandidate = `${candidate.slice(0, 58)}-${suffix}`;
    const collision = await db
      .select({ id: projectDomains.id })
      .from(projectDomains)
      .where(eq(projectDomains.subdomain, nextCandidate))
      .limit(1);
    if (collision.length === 0) {
      return nextCandidate;
    }
  }

  return `app-${randomBytes(4).toString("hex")}`;
}

async function ensureProjectDomainInTx(
  tx: DatabaseClient,
  project: Project,
  preferredSubdomain?: string
): Promise<ProjectDomain> {
  const existingRows = await tx
    .select()
    .from(projectDomains)
    .where(eq(projectDomains.projectId, project.id))
    .limit(1);
  const existing = existingRows[0];

  if (preferredSubdomain !== undefined) {
    const normalized = validateSubdomain(preferredSubdomain);
    const conflict = await tx
      .select({ id: projectDomains.id, projectId: projectDomains.projectId })
      .from(projectDomains)
      .where(
        and(eq(projectDomains.subdomain, normalized), ne(projectDomains.projectId, project.id))
      )
      .limit(1);
    if (conflict.length > 0) {
      throw new ConflictError(`Subdomain '${normalized}' is already taken`);
    }

    if (existing) {
      if (existing.subdomain === normalized) {
        return existing;
      }
      const updated = await tx
        .update(projectDomains)
        .set({ subdomain: normalized, updatedAt: new Date() })
        .where(eq(projectDomains.id, existing.id))
        .returning();
      if (!updated[0]) {
        throw new Error("Failed to update project domain");
      }
      return updated[0];
    }

    const inserted = await tx
      .insert(projectDomains)
      .values({
        projectId: project.id,
        subdomain: normalized,
      })
      .returning();
    if (!inserted[0]) {
      throw new Error("Failed to create project domain");
    }
    return inserted[0];
  }

  if (existing) {
    return existing;
  }

  const seededSubdomain = await generateAvailableSubdomain(tx, project.slug);
  const inserted = await tx
    .insert(projectDomains)
    .values({
      projectId: project.id,
      subdomain: seededSubdomain,
    })
    .returning();

  if (!inserted[0]) {
    throw new Error("Failed to seed project domain");
  }
  return inserted[0];
}

export async function getProjectDomain(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<ProjectDomain | null> {
  await getOwnedProject(db, params.projectId, params.userId);
  const rows = await db
    .select()
    .from(projectDomains)
    .where(eq(projectDomains.projectId, params.projectId))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureProjectDomain(
  db: DatabaseClient,
  params: { projectId: string; userId: string; preferredSubdomain?: string }
): Promise<ProjectDomain> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, params.projectId, params.userId);
    return ensureProjectDomainInTx(tx, project, params.preferredSubdomain);
  });
}

export async function isSnapshotExhausted(
  db: DatabaseClient,
  snapshotId: string
): Promise<boolean> {
  const snapRows = await db
    .select({ message: snapshots.message })
    .from(snapshots)
    .where(eq(snapshots.id, snapshotId))
    .limit(1);

  if (snapRows[0]?.message?.startsWith("[Unverified - healing exhausted]")) {
    return true;
  }

  const messageRows = await db
    .select({ toolCalls: promptMessages.toolCalls })
    .from(promptMessages)
    .where(eq(promptMessages.snapshotId, snapshotId));

  for (const row of messageRows) {
    const toolCalls = row.toolCalls as Record<string, unknown> | null;
    if (toolCalls?.verificationStatus === "exhausted") {
      return true;
    }
  }

  return false;
}

export interface CreateDeploymentParams {
  projectId: string;
  userId: string;
  snapshotId?: string;
  subdomain?: string;
  customDomain?: string;
  trigger?: DeploymentTrigger;
}

export async function createDeployment(
  db: DatabaseClient,
  params: CreateDeploymentParams
): Promise<Deployment> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, params.projectId, params.userId);

    const targetSnapshotId = params.snapshotId ?? project.currentSnapshotId;
    if (!targetSnapshotId) {
      throw new ValidationError("Project has no saved snapshot to publish");
    }

    const snapshotRows = await tx
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.id, targetSnapshotId), eq(snapshots.projectId, params.projectId)))
      .limit(1);

    if (snapshotRows.length === 0) {
      throw new NotFoundError(
        `Snapshot ${targetSnapshotId} does not belong to project ${params.projectId}`
      );
    }

    const activeBuilds = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, params.projectId),
          inArray(deployments.status, ["queued", "building"])
        )
      )
      .limit(1);

    if (activeBuilds.length > 0) {
      throw new ConflictError("A deployment build is already in progress for this project");
    }

    const domain = await ensureProjectDomainInTx(tx, project, params.subdomain);

    const deploymentId = randomUUID();
    const artifactKey = `deployments/${params.projectId}/${deploymentId}`;
    const deploymentUrl = buildDeploymentUrl(domain);

    const result = await tx
      .insert(deployments)
      .values({
        id: deploymentId,
        projectId: params.projectId,
        snapshotId: targetSnapshotId,
        subdomain: domain.subdomain,
        customDomain: domain.customDomain ?? params.customDomain?.trim() ?? null,
        status: "queued",
        deploymentUrl,
        artifactKey,
        trigger: params.trigger ?? "manual",
      })
      .returning();

    const created = result[0];
    if (!created) {
      throw new Error("Failed to create deployment");
    }

    return created;
  });
}

export async function getDeploymentById(
  db: DatabaseClient,
  params: { projectId: string; deploymentId: string; userId: string }
): Promise<Deployment> {
  await getOwnedProject(db, params.projectId, params.userId);

  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(eq(deployments.id, params.deploymentId), eq(deployments.projectId, params.projectId))
    )
    .limit(1);

  const deployment = rows[0];
  if (!deployment) {
    throw new NotFoundError(`Deployment ${params.deploymentId} not found`);
  }
  return deployment;
}

export async function listDeployments(
  db: DatabaseClient,
  params: { projectId: string; userId: string; limit?: number; cursor?: string }
): Promise<{
  domain: ProjectDomain | null;
  activeDeployment: Deployment | null;
  items: Deployment[];
  nextCursor: string | null;
}> {
  await getOwnedProject(db, params.projectId, params.userId);

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);

  const domainRows = await db
    .select()
    .from(projectDomains)
    .where(eq(projectDomains.projectId, params.projectId))
    .limit(1);

  const activeRows = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.projectId, params.projectId), eq(deployments.status, "active")))
    .limit(1);

  let cursorFilter: ReturnType<typeof or> | undefined;
  if (params.cursor) {
    const cursorRows = await db
      .select({ id: deployments.id, createdAt: deployments.createdAt })
      .from(deployments)
      .where(and(eq(deployments.id, params.cursor), eq(deployments.projectId, params.projectId)))
      .limit(1);
    const anchor = cursorRows[0];
    if (anchor) {
      cursorFilter = or(
        lt(deployments.createdAt, anchor.createdAt),
        and(eq(deployments.createdAt, anchor.createdAt), lt(deployments.id, anchor.id))
      );
    }
  }

  const rows = await db
    .select()
    .from(deployments)
    .where(and(eq(deployments.projectId, params.projectId), cursorFilter))
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

  return {
    domain: domainRows[0] ?? null,
    activeDeployment: activeRows[0] ?? null,
    items,
    nextCursor,
  };
}

export async function markDeploymentBuilding(
  db: DatabaseClient,
  params: { deploymentId: string }
): Promise<Deployment | null> {
  const rows = await db
    .update(deployments)
    .set({ status: "building", updatedAt: new Date() })
    .where(and(eq(deployments.id, params.deploymentId), eq(deployments.status, "queued")))
    .returning();
  return rows[0] ?? null;
}

export async function activateDeployment(
  db: DatabaseClient,
  params: {
    projectId: string;
    deploymentId: string;
    buildLogs: string;
    buildDurationMs: number;
    artifactKey: string;
  }
): Promise<Deployment> {
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(deployments)
      .set({
        status: "retired",
        retiredAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(deployments.projectId, params.projectId),
          eq(deployments.status, "active"),
          ne(deployments.id, params.deploymentId)
        )
      );

    const updated = await tx
      .update(deployments)
      .set({
        status: "active",
        buildLogs: params.buildLogs,
        buildDurationMs: params.buildDurationMs,
        artifactKey: params.artifactKey,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(eq(deployments.id, params.deploymentId), eq(deployments.projectId, params.projectId))
      )
      .returning();

    const active = updated[0];
    if (!active) {
      throw new NotFoundError(`Deployment ${params.deploymentId} not found`);
    }

    await tx
      .update(projects)
      .set({
        activeDeploymentId: active.id,
        updatedAt: now,
      })
      .where(eq(projects.id, params.projectId));

    return active;
  });
}

export async function failDeployment(
  db: DatabaseClient,
  params: {
    deploymentId: string;
    buildLogs: string;
    buildDurationMs: number;
    errorMessage: string;
  }
): Promise<Deployment | null> {
  const rows = await db
    .update(deployments)
    .set({
      status: "failed",
      buildLogs: params.buildLogs,
      buildDurationMs: params.buildDurationMs,
      errorMessage: params.errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(deployments.id, params.deploymentId))
    .returning();
  return rows[0] ?? null;
}

export async function rollbackToDeployment(
  db: DatabaseClient,
  params: { projectId: string; userId: string; targetDeploymentId: string }
): Promise<{ deployment: Deployment; domain: ProjectDomain }> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, params.projectId, params.userId);

    const inProgress = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, params.projectId),
          inArray(deployments.status, ["queued", "building"])
        )
      )
      .limit(1);

    if (inProgress.length > 0) {
      throw new ConflictError("Cannot roll back while a deployment build is in progress");
    }

    const targetRows = await tx
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.id, params.targetDeploymentId),
          eq(deployments.projectId, params.projectId)
        )
      )
      .limit(1);

    const target = targetRows[0];
    if (!target) {
      throw new NotFoundError(`Deployment ${params.targetDeploymentId} not found`);
    }

    if (!target.artifactKey) {
      throw new ValidationError("Target deployment does not have stored build artifacts");
    }

    const domain = await ensureProjectDomainInTx(tx, project);
    const now = new Date();

    await tx
      .update(deployments)
      .set({
        status: "retired",
        retiredAt: now,
        updatedAt: now,
      })
      .where(and(eq(deployments.projectId, params.projectId), eq(deployments.status, "active")));

    const deploymentUrl = buildDeploymentUrl(domain);
    const inserted = await tx
      .insert(deployments)
      .values({
        projectId: params.projectId,
        snapshotId: target.snapshotId,
        subdomain: domain.subdomain,
        customDomain: domain.customDomain,
        status: "active",
        deploymentUrl,
        artifactKey: target.artifactKey,
        buildLogs: `Promoted stored build artifact from deployment ${target.id}`,
        buildDurationMs: 0,
        trigger: "rollback",
        promotedFromDeploymentId: target.id,
      })
      .returning();

    const promoted = inserted[0];
    if (!promoted) {
      throw new Error("Failed to promote rollback deployment");
    }

    await tx
      .update(projects)
      .set({
        activeDeploymentId: promoted.id,
        updatedAt: now,
      })
      .where(eq(projects.id, params.projectId));

    return { deployment: promoted, domain };
  });
}

export async function unpublishProject(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<{ domain: ProjectDomain | null }> {
  return db.transaction(async (tx) => {
    await getOwnedProject(tx, params.projectId, params.userId);

    const inProgress = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, params.projectId),
          inArray(deployments.status, ["queued", "building"])
        )
      )
      .limit(1);

    if (inProgress.length > 0) {
      throw new ConflictError("Cannot unpublish while a deployment build is in progress");
    }

    const now = new Date();
    await tx
      .update(deployments)
      .set({
        status: "retired",
        retiredAt: now,
        updatedAt: now,
      })
      .where(and(eq(deployments.projectId, params.projectId), eq(deployments.status, "active")));

    await tx
      .update(projects)
      .set({
        activeDeploymentId: null,
        updatedAt: now,
      })
      .where(eq(projects.id, params.projectId));

    const domainRows = await tx
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, params.projectId))
      .limit(1);

    return { domain: domainRows[0] ?? null };
  });
}

export async function updateProjectSubdomain(
  db: DatabaseClient,
  params: { projectId: string; userId: string; subdomain: string }
): Promise<{
  domain: ProjectDomain;
  previousSubdomain: string | null;
  activeDeployment: Deployment | null;
}> {
  const normalized = validateSubdomain(params.subdomain);

  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, params.projectId, params.userId);

    const conflict = await tx
      .select({ id: projectDomains.id })
      .from(projectDomains)
      .where(
        and(eq(projectDomains.subdomain, normalized), ne(projectDomains.projectId, project.id))
      )
      .limit(1);

    if (conflict.length > 0) {
      throw new ConflictError(`Subdomain '${normalized}' is already taken`);
    }

    const existingRows = await tx
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, project.id))
      .limit(1);

    const existing = existingRows[0];
    const previousSubdomain = existing?.subdomain ?? null;
    const now = new Date();

    let updatedDomain: ProjectDomain;
    if (existing) {
      const updated = await tx
        .update(projectDomains)
        .set({ subdomain: normalized, updatedAt: now })
        .where(eq(projectDomains.id, existing.id))
        .returning();
      if (!updated[0]) {
        throw new Error("Failed to update subdomain");
      }
      updatedDomain = updated[0];
    } else {
      const inserted = await tx
        .insert(projectDomains)
        .values({
          projectId: project.id,
          subdomain: normalized,
        })
        .returning();
      if (!inserted[0]) {
        throw new Error("Failed to create project domain");
      }
      updatedDomain = inserted[0];
    }

    const activeRows = await tx
      .select()
      .from(deployments)
      .where(and(eq(deployments.projectId, project.id), eq(deployments.status, "active")))
      .limit(1);

    let activeDeployment: Deployment | null = activeRows[0] ?? null;
    if (activeDeployment) {
      const nextUrl = buildDeploymentUrl(updatedDomain);
      const updatedDeployments = await tx
        .update(deployments)
        .set({
          subdomain: updatedDomain.subdomain,
          deploymentUrl: nextUrl,
          updatedAt: now,
        })
        .where(eq(deployments.id, activeDeployment.id))
        .returning();
      activeDeployment = updatedDeployments[0] ?? activeDeployment;
    }

    return {
      domain: updatedDomain,
      previousSubdomain,
      activeDeployment,
    };
  });
}

export async function configureProjectCustomDomain(
  db: DatabaseClient,
  params: {
    projectId: string;
    userId: string;
    customDomain: string;
    recordType: DomainRecordType;
    verificationToken: string;
  }
): Promise<{
  domain: ProjectDomain;
  previousCustomDomain: string | null;
  previousProviderHostnameId: string | null;
}> {
  return db.transaction(async (tx) => {
    const project = await getOwnedProject(tx, params.projectId, params.userId);

    const conflict = await tx
      .select({ id: projectDomains.id })
      .from(projectDomains)
      .where(
        and(
          eq(projectDomains.customDomain, params.customDomain),
          ne(projectDomains.projectId, project.id)
        )
      )
      .limit(1);

    if (conflict.length > 0) {
      throw new ConflictError(`Custom domain '${params.customDomain}' is already claimed`);
    }

    const domain = await ensureProjectDomainInTx(tx, project);
    const previousCustomDomain = domain.customDomain ?? null;
    const previousProviderHostnameId = domain.providerHostnameId ?? null;
    const now = new Date();

    const updated = await tx
      .update(projectDomains)
      .set({
        customDomain: params.customDomain,
        recordType: params.recordType,
        verificationToken: params.verificationToken,
        verificationStatus: "pending",
        sslStatus: "unconfigured",
        providerHostnameId: null,
        failureReason: null,
        lastCheckedAt: null,
        verifiedAt: null,
        updatedAt: now,
      })
      .where(eq(projectDomains.id, domain.id))
      .returning();

    if (!updated[0]) {
      throw new Error("Failed to configure custom domain");
    }

    return {
      domain: updated[0],
      previousCustomDomain,
      previousProviderHostnameId,
    };
  });
}

export async function updateCustomDomainVerificationState(
  db: DatabaseClient,
  params: {
    projectId: string;
    userId: string;
    verificationStatus: DomainVerificationStatus;
    sslStatus: DomainSslStatus;
    providerHostnameId?: string | null;
    failureReason?: string | null;
    lastCheckedAt: Date;
    verifiedAt?: Date | null;
  }
): Promise<{ domain: ProjectDomain; activeDeployment: Deployment | null }> {
  return db.transaction(async (tx) => {
    await getOwnedProject(tx, params.projectId, params.userId);

    const existingRows = await tx
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, params.projectId))
      .limit(1);

    const existing = existingRows[0];
    if (!existing?.customDomain) {
      throw new NotFoundError("No custom domain configured for this project");
    }

    const updatedRows = await tx
      .update(projectDomains)
      .set({
        verificationStatus: params.verificationStatus,
        sslStatus: params.sslStatus,
        providerHostnameId:
          params.providerHostnameId !== undefined
            ? params.providerHostnameId
            : existing.providerHostnameId,
        failureReason: params.failureReason ?? null,
        lastCheckedAt: params.lastCheckedAt,
        verifiedAt: params.verifiedAt !== undefined ? params.verifiedAt : existing.verifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(projectDomains.id, existing.id))
      .returning();

    const updatedDomain = updatedRows[0];
    if (!updatedDomain) {
      throw new Error("Failed to update domain verification state");
    }

    const activeRows = await tx
      .select()
      .from(deployments)
      .where(and(eq(deployments.projectId, params.projectId), eq(deployments.status, "active")))
      .limit(1);

    let activeDeployment: Deployment | null = activeRows[0] ?? null;
    if (activeDeployment) {
      const nextUrl = buildDeploymentUrl(updatedDomain);
      const updatedDeployments = await tx
        .update(deployments)
        .set({
          customDomain:
            updatedDomain.verificationStatus === "verified" ? updatedDomain.customDomain : null,
          deploymentUrl: nextUrl,
          updatedAt: new Date(),
        })
        .where(eq(deployments.id, activeDeployment.id))
        .returning();
      activeDeployment = updatedDeployments[0] ?? activeDeployment;
    }

    return { domain: updatedDomain, activeDeployment };
  });
}

export async function clearProjectCustomDomain(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<{
  domain: ProjectDomain;
  clearedCustomDomain: string | null;
  clearedProviderHostnameId: string | null;
  activeDeployment: Deployment | null;
}> {
  return db.transaction(async (tx) => {
    await getOwnedProject(tx, params.projectId, params.userId);

    const existingRows = await tx
      .select()
      .from(projectDomains)
      .where(eq(projectDomains.projectId, params.projectId))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new NotFoundError("Project domain record not found");
    }

    const clearedCustomDomain = existing.customDomain ?? null;
    const clearedProviderHostnameId = existing.providerHostnameId ?? null;
    const now = new Date();

    const updatedRows = await tx
      .update(projectDomains)
      .set({
        customDomain: null,
        recordType: null,
        verificationToken: null,
        verificationStatus: "unconfigured",
        sslStatus: "unconfigured",
        providerHostnameId: null,
        failureReason: null,
        lastCheckedAt: null,
        verifiedAt: null,
        updatedAt: now,
      })
      .where(eq(projectDomains.id, existing.id))
      .returning();

    const updatedDomain = updatedRows[0];
    if (!updatedDomain) {
      throw new Error("Failed to clear custom domain");
    }

    const activeRows = await tx
      .select()
      .from(deployments)
      .where(and(eq(deployments.projectId, params.projectId), eq(deployments.status, "active")))
      .limit(1);

    let activeDeployment: Deployment | null = activeRows[0] ?? null;
    if (activeDeployment) {
      const nextUrl = buildDeploymentUrl(updatedDomain);
      const updatedDeployments = await tx
        .update(deployments)
        .set({
          customDomain: null,
          deploymentUrl: nextUrl,
          updatedAt: now,
        })
        .where(eq(deployments.id, activeDeployment.id))
        .returning();
      activeDeployment = updatedDeployments[0] ?? activeDeployment;
    }

    return {
      domain: updatedDomain,
      clearedCustomDomain,
      clearedProviderHostnameId,
      activeDeployment,
    };
  });
}

export async function getProjectDeletionResources(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<{
  project: Project;
  domain: ProjectDomain | null;
  artifactKeys: string[];
  attachmentStorageKeys: string[];
}> {
  const project = await getOwnedProject(db, params.projectId, params.userId);

  const domainRows = await db
    .select()
    .from(projectDomains)
    .where(eq(projectDomains.projectId, params.projectId))
    .limit(1);

  const deploymentRows = await db
    .select({ artifactKey: deployments.artifactKey })
    .from(deployments)
    .where(eq(deployments.projectId, params.projectId));

  const attachmentRows = await db
    .select({ storageKey: designAttachments.storageKey })
    .from(designAttachments)
    .where(eq(designAttachments.projectId, params.projectId));

  const artifactKeys = Array.from(
    new Set(deploymentRows.map((d) => d.artifactKey).filter((key): key is string => Boolean(key)))
  );

  const attachmentStorageKeys = Array.from(
    new Set(attachmentRows.map((a) => a.storageKey).filter((key): key is string => Boolean(key)))
  );

  return {
    project,
    domain: domainRows[0] ?? null,
    artifactKeys,
    attachmentStorageKeys,
  };
}

export async function deleteProject(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<{ success: true }> {
  await getOwnedProject(db, params.projectId, params.userId);
  await db.delete(projects).where(eq(projects.id, params.projectId));
  return { success: true };
}

export async function resolveLiveDeploymentBySubdomain(
  db: DatabaseClient,
  subdomain: string
): Promise<{
  subdomain: string;
  customDomain: string | null;
  projectId: string;
  deploymentId: string;
  artifactKey: string;
} | null> {
  const normalized = subdomain.toLowerCase().trim();
  const rows = await db
    .select({
      subdomain: projectDomains.subdomain,
      customDomain: projectDomains.customDomain,
      projectId: projects.id,
      deploymentId: deployments.id,
      artifactKey: deployments.artifactKey,
    })
    .from(projectDomains)
    .innerJoin(projects, eq(projectDomains.projectId, projects.id))
    .innerJoin(deployments, eq(projects.activeDeploymentId, deployments.id))
    .where(and(eq(projectDomains.subdomain, normalized), eq(deployments.status, "active")))
    .limit(1);

  const row = rows[0];
  if (!row?.artifactKey) {
    return null;
  }

  return {
    subdomain: row.subdomain,
    customDomain: row.customDomain,
    projectId: row.projectId,
    deploymentId: row.deploymentId,
    artifactKey: row.artifactKey,
  };
}

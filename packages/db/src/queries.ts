import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { computeSnapshotTreeHash, decryptApiKey, encryptApiKey, extractKeyHint } from "./crypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SnapshotInActiveDeploymentError,
  ValidationError,
} from "./errors";
import type * as schema from "./schema/index";
import {
  apiKeys,
  type Deployment,
  deployments,
  type Project,
  type PromptMessage,
  projects,
  promptMessages,
  promptThreads,
  type Snapshot,
  type SnapshotFilesMap,
  snapshots,
} from "./schema/index";

// Accept any PG-compatible Drizzle database instance or transaction
// biome-ignore lint/suspicious/noExplicitAny: Drizzle database instance union across postgres-js and pglite
export type DatabaseClient = PgDatabase<any, typeof schema, any>;

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "project";
}

export interface CreateProjectParams {
  userId: string;
  name: string;
  slug?: string;
  description?: string;
  isTemplate?: boolean;
  forkedFromProjectId?: string;
}

export async function createProject(
  db: DatabaseClient,
  params: CreateProjectParams
): Promise<Project> {
  if (!params.name || !params.userId) {
    throw new ValidationError("userId and project name are required");
  }

  if (params.forkedFromProjectId) {
    const parent = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, params.forkedFromProjectId))
      .limit(1);

    if (parent.length === 0) {
      throw new NotFoundError(`Template project ${params.forkedFromProjectId} not found`);
    }
  }

  const baseSlug = params.slug ? slugify(params.slug) : slugify(params.name);
  let targetSlug = baseSlug;

  // Collision handling for (userId, slug) uniqueness
  const existingWithSlug = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, params.userId), eq(projects.slug, targetSlug)))
    .limit(1);

  if (existingWithSlug.length > 0) {
    const suffix = randomBytes(3).toString("hex");
    targetSlug = `${baseSlug}-${suffix}`;
  }

  const result = await db
    .insert(projects)
    .values({
      userId: params.userId,
      name: params.name.trim(),
      description: params.description?.trim(),
      slug: targetSlug,
      isTemplate: params.isTemplate ?? false,
      forkedFromProjectId: params.forkedFromProjectId,
    })
    .returning();

  const created = result[0];
  if (!created) {
    throw new Error("Failed to insert project");
  }

  return created;
}

export interface ProjectWithCurrentSnapshot {
  project: Project;
  currentSnapshot: Snapshot | null;
  threadCount: number;
}

export async function getProjectWithCurrentSnapshot(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<ProjectWithCurrentSnapshot> {
  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    throw new NotFoundError(`Project ${params.projectId} not found`);
  }

  if (project.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this project");
  }

  let currentSnapshot: Snapshot | null = null;
  if (project.currentSnapshotId) {
    const snapshotRows = await db
      .select()
      .from(snapshots)
      .where(eq(snapshots.id, project.currentSnapshotId))
      .limit(1);
    currentSnapshot = snapshotRows[0] ?? null;
  }

  const threadRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(promptThreads)
    .where(eq(promptThreads.projectId, params.projectId));

  const threadCount = Number(threadRows[0]?.count ?? 0);

  return {
    project,
    currentSnapshot,
    threadCount,
  };
}

export type SnapshotHistoryEntry = Omit<Snapshot, "files">;

export async function getProjectSnapshots(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<SnapshotHistoryEntry[]> {
  const projectRows = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    throw new NotFoundError(`Project ${params.projectId} not found`);
  }

  if (project.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this project");
  }

  // Projection intentionally omits the heavy 'files' JSONB column to prevent TOAST de-serialization spikes
  const rows = await db
    .select({
      id: snapshots.id,
      projectId: snapshots.projectId,
      parentId: snapshots.parentId,
      branchName: snapshots.branchName,
      treeHash: snapshots.treeHash,
      message: snapshots.message,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .where(eq(snapshots.projectId, params.projectId))
    .orderBy(desc(snapshots.createdAt));

  return rows;
}

export interface SaveSnapshotParams {
  projectId: string;
  userId: string;
  parentId?: string;
  files: SnapshotFilesMap;
  message?: string;
  branchName?: string;
}

export async function saveSnapshot(
  db: DatabaseClient,
  params: SaveSnapshotParams
): Promise<Snapshot> {
  if (!params.files || typeof params.files !== "object") {
    throw new ValidationError("Snapshot files must be a valid file map object");
  }

  const projectRows = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    throw new NotFoundError(`Project ${params.projectId} not found`);
  }

  if (project.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this project");
  }

  const treeHash = computeSnapshotTreeHash(params.files);

  const snapshotRows = await db
    .insert(snapshots)
    .values({
      projectId: params.projectId,
      parentId: params.parentId,
      branchName: params.branchName ?? "main",
      treeHash,
      files: params.files,
      message: params.message?.trim(),
    })
    .returning();

  const createdSnapshot = snapshotRows[0];
  if (!createdSnapshot) {
    throw new Error("Failed to create snapshot");
  }

  // Advance projects.currentSnapshotId to newly created snapshot
  await db
    .update(projects)
    .set({
      currentSnapshotId: createdSnapshot.id,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, params.projectId));

  return createdSnapshot;
}

export interface RecordPromptMessageParams {
  threadId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: "pending" | "streaming" | "completed" | "failed";
  toolCalls?: unknown;
  snapshotId?: string;
}

export async function recordPromptMessage(
  db: DatabaseClient,
  params: RecordPromptMessageParams
): Promise<PromptMessage> {
  if (!params.content || !params.role) {
    throw new ValidationError("Role and content are required for prompt messages");
  }

  // Verify ownership via thread's project
  const threadRows = await db
    .select({
      id: promptThreads.id,
      userId: projects.userId,
    })
    .from(promptThreads)
    .innerJoin(projects, eq(promptThreads.projectId, projects.id))
    .where(eq(promptThreads.id, params.threadId))
    .limit(1);

  const thread = threadRows[0];
  if (!thread) {
    throw new NotFoundError(`Prompt thread ${params.threadId} not found`);
  }

  if (thread.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this thread");
  }

  const maxSeqRows = await db
    .select({ maxSeq: sql<number>`coalesce(max(${promptMessages.seq}), 0)::int` })
    .from(promptMessages)
    .where(eq(promptMessages.threadId, params.threadId));

  const nextSeq = (maxSeqRows[0]?.maxSeq ?? 0) + 1;

  const result = await db
    .insert(promptMessages)
    .values({
      threadId: params.threadId,
      seq: nextSeq,
      role: params.role,
      content: params.content,
      status: params.status ?? "completed",
      toolCalls: params.toolCalls ?? null,
      snapshotId: params.snapshotId,
    })
    .returning();

  const created = result[0];
  if (!created) {
    throw new Error("Failed to insert prompt message");
  }

  return created;
}

export interface UpdatePromptMessageParams {
  id: string;
  userId: string;
  status?: "pending" | "streaming" | "completed" | "failed";
  toolCalls?: unknown;
  snapshotId?: string;
}

export async function updatePromptMessage(
  db: DatabaseClient,
  params: UpdatePromptMessageParams
): Promise<PromptMessage> {
  const existingRows = await db
    .select({
      id: promptMessages.id,
      userId: projects.userId,
    })
    .from(promptMessages)
    .innerJoin(promptThreads, eq(promptMessages.threadId, promptThreads.id))
    .innerJoin(projects, eq(promptThreads.projectId, projects.id))
    .where(eq(promptMessages.id, params.id))
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new NotFoundError(`Prompt message ${params.id} not found`);
  }

  if (existing.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this prompt message");
  }

  const updates: Partial<typeof promptMessages.$inferInsert> = {};
  if (params.status !== undefined) updates.status = params.status;
  if (params.toolCalls !== undefined) updates.toolCalls = params.toolCalls;
  if (params.snapshotId !== undefined) updates.snapshotId = params.snapshotId;

  const updatedRows = await db
    .update(promptMessages)
    .set(updates)
    .where(eq(promptMessages.id, params.id))
    .returning();

  const updated = updatedRows[0];
  if (!updated) {
    throw new Error("Failed to update prompt message");
  }

  return updated;
}

export interface UserApiKeySummary {
  provider: string;
  keyHint: string;
  updatedAt: Date;
}

export async function saveUserApiKey(
  db: DatabaseClient,
  params: { userId: string; provider: string; rawKey: string },
  masterKeyInput?: string
): Promise<{ provider: string; keyHint: string }> {
  if (!params.userId || !params.provider || !params.rawKey) {
    throw new ValidationError("userId, provider, and rawKey are required");
  }

  const keyHint = extractKeyHint(params.rawKey);
  const encrypted = encryptApiKey(params.rawKey, masterKeyInput);

  await db
    .insert(apiKeys)
    .values({
      userId: params.userId,
      provider: params.provider.toLowerCase().trim(),
      encryptedKey: encrypted.encryptedKey,
      keyHint,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: {
        encryptedKey: encrypted.encryptedKey,
        keyHint,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        updatedAt: new Date(),
      },
    });

  return {
    provider: params.provider.toLowerCase().trim(),
    keyHint,
  };
}

export async function getUserApiKeys(
  db: DatabaseClient,
  params: { userId: string }
): Promise<UserApiKeySummary[]> {
  if (!params.userId) {
    throw new ValidationError("userId is required");
  }

  const rows = await db
    .select({
      provider: apiKeys.provider,
      keyHint: apiKeys.keyHint,
      updatedAt: apiKeys.updatedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, params.userId));

  return rows;
}

export async function getDecryptedApiKey(
  db: DatabaseClient,
  params: { userId: string; provider: string },
  masterKeyInput?: string
): Promise<string> {
  const rows = await db
    .select({
      encryptedKey: apiKeys.encryptedKey,
      iv: apiKeys.iv,
      authTag: apiKeys.authTag,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, params.userId),
        eq(apiKeys.provider, params.provider.toLowerCase().trim())
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`API key for provider '${params.provider}' not found`);
  }

  return decryptApiKey(
    {
      encryptedKey: row.encryptedKey,
      iv: row.iv,
      authTag: row.authTag,
    },
    masterKeyInput
  );
}

export interface CreateDeploymentParams {
  projectId: string;
  userId: string;
  snapshotId: string;
  subdomain: string;
  customDomain?: string;
}

export async function createDeployment(
  db: DatabaseClient,
  params: CreateDeploymentParams
): Promise<Deployment> {
  const projectRows = await db
    .select({ id: projects.id, userId: projects.userId })
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);

  const project = projectRows[0];
  if (!project) {
    throw new NotFoundError(`Project ${params.projectId} not found`);
  }

  if (project.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this project");
  }

  const snapshotRows = await db
    .select({ id: snapshots.id, projectId: snapshots.projectId })
    .from(snapshots)
    .where(and(eq(snapshots.id, params.snapshotId), eq(snapshots.projectId, params.projectId)))
    .limit(1);

  if (snapshotRows.length === 0) {
    throw new NotFoundError(
      `Snapshot ${params.snapshotId} does not belong to project ${params.projectId}`
    );
  }

  const normalizedSubdomain = slugify(params.subdomain);
  const existingSubdomain = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.subdomain, normalizedSubdomain))
    .limit(1);

  if (existingSubdomain.length > 0) {
    throw new ConflictError(`Subdomain '${normalizedSubdomain}' is already taken`);
  }

  const platformDomain = process.env.PLATFORM_DOMAIN || "sparkapps.dev";
  const protocol = platformDomain.includes("localhost") ? "http" : "https";
  const deploymentUrl = `${protocol}://${normalizedSubdomain}.${platformDomain}`;

  const result = await db
    .insert(deployments)
    .values({
      projectId: params.projectId,
      snapshotId: params.snapshotId,
      subdomain: normalizedSubdomain,
      customDomain: params.customDomain?.trim(),
      status: "queued",
      deploymentUrl,
    })
    .returning();

  const created = result[0];
  if (!created) {
    throw new Error("Failed to create deployment");
  }

  return created;
}

export async function deleteSnapshot(
  db: DatabaseClient,
  params: { id: string; userId: string }
): Promise<{ success: true }> {
  const snapshotRows = await db
    .select({
      id: snapshots.id,
      projectId: snapshots.projectId,
      userId: projects.userId,
    })
    .from(snapshots)
    .innerJoin(projects, eq(snapshots.projectId, projects.id))
    .where(eq(snapshots.id, params.id))
    .limit(1);

  const snapshot = snapshotRows[0];
  if (!snapshot) {
    throw new NotFoundError(`Snapshot ${params.id} not found`);
  }

  if (snapshot.userId !== params.userId) {
    throw new ForbiddenError("You do not have access to this snapshot");
  }

  // Domain logic protection: prevent deleting snapshots backing active deployments (AC-4)
  const activeDeployments = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.snapshotId, params.id), eq(deployments.status, "active")))
    .limit(1);

  if (activeDeployments.length > 0) {
    throw new SnapshotInActiveDeploymentError(params.id);
  }

  await db.delete(snapshots).where(eq(snapshots.id, params.id));

  return { success: true };
}

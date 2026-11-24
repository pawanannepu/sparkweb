import { randomBytes } from "node:crypto";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
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
  type ProjectBranch,
  type PromptMessage,
  projectBranches,
  projects,
  promptMessages,
  promptThreads,
  type Snapshot,
  type SnapshotFilesMap,
  type SnapshotTrigger,
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

  // Automatically create default 'main' branch on project creation (AC-1, AC-4)
  const branchResult = await db
    .insert(projectBranches)
    .values({
      projectId: created.id,
      name: "main",
      headSnapshotId: null,
    })
    .returning();

  const mainBranch = branchResult[0];
  if (mainBranch) {
    await db
      .update(projects)
      .set({ activeBranchId: mainBranch.id })
      .where(eq(projects.id, created.id));
    created.activeBranchId = mainBranch.id;
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

export interface SnapshotHistoryEntry {
  id: string;
  projectId: string;
  parentId: string | null;
  branchId: string | null;
  branchName: string;
  treeHash: string;
  fileCount: number;
  message: string | null;
  trigger: string;
  tag: string | null;
  restoredFromSnapshotId: string | null;
  createdAt: Date;
}

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
      branchId: snapshots.branchId,
      branchName: snapshots.branchName,
      treeHash: snapshots.treeHash,
      fileCount: snapshots.fileCount,
      message: snapshots.message,
      trigger: snapshots.trigger,
      tag: snapshots.tag,
      restoredFromSnapshotId: snapshots.restoredFromSnapshotId,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .where(eq(snapshots.projectId, params.projectId))
    .orderBy(desc(snapshots.createdAt));

  return rows;
}

export interface GetPaginatedSnapshotsParams {
  projectId: string;
  userId: string;
  branchId?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedSnapshotsResult {
  items: SnapshotHistoryEntry[];
  nextCursor: string | null;
}

export async function getPaginatedSnapshots(
  db: DatabaseClient,
  params: GetPaginatedSnapshotsParams
): Promise<PaginatedSnapshotsResult> {
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

  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);

  let cursorCondition: SQL | undefined;
  if (params.cursor) {
    try {
      const decodedStr = Buffer.from(params.cursor, "base64").toString("utf-8");
      const parsed = JSON.parse(decodedStr);
      if (parsed?.createdAt && parsed.id) {
        cursorCondition = sql`(${snapshots.createdAt} < ${parsed.createdAt}::timestamp OR (${snapshots.createdAt} = ${parsed.createdAt}::timestamp AND ${snapshots.id} < ${parsed.id}::uuid))`;
      }
    } catch {
      // Ignore invalid cursor
    }
  }

  const conditions = [
    eq(snapshots.projectId, params.projectId),
    params.branchId ? eq(snapshots.branchId, params.branchId) : undefined,
    cursorCondition,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: snapshots.id,
      projectId: snapshots.projectId,
      parentId: snapshots.parentId,
      branchId: snapshots.branchId,
      branchName: snapshots.branchName,
      treeHash: snapshots.treeHash,
      fileCount: snapshots.fileCount,
      message: snapshots.message,
      trigger: snapshots.trigger,
      tag: snapshots.tag,
      restoredFromSnapshotId: snapshots.restoredFromSnapshotId,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .where(and(...conditions))
    .orderBy(desc(snapshots.createdAt), desc(snapshots.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1];
    if (lastItem) {
      nextCursor = Buffer.from(
        JSON.stringify({
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      ).toString("base64");
    }
  }

  return {
    items,
    nextCursor,
  };
}

export async function getSnapshotById(
  db: DatabaseClient,
  params: { projectId: string; userId: string; snapshotId: string }
): Promise<Snapshot> {
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
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, params.snapshotId), eq(snapshots.projectId, params.projectId)))
    .limit(1);

  const snapshot = snapshotRows[0];
  if (!snapshot) {
    throw new NotFoundError(`Snapshot ${params.snapshotId} not found`);
  }

  return snapshot;
}

export interface SaveSnapshotParams {
  projectId: string;
  userId: string;
  parentId?: string;
  files: SnapshotFilesMap;
  message?: string;
  branchName?: string;
  branchId?: string;
  trigger?: SnapshotTrigger;
  tag?: string;
  restoredFromSnapshotId?: string;
}

export async function saveSnapshot(
  db: DatabaseClient,
  params: SaveSnapshotParams
): Promise<Snapshot> {
  if (!params.files || typeof params.files !== "object") {
    throw new ValidationError("Snapshot files must be a valid file map object");
  }

  const projectRows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      activeBranchId: projects.activeBranchId,
      currentSnapshotId: projects.currentSnapshotId,
    })
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

  // Resolve target branch
  let targetBranchId = params.branchId ?? project.activeBranchId ?? null;
  let targetBranchName = params.branchName ?? "main";

  if (targetBranchId) {
    const branchRows = await db
      .select({ id: projectBranches.id, name: projectBranches.name })
      .from(projectBranches)
      .where(
        and(eq(projectBranches.id, targetBranchId), eq(projectBranches.projectId, params.projectId))
      )
      .limit(1);
    if (branchRows[0]) {
      targetBranchName = branchRows[0].name;
    } else {
      targetBranchId = null;
    }
  }

  if (!targetBranchId) {
    const mainBranchRows = await db
      .select({ id: projectBranches.id, name: projectBranches.name })
      .from(projectBranches)
      .where(and(eq(projectBranches.projectId, params.projectId), eq(projectBranches.name, "main")))
      .limit(1);
    if (mainBranchRows[0]) {
      targetBranchId = mainBranchRows[0].id;
      targetBranchName = mainBranchRows[0].name;
    } else {
      const createdMain = await db
        .insert(projectBranches)
        .values({
          projectId: params.projectId,
          name: "main",
          headSnapshotId: null,
        })
        .returning();
      targetBranchId = createdMain[0]?.id ?? null;
      targetBranchName = "main";
    }
  }

  const treeHash = computeSnapshotTreeHash(params.files);
  const fileCount = Object.keys(params.files).length;

  const snapshotRows = await db
    .insert(snapshots)
    .values({
      projectId: params.projectId,
      parentId: params.parentId,
      branchId: targetBranchId,
      branchName: targetBranchName,
      treeHash,
      files: params.files,
      fileCount,
      message: params.message?.trim(),
      trigger: params.trigger ?? "generation",
      tag: params.tag?.trim() || null,
      restoredFromSnapshotId: params.restoredFromSnapshotId || null,
    })
    .returning();

  const createdSnapshot = snapshotRows[0];
  if (!createdSnapshot) {
    throw new Error("Failed to create snapshot");
  }

  // Advance branch head if branch exists
  if (targetBranchId) {
    await db
      .update(projectBranches)
      .set({
        headSnapshotId: createdSnapshot.id,
        updatedAt: new Date(),
      })
      .where(eq(projectBranches.id, targetBranchId));
  }

  // Advance projects.currentSnapshotId and activeBranchId to newly created snapshot
  await db
    .update(projects)
    .set({
      currentSnapshotId: createdSnapshot.id,
      activeBranchId: targetBranchId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, params.projectId));

  return createdSnapshot;
}

export async function checkActiveGeneration(
  db: DatabaseClient,
  params: { projectId: string }
): Promise<boolean> {
  const streamingMessages = await db
    .select({ id: promptMessages.id })
    .from(promptMessages)
    .innerJoin(promptThreads, eq(promptMessages.threadId, promptThreads.id))
    .where(
      and(eq(promptThreads.projectId, params.projectId), eq(promptMessages.status, "streaming"))
    )
    .limit(1);

  return streamingMessages.length > 0;
}

export interface BranchWithStatus extends ProjectBranch {
  isMain: boolean;
  isActive: boolean;
}

export async function getProjectBranches(
  db: DatabaseClient,
  params: { projectId: string; userId: string }
): Promise<{ branches: BranchWithStatus[]; activeBranchId: string | null }> {
  const projectRows = await db
    .select({ id: projects.id, userId: projects.userId, activeBranchId: projects.activeBranchId })
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

  const branchRows = await db
    .select()
    .from(projectBranches)
    .where(eq(projectBranches.projectId, params.projectId))
    .orderBy(projectBranches.createdAt);

  const branches: BranchWithStatus[] = branchRows.map((b) => ({
    ...b,
    isMain: b.name === "main",
    isActive: b.id === project.activeBranchId,
  }));

  return {
    branches,
    activeBranchId: project.activeBranchId,
  };
}

export interface CreateBranchParams {
  projectId: string;
  userId: string;
  name: string;
  fromSnapshotId?: string;
  switchActive?: boolean;
}

export async function createBranch(
  db: DatabaseClient,
  params: CreateBranchParams
): Promise<ProjectBranch> {
  const projectRows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      currentSnapshotId: projects.currentSnapshotId,
    })
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

  const rawName = params.name.toLowerCase().trim();
  const sanitized = rawName.replace(/[^a-z0-9-]+/g, "-").replace(/(^-|-$)/g, "");
  if (!sanitized || sanitized.length > 50) {
    throw new ValidationError(
      "Branch name must be lowercase alphanumeric characters and hyphens only, max 50 characters"
    );
  }

  // Check unique branch name within project
  const existing = await db
    .select({ id: projectBranches.id })
    .from(projectBranches)
    .where(
      and(eq(projectBranches.projectId, params.projectId), eq(projectBranches.name, sanitized))
    )
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError(`Branch '${sanitized}' already exists in this project`);
  }

  let headSnapshotId = project.currentSnapshotId;
  if (params.fromSnapshotId) {
    const snapRows = await db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(
        and(eq(snapshots.id, params.fromSnapshotId), eq(snapshots.projectId, params.projectId))
      )
      .limit(1);
    if (snapRows.length === 0) {
      throw new NotFoundError(`Source snapshot ${params.fromSnapshotId} not found in this project`);
    }
    headSnapshotId = snapRows[0]?.id ?? null;
  }

  const branchRows = await db
    .insert(projectBranches)
    .values({
      projectId: params.projectId,
      name: sanitized,
      headSnapshotId,
    })
    .returning();

  const branch = branchRows[0];
  if (!branch) {
    throw new Error("Failed to insert project branch");
  }

  if (params.switchActive) {
    await db
      .update(projects)
      .set({
        activeBranchId: branch.id,
        currentSnapshotId: headSnapshotId,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, params.projectId));
  }

  return branch;
}

export async function switchBranch(
  db: DatabaseClient,
  params: { projectId: string; userId: string; branchId: string }
): Promise<{
  activeBranch: BranchWithStatus;
  currentSnapshotId: string | null;
  files: SnapshotFilesMap;
}> {
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

  const branchRows = await db
    .select()
    .from(projectBranches)
    .where(
      and(eq(projectBranches.id, params.branchId), eq(projectBranches.projectId, params.projectId))
    )
    .limit(1);

  const branch = branchRows[0];
  if (!branch) {
    throw new NotFoundError(`Branch ${params.branchId} not found in this project`);
  }

  await db
    .update(projects)
    .set({
      activeBranchId: branch.id,
      currentSnapshotId: branch.headSnapshotId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, params.projectId));

  let files: SnapshotFilesMap = {};
  if (branch.headSnapshotId) {
    const snapRows = await db
      .select({ files: snapshots.files })
      .from(snapshots)
      .where(eq(snapshots.id, branch.headSnapshotId))
      .limit(1);
    if (snapRows[0]?.files) {
      files = snapRows[0].files;
    }
  }

  return {
    activeBranch: {
      ...branch,
      isMain: branch.name === "main",
      isActive: true,
    },
    currentSnapshotId: branch.headSnapshotId,
    files,
  };
}

export async function deleteBranch(
  db: DatabaseClient,
  params: { projectId: string; userId: string; branchId: string }
): Promise<{ success: true }> {
  const projectRows = await db
    .select({ id: projects.id, userId: projects.userId, activeBranchId: projects.activeBranchId })
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

  const branchRows = await db
    .select()
    .from(projectBranches)
    .where(
      and(eq(projectBranches.id, params.branchId), eq(projectBranches.projectId, params.projectId))
    )
    .limit(1);

  const branch = branchRows[0];
  if (!branch) {
    throw new NotFoundError(`Branch ${params.branchId} not found in this project`);
  }

  if (branch.name === "main") {
    throw new ValidationError("Cannot delete the default main branch");
  }

  if (project.activeBranchId === branch.id) {
    throw new ValidationError("Cannot delete the currently active branch");
  }

  await db.delete(projectBranches).where(eq(projectBranches.id, branch.id));

  return { success: true };
}

export interface RollbackSnapshotParams {
  projectId: string;
  userId: string;
  snapshotId: string;
  message?: string;
}

export async function rollbackSnapshot(
  db: DatabaseClient,
  params: RollbackSnapshotParams
): Promise<{
  snapshot: Snapshot;
  targetSnapshot: Snapshot;
  activeBranch: ProjectBranch;
}> {
  const projectRows = await db
    .select({
      id: projects.id,
      userId: projects.userId,
      activeBranchId: projects.activeBranchId,
      currentSnapshotId: projects.currentSnapshotId,
    })
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

  // Guard: rollback blocked during active generation runs (AC-8)
  const isStreaming = await checkActiveGeneration(db, { projectId: params.projectId });
  if (isStreaming) {
    throw new ConflictError("Cannot roll back while generation is in progress");
  }

  const targetSnapshotRows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, params.snapshotId), eq(snapshots.projectId, params.projectId)))
    .limit(1);

  const targetSnapshot = targetSnapshotRows[0];
  if (!targetSnapshot) {
    throw new NotFoundError(`Snapshot ${params.snapshotId} not found in this project`);
  }

  // Resolve active branch
  let activeBranchId = project.activeBranchId;
  let activeBranch: ProjectBranch | undefined;
  if (activeBranchId) {
    const branchRows = await db
      .select()
      .from(projectBranches)
      .where(eq(projectBranches.id, activeBranchId))
      .limit(1);
    activeBranch = branchRows[0];
  }

  if (!activeBranch) {
    const mainRows = await db
      .select()
      .from(projectBranches)
      .where(and(eq(projectBranches.projectId, params.projectId), eq(projectBranches.name, "main")))
      .limit(1);
    if (mainRows[0]) {
      activeBranch = mainRows[0];
    } else {
      const createdMain = await db
        .insert(projectBranches)
        .values({
          projectId: params.projectId,
          name: "main",
          headSnapshotId: project.currentSnapshotId,
        })
        .returning();
      activeBranch = createdMain[0];
    }
    activeBranchId = activeBranch?.id;
  }

  const rollbackMessage =
    params.message?.trim() || `Rollback to snapshot ${targetSnapshot.id.slice(0, 8)}`;
  const treeHash = computeSnapshotTreeHash(targetSnapshot.files);
  const fileCount = Object.keys(targetSnapshot.files).length;

  // Non destructive forward commit: creating a new snapshot with historical files (AC-7)
  const snapshotRows = await db
    .insert(snapshots)
    .values({
      projectId: params.projectId,
      parentId: project.currentSnapshotId,
      branchId: activeBranchId,
      branchName: activeBranch?.name ?? "main",
      treeHash,
      files: targetSnapshot.files,
      fileCount,
      message: rollbackMessage,
      trigger: "rollback",
      restoredFromSnapshotId: targetSnapshot.id,
    })
    .returning();

  const newSnapshot = snapshotRows[0];
  if (!newSnapshot) {
    throw new Error("Failed to create rollback snapshot");
  }

  // Update active branch head and project pointers atomically
  if (activeBranchId) {
    await db
      .update(projectBranches)
      .set({
        headSnapshotId: newSnapshot.id,
        updatedAt: new Date(),
      })
      .where(eq(projectBranches.id, activeBranchId));
  }

  await db
    .update(projects)
    .set({
      currentSnapshotId: newSnapshot.id,
      activeBranchId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, params.projectId));

  if (!activeBranch) {
    throw new ValidationError("Active branch not found");
  }

  return {
    snapshot: newSnapshot,
    targetSnapshot,
    activeBranch,
  };
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

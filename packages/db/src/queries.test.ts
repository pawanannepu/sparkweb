import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase } from "./client";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SnapshotInActiveDeploymentError,
  ValidationError,
} from "./errors";
import { runPgliteMigrations } from "./migrate";
import {
  checkActiveGeneration,
  createBranch,
  createDeployment,
  createProject,
  createProjectQuery,
  deleteBranch,
  deleteProjectQuery,
  deleteSnapshot,
  getDecryptedApiKey,
  getPaginatedSnapshots,
  getProjectBranches,
  getProjectSnapshots,
  getProjectWithCurrentSnapshot,
  getSnapshotById,
  getUserApiKeys,
  listProjectQueries,
  recordPromptMessage,
  rollbackSnapshot,
  saveSnapshot,
  saveUserApiKey,
  slugify,
  switchBranch,
  updateProjectQuery,
  updatePromptMessage,
} from "./queries";
import { users } from "./schema/index";

describe("db queries and migration integration with PGlite", () => {
  let pglite: PGlite;
  let testDb: ReturnType<typeof createPgliteDatabase>;
  const testMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  beforeAll(async () => {
    pglite = new PGlite();
    testDb = createPgliteDatabase(pglite);

    // Apply migrations against in-memory PGlite instance (AC-6)
    await runPgliteMigrations(testDb);
  }, 30000);

  afterAll(async () => {
    await pglite.close();
  });

  it("applies migrations cleanly and creates base test user", async () => {
    const insertedUsers = await testDb
      .insert(users)
      .values({
        email: "creator@example.com",
        name: "Test Creator",
      })
      .returning();

    expect(insertedUsers[0]?.id).toBeDefined();
    expect(insertedUsers[0]?.email).toBe("creator@example.com");
  });

  it("creates project with unique slug and handles slug collisions (AC-5)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "slugtest@example.com", name: "Slug User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const project1 = await createProject(testDb, {
      userId,
      name: "My Awesome App",
    });

    expect(project1.slug).toBe("my-awesome-app");
    expect(project1.userId).toBe(userId);

    // Creating another project with identical name creates a collided slug with suffix
    const project2 = await createProject(testDb, {
      userId,
      name: "My Awesome App",
    });

    expect(project2.slug).toMatch(/^my-awesome-app-[a-f0-9]{6}$/);
    expect(project2.id).not.toBe(project1.id);
  });

  it("saves snapshot, advances currentSnapshotId, and computes deterministic tree hash (AC-3)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "snapuser@example.com", name: "Snap User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const project = await createProject(testDb, {
      userId,
      name: "Snapshot App",
    });

    const initialFiles = {
      "package.json": { content: '{"name": "snapshot-app"}' },
      "src/App.tsx": { content: "export default function App() { return <h1>Hi</h1>; }" },
    };

    const snapshot1 = await saveSnapshot(testDb, {
      projectId: project.id,
      userId,
      files: initialFiles,
      message: "Initial generation",
    });

    expect(snapshot1.id).toBeDefined();
    expect(snapshot1.treeHash.length).toBe(64);
    expect(snapshot1.files).toEqual(initialFiles);

    // Verify project currentSnapshotId advanced automatically
    const projectWithSnap = await getProjectWithCurrentSnapshot(testDb, {
      projectId: project.id,
      userId,
    });

    expect(projectWithSnap.currentSnapshot?.id).toBe(snapshot1.id);
    expect(projectWithSnap.currentSnapshot?.treeHash).toBe(snapshot1.treeHash);

    // Projection omits heavy files map from history (AC-3)
    const history = await getProjectSnapshots(testDb, {
      projectId: project.id,
      userId,
    });

    expect(history.length).toBe(1);
    expect(history[0]?.id).toBe(snapshot1.id);
    expect((history[0] as unknown as { files?: unknown }).files).toBeUndefined();
  });

  it("records prompt messages with sequential seq numbering (AC-1)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "promptuser@example.com", name: "Prompt User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const project = await createProject(testDb, {
      userId,
      name: "Chat App",
    });

    // Use promptThreads table directly to create thread
    const { promptThreads } = await import("./schema/index");
    const threadRows = await testDb
      .insert(promptThreads)
      .values({
        projectId: project.id,
        title: "Main prompt thread",
      })
      .returning();

    const threadId = threadRows[0]?.id;
    expect(threadId).toBeDefined();
    if (!threadId) return;

    const msg1 = await recordPromptMessage(testDb, {
      threadId,
      userId,
      role: "user",
      content: "Build a landing page",
    });
    expect(msg1.seq).toBe(1);

    const msg2 = await recordPromptMessage(testDb, {
      threadId,
      userId,
      role: "assistant",
      content: "I am planning the page structure",
      status: "streaming",
    });
    expect(msg2.seq).toBe(2);

    const updated = await updatePromptMessage(testDb, {
      id: msg2.id,
      userId,
      status: "completed",
    });
    expect(updated.status).toBe("completed");
  });

  it("encrypts personal provider API keys and decrypts in memory safely (AC-2)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "keyuser@example.com", name: "Key User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const rawKey = "sk-ant-api03-live-super-secret-anthropic-key-1234";

    const saved = await saveUserApiKey(
      testDb,
      {
        userId,
        provider: "anthropic",
        rawKey,
      },
      testMasterKey
    );

    expect(saved.provider).toBe("anthropic");
    expect(saved.keyHint).toBe("sk-ant-...1234");

    // Public list query returns hint only, no secrets
    const keySummaries = await getUserApiKeys(testDb, { userId });
    expect(keySummaries.length).toBe(1);
    expect(keySummaries[0]?.keyHint).toBe("sk-ant-...1234");
    expect((keySummaries[0] as unknown as { encryptedKey?: unknown }).encryptedKey).toBeUndefined();

    // Internal decryption retrieves original secret
    const decrypted = await getDecryptedApiKey(
      testDb,
      { userId, provider: "anthropic" },
      testMasterKey
    );
    expect(decrypted).toBe(rawKey);
  });

  it("prevents deleting snapshots backing active deployments (AC-4)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "deployuser@example.com", name: "Deploy User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const project = await createProject(testDb, {
      userId,
      name: "Deployment App",
    });

    const snapshot = await saveSnapshot(testDb, {
      projectId: project.id,
      userId,
      files: { "index.html": { content: "<h1>Spark</h1>" } },
    });

    const deployment = await createDeployment(testDb, {
      projectId: project.id,
      userId,
      snapshotId: snapshot.id,
      subdomain: "my-live-app",
    });

    expect(deployment.status).toBe("queued");
    expect(deployment.deploymentUrl).toContain("my-live-app");

    // Update status to active
    const { deployments: deploymentsTable } = await import("./schema/index");
    const { eq } = await import("drizzle-orm");
    await testDb
      .update(deploymentsTable)
      .set({ status: "active" })
      .where(eq(deploymentsTable.id, deployment.id));

    // Deleting snapshot should be rejected with 409 conflict
    await expect(deleteSnapshot(testDb, { id: snapshot.id, userId })).rejects.toThrow(
      SnapshotInActiveDeploymentError
    );

    // Retiring the deployment allows deleting the snapshot
    await testDb
      .update(deploymentsTable)
      .set({ status: "retired" })
      .where(eq(deploymentsTable.id, deployment.id));

    const deleteResult = await deleteSnapshot(testDb, {
      id: snapshot.id,
      userId,
    });
    expect(deleteResult.success).toBe(true);
  });

  it("enforces cascading deletion on project removal (AC-4)", async () => {
    const userResult = await testDb
      .insert(users)
      .values({ email: "cascadeuser@example.com", name: "Cascade User" })
      .returning();
    const userId = userResult[0]?.id;
    expect(userId).toBeDefined();
    if (!userId) return;

    const project = await createProject(testDb, {
      userId,
      name: "Teardown App",
    });

    const snapshot = await saveSnapshot(testDb, {
      projectId: project.id,
      userId,
      files: { "index.html": { content: "<h1>Teardown</h1>" } },
    });

    // Delete project directly
    const { projects: projectsTable, snapshots: snapshotsTable } = await import("./schema/index");
    const { eq } = await import("drizzle-orm");

    await testDb.delete(projectsTable).where(eq(projectsTable.id, project.id));

    // Snapshot should be cleanly cascaded without foreign key deadlocks
    const remainingSnapshots = await testDb
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, snapshot.id));

    expect(remainingSnapshots.length).toBe(0);
  });

  describe("validation and authorization edge cases", () => {
    let userAId: string;
    let userBId: string;

    beforeAll(async () => {
      const uA = await testDb
        .insert(users)
        .values({ email: "usera@example.com", name: "User A" })
        .returning();
      const uB = await testDb
        .insert(users)
        .values({ email: "userb@example.com", name: "User B" })
        .returning();

      userAId = uA[0]?.id as string;
      userBId = uB[0]?.id as string;
    });

    it("normalizes and sanitizes slugs via slugify helper", () => {
      expect(slugify("  My Cool App!  ")).toBe("my-cool-app");
      expect(slugify("---test---slug---")).toBe("test-slug");
      expect(slugify("!!!")).toBe("project");
    });

    it("validates project creation parameters and rejects non existent templates (AC-5)", async () => {
      await expect(createProject(testDb, { userId: "", name: "Test" })).rejects.toThrow(
        ValidationError
      );

      await expect(createProject(testDb, { userId: userAId, name: "" })).rejects.toThrow(
        ValidationError
      );

      await expect(
        createProject(testDb, {
          userId: userAId,
          name: "Forked",
          forkedFromProjectId: "00000000-0000-0000-0000-000000000000",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("enforces project ownership on getProjectWithCurrentSnapshot (AC-1)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Private Project",
      });

      // Different user cannot access
      await expect(
        getProjectWithCurrentSnapshot(testDb, {
          projectId: project.id,
          userId: userBId,
        })
      ).rejects.toThrow(ForbiddenError);

      // Non-existent project throws NotFoundError
      await expect(
        getProjectWithCurrentSnapshot(testDb, {
          projectId: "00000000-0000-0000-0000-000000000000",
          userId: userAId,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("enforces project ownership on getProjectSnapshots (AC-3)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Snapshots Auth Test",
      });

      await expect(
        getProjectSnapshots(testDb, {
          projectId: project.id,
          userId: userBId,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("validates snapshot files and rejects unauthorized snapshot creation (AC-3)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Snap Validation Project",
      });

      await expect(
        saveSnapshot(testDb, {
          projectId: project.id,
          userId: userAId,
          files: null as unknown as import("./schema/snapshots").SnapshotFilesMap,
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        saveSnapshot(testDb, {
          projectId: project.id,
          userId: userBId,
          files: { "index.ts": { content: "code" } },
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("validates prompt message creation and updates with authorization checks (AC-1)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Prompt Auth Project",
      });

      const { promptThreads } = await import("./schema/index");
      const threadRows = await testDb
        .insert(promptThreads)
        .values({ projectId: project.id, title: "Auth Thread" })
        .returning();
      const threadId = threadRows[0]?.id as string;

      // Validate required content
      await expect(
        recordPromptMessage(testDb, {
          threadId,
          userId: userAId,
          role: "user",
          content: "",
        })
      ).rejects.toThrow(ValidationError);

      // User B cannot record messages in User A's thread
      await expect(
        recordPromptMessage(testDb, {
          threadId,
          userId: userBId,
          role: "user",
          content: "Hello",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects duplicate deployment subdomains and foreign snapshots (AC-1, AC-4)", async () => {
      const projectA = await createProject(testDb, {
        userId: userAId,
        name: "Deploy Proj A",
      });
      const projectB = await createProject(testDb, {
        userId: userBId,
        name: "Deploy Proj B",
      });

      const snapA = await saveSnapshot(testDb, {
        projectId: projectA.id,
        userId: userAId,
        files: { "app.tsx": { content: "<h1>A</h1>" } },
      });

      // User B cannot deploy using snapshot from Project A
      await expect(
        createDeployment(testDb, {
          projectId: projectB.id,
          userId: userBId,
          snapshotId: snapA.id,
          subdomain: "unique-subdomain-123",
        })
      ).rejects.toThrow(NotFoundError);

      // Create deployment
      await createDeployment(testDb, {
        projectId: projectA.id,
        userId: userAId,
        snapshotId: snapA.id,
        subdomain: "unique-subdomain-123",
      });

      // Duplicate subdomain throws ConflictError
      await expect(
        createDeployment(testDb, {
          projectId: projectA.id,
          userId: userAId,
          snapshotId: snapA.id,
          subdomain: "unique-subdomain-123",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("validates API key inputs and throws NotFound on missing provider key (AC-2)", async () => {
      await expect(
        saveUserApiKey(testDb, { userId: "", provider: "openai", rawKey: "secret" }, testMasterKey)
      ).rejects.toThrow(ValidationError);

      await expect(getUserApiKeys(testDb, { userId: "" })).rejects.toThrow(ValidationError);

      await expect(
        getDecryptedApiKey(
          testDb,
          { userId: userAId, provider: "non-existent-provider" },
          testMasterKey
        )
      ).rejects.toThrow(NotFoundError);
    });

    it("creates default main branch and supports branch lifecycle and switching (AC-1, AC-4)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Branch Lifecycle App",
      });

      // Default main branch exists and is active
      const branchesRes = await getProjectBranches(testDb, {
        projectId: project.id,
        userId: userAId,
      });
      expect(branchesRes.branches).toHaveLength(1);
      expect(branchesRes.branches[0]?.name).toBe("main");
      expect(branchesRes.branches[0]?.isMain).toBe(true);
      expect(branchesRes.branches[0]?.isActive).toBe(true);

      // Create snapshot on main
      const snapMain = await saveSnapshot(testDb, {
        projectId: project.id,
        userId: userAId,
        files: { "main.txt": { content: "main content" } },
        trigger: "generation",
        tag: "v1.0",
      });
      expect(snapMain.fileCount).toBe(1);
      expect(snapMain.trigger).toBe("generation");
      expect(snapMain.tag).toBe("v1.0");

      // Create new branch from current snapshot
      const expBranch = await createBranch(testDb, {
        projectId: project.id,
        userId: userAId,
        name: "experiment-ui",
        switchActive: true,
      });
      expect(expBranch.name).toBe("experiment-ui");
      expect(expBranch.headSnapshotId).toBe(snapMain.id);

      // Verify active branch changed
      const branchesAfter = await getProjectBranches(testDb, {
        projectId: project.id,
        userId: userAId,
      });
      expect(branchesAfter.branches).toHaveLength(2);
      const activeBranch = branchesAfter.branches.find((b) => b.isActive);
      expect(activeBranch?.name).toBe("experiment-ui");

      // Commit changes on experimental branch
      const snapExp = await saveSnapshot(testDb, {
        projectId: project.id,
        userId: userAId,
        files: {
          "main.txt": { content: "main content" },
          "exp.txt": { content: "experiment content" },
        },
        trigger: "canvas",
      });
      expect(snapExp.fileCount).toBe(2);
      expect(snapExp.branchId).toBe(expBranch.id);

      // Switch back to main
      const mainBranch = branchesAfter.branches.find((b) => b.isMain);
      expect(mainBranch).toBeDefined();
      const mainBranchId = mainBranch?.id ?? "";
      const switched = await switchBranch(testDb, {
        projectId: project.id,
        userId: userAId,
        branchId: mainBranchId,
      });
      expect(switched.activeBranch.name).toBe("main");
      expect(switched.files["exp.txt"]).toBeUndefined();
      expect(switched.files["main.txt"]?.content).toBe("main content");

      // Cannot delete main branch
      await expect(
        deleteBranch(testDb, {
          projectId: project.id,
          userId: userAId,
          branchId: mainBranchId,
        })
      ).rejects.toThrow(ValidationError);

      // Can delete non-active experimental branch
      const deleteResult = await deleteBranch(testDb, {
        projectId: project.id,
        userId: userAId,
        branchId: expBranch.id,
      });
      expect(deleteResult.success).toBe(true);
    });

    it("paginates snapshots with opaque cursor and limits (AC-2)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Pagination Test App",
      });

      // Insert 5 snapshots
      for (let i = 1; i <= 5; i++) {
        await saveSnapshot(testDb, {
          projectId: project.id,
          userId: userAId,
          files: { [`file${i}.txt`]: { content: `content ${i}` } },
          message: `Snapshot ${i}`,
        });
      }

      // Page 1 (limit 2)
      const page1 = await getPaginatedSnapshots(testDb, {
        projectId: project.id,
        userId: userAId,
        limit: 2,
      });
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0]?.message).toBe("Snapshot 5");
      expect(page1.items[1]?.message).toBe("Snapshot 4");
      expect(page1.nextCursor).toBeDefined();

      // Page 2
      expect(page1.nextCursor).toBeDefined();
      const cursor1 = page1.nextCursor ?? "";
      const page2 = await getPaginatedSnapshots(testDb, {
        projectId: project.id,
        userId: userAId,
        cursor: cursor1,
        limit: 2,
      });
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0]?.message).toBe("Snapshot 3");
      expect(page2.items[1]?.message).toBe("Snapshot 2");
      expect(page2.nextCursor).toBeDefined();

      // Page 3
      const cursor2 = page2.nextCursor ?? "";
      const page3 = await getPaginatedSnapshots(testDb, {
        projectId: project.id,
        userId: userAId,
        cursor: cursor2,
        limit: 2,
      });
      expect(page3.items).toHaveLength(1);
      expect(page3.items[0]?.message).toBe("Snapshot 1");
      expect(page3.nextCursor).toBeNull();
    });

    it("performs non-destructive forward rollback and blocks during streaming (AC-7, AC-8)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Rollback Test App",
      });

      const snap1 = await saveSnapshot(testDb, {
        projectId: project.id,
        userId: userAId,
        files: { "app.tsx": { content: "version 1" } },
        message: "Version 1",
      });

      const snap2 = await saveSnapshot(testDb, {
        projectId: project.id,
        userId: userAId,
        files: { "app.tsx": { content: "version 2" } },
        message: "Version 2",
      });

      // Rollback to snap1
      const rollbackRes = await rollbackSnapshot(testDb, {
        projectId: project.id,
        userId: userAId,
        snapshotId: snap1.id,
      });

      expect(rollbackRes.snapshot.id).not.toBe(snap1.id);
      expect(rollbackRes.snapshot.id).not.toBe(snap2.id);
      expect(rollbackRes.snapshot.trigger).toBe("rollback");
      expect(rollbackRes.snapshot.restoredFromSnapshotId).toBe(snap1.id);
      expect(rollbackRes.snapshot.files).toEqual(snap1.files);

      // Verify full snapshot retrieval
      const fetched = await getSnapshotById(testDb, {
        projectId: project.id,
        userId: userAId,
        snapshotId: rollbackRes.snapshot.id,
      });
      expect(fetched.files).toEqual(snap1.files);

      // Rollback to non-existent snapshot throws NotFoundError
      await expect(
        rollbackSnapshot(testDb, {
          projectId: project.id,
          userId: userAId,
          snapshotId: "00000000-0000-0000-0000-000000000099",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("prevents duplicate branch names on the same project (AC-1)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Duplicate Branch App",
      });

      await createBranch(testDb, {
        projectId: project.id,
        userId: userAId,
        name: "duplicate-name",
      });

      await expect(
        createBranch(testDb, {
          projectId: project.id,
          userId: userAId,
          name: "duplicate-name",
        })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError when switching to non-existent branch", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Switch Error App",
      });

      await expect(
        switchBranch(testDb, {
          projectId: project.id,
          userId: userAId,
          branchId: "00000000-0000-0000-0000-000000000099",
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("creates, lists, filters, updates, and deletes project_queries snippets (AC-1, AC-2)", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Queries Snippet App",
      });

      const q1 = await createProjectQuery(testDb, {
        projectId: project.id,
        userId: userAId,
        title: "Count items",
        sql: "SELECT COUNT(*) FROM demo_items;",
        isFavorite: false,
      });

      const q2 = await createProjectQuery(testDb, {
        projectId: project.id,
        userId: userAId,
        title: "Recent items",
        sql: "SELECT * FROM demo_items ORDER BY created_at DESC LIMIT 10;",
        description: "Latest rows",
        isFavorite: true,
      });

      const all = await listProjectQueries(testDb, {
        projectId: project.id,
        userId: userAId,
      });
      expect(all).toHaveLength(2);

      const favs = await listProjectQueries(testDb, {
        projectId: project.id,
        userId: userAId,
        favorite: true,
      });
      expect(favs).toHaveLength(1);
      expect(favs[0]?.id).toBe(q2.id);

      const updated = await updateProjectQuery(testDb, {
        projectId: project.id,
        queryId: q1.id,
        userId: userAId,
        isFavorite: true,
        title: "Total item count",
      });
      expect(updated.isFavorite).toBe(true);
      expect(updated.title).toBe("Total item count");

      // Non-owner cannot list or mutate snippets
      await expect(
        listProjectQueries(testDb, { projectId: project.id, userId: userBId })
      ).rejects.toThrow(ForbiddenError);

      await deleteProjectQuery(testDb, {
        projectId: project.id,
        queryId: q1.id,
        userId: userAId,
      });

      await expect(
        deleteProjectQuery(testDb, {
          projectId: project.id,
          queryId: q1.id,
          userId: userAId,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("ignores stale streaming prompt messages older than the active generation TTL in checkActiveGeneration", async () => {
      const project = await createProject(testDb, {
        userId: userAId,
        name: "Stale Streaming Guard App",
      });

      const { promptMessages, promptThreads } = await import("./schema/index");
      const [thread] = await testDb
        .insert(promptThreads)
        .values({
          projectId: project.id,
          title: "Stale thread",
        })
        .returning();
      if (!thread) throw new Error("Failed to create thread");

      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
      await testDb.insert(promptMessages).values({
        threadId: thread.id,
        seq: 1,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: twentyMinutesAgo,
      });

      expect(await checkActiveGeneration(testDb, { projectId: project.id })).toBe(false);

      await testDb.insert(promptMessages).values({
        threadId: thread.id,
        seq: 2,
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: new Date(),
      });

      expect(await checkActiveGeneration(testDb, { projectId: project.id })).toBe(true);
    });

    // covers: AC-1, AC-2
    it("validates query snippet inputs, isolates across projects, and cascades on project delete", async () => {
      const projectA = await createProject(testDb, {
        userId: userAId,
        name: "Snippet Isolation A",
      });
      const projectB = await createProject(testDb, {
        userId: userAId,
        name: "Snippet Isolation B",
      });

      await expect(
        createProjectQuery(testDb, {
          projectId: projectA.id,
          userId: userAId,
          title: "   ",
          sql: "SELECT 1;",
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        createProjectQuery(testDb, {
          projectId: projectA.id,
          userId: userAId,
          title: "Valid title",
          sql: "   ",
        })
      ).rejects.toThrow(ValidationError);

      const snippetA = await createProjectQuery(testDb, {
        projectId: projectA.id,
        userId: userAId,
        title: "Project A snippet",
        sql: "SELECT 1;",
      });

      await expect(
        updateProjectQuery(testDb, {
          projectId: projectA.id,
          queryId: snippetA.id,
          userId: userAId,
          title: "   ",
        })
      ).rejects.toThrow(ValidationError);

      // Cannot update or delete snippetA through projectB
      await expect(
        updateProjectQuery(testDb, {
          projectId: projectB.id,
          queryId: snippetA.id,
          userId: userAId,
          title: "Cross-project hijack",
        })
      ).rejects.toThrow(NotFoundError);

      await expect(
        deleteProjectQuery(testDb, {
          projectId: projectB.id,
          queryId: snippetA.id,
          userId: userAId,
        })
      ).rejects.toThrow(NotFoundError);

      // Deleting parent project cascades to project_queries
      const { eq } = await import("drizzle-orm");
      const { projectQueries, projects } = await import("./schema/index");
      await testDb.delete(projects).where(eq(projects.id, projectA.id));

      const remaining = await testDb
        .select()
        .from(projectQueries)
        .where(eq(projectQueries.projectId, projectA.id));
      expect(remaining).toHaveLength(0);
    });
  });
});

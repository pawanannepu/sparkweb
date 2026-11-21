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
  createDeployment,
  createProject,
  deleteSnapshot,
  getDecryptedApiKey,
  getProjectSnapshots,
  getProjectWithCurrentSnapshot,
  getUserApiKeys,
  recordPromptMessage,
  saveSnapshot,
  saveUserApiKey,
  slugify,
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
  });

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
  });
});

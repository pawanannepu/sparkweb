import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
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
  activateDeployment,
  buildDeploymentUrl,
  clearProjectCustomDomain,
  configureProjectCustomDomain,
  createDeployment,
  createProject,
  deleteProject,
  deleteSnapshot,
  ensureProjectDomain,
  failDeployment,
  getDeploymentById,
  getProjectDeletionResources,
  getProjectDomain,
  isSnapshotExhausted,
  listDeployments,
  markDeploymentBuilding,
  normalizeSlug,
  resolveLiveDeploymentBySubdomain,
  rollbackToDeployment,
  saveSnapshot,
  unpublishProject,
  updateCustomDomainVerificationState,
  updateProjectSubdomain,
  validateSubdomain,
} from "./queries";
import { projects, promptMessages, promptThreads, users } from "./schema/index";

describe("publishing queries integration with PGlite", () => {
  let pglite: PGlite;
  let testDb: ReturnType<typeof createPgliteDatabase>;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    pglite = new PGlite();
    testDb = createPgliteDatabase(pglite);
    await runPgliteMigrations(testDb);

    const [owner] = await testDb
      .insert(users)
      .values({ email: "pub-owner@example.com", name: "Owner" })
      .returning();
    const [other] = await testDb
      .insert(users)
      .values({ email: "pub-other@example.com", name: "Other" })
      .returning();
    if (!owner || !other) throw new Error("Failed to seed test users");
    ownerId = owner.id;
    otherId = other.id;
  }, 30_000);

  afterAll(async () => {
    await pglite.close();
  }, 15_000);

  it("auto-seeds project subdomain, promotes active deployment atomically, and retires previous release (AC-1, AC-4)", async () => {
    const project = await createProject(testDb, {
      userId: ownerId,
      name: "My Store",
    });

    const snap1 = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>v1</h1>" } },
    });

    const d1 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap1.id,
    });
    expect(d1.status).toBe("queued");
    expect(d1.subdomain).toBe("my-store");
    expect(d1.artifactKey).toBe(`deployments/${project.id}/${d1.id}`);

    // Concurrent deployment while queued is rejected with 409 Conflict
    await expect(
      createDeployment(testDb, {
        projectId: project.id,
        userId: ownerId,
        snapshotId: snap1.id,
      })
    ).rejects.toThrow(ConflictError);

    // Snapshot backing queued deployment cannot be deleted (AC-9)
    await expect(deleteSnapshot(testDb, { id: snap1.id, userId: ownerId })).rejects.toThrow(
      SnapshotInActiveDeploymentError
    );

    await markDeploymentBuilding(testDb, { deploymentId: d1.id });
    const active1 = await activateDeployment(testDb, {
      projectId: project.id,
      deploymentId: d1.id,
      buildLogs: "Built v1",
      buildDurationMs: 1200,
      artifactKey: d1.artifactKey ?? "",
    });
    expect(active1.status).toBe("active");

    const [projAfter1] = await testDb
      .select({ activeDeploymentId: projects.activeDeploymentId })
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(projAfter1?.activeDeploymentId).toBe(d1.id);

    // Second publish retires d1 when d2 activates
    const snap2 = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>v2</h1>" } },
    });
    const d2 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap2.id,
    });
    const active2 = await activateDeployment(testDb, {
      projectId: project.id,
      deploymentId: d2.id,
      buildLogs: "Built v2",
      buildDurationMs: 900,
      artifactKey: d2.artifactKey ?? "",
    });
    expect(active2.status).toBe("active");

    // Failed d3 preserves d2 as active
    const d3 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap2.id,
    });
    await failDeployment(testDb, {
      deploymentId: d3.id,
      buildLogs: "Syntax error",
      buildDurationMs: 300,
      errorMessage: "Vite build failed",
    });

    const list = await listDeployments(testDb, { projectId: project.id, userId: ownerId });
    expect(list.activeDeployment?.id).toBe(d2.id);
    expect(list.items.find((d) => d.id === d1.id)?.status).toBe("retired");
    expect(list.items.find((d) => d.id === d3.id)?.status).toBe("failed");

    // Rollback to d1 promotes d1's artifactKey without rebuilding
    const rollback = await rollbackToDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      targetDeploymentId: d1.id,
    });
    expect(rollback.deployment.trigger).toBe("rollback");
    expect(rollback.deployment.promotedFromDeploymentId).toBe(d1.id);
    expect(rollback.deployment.artifactKey).toBe(d1.artifactKey);
    expect(rollback.deployment.status).toBe("active");

    // Unpublish retires active deployment and clears activeDeploymentId
    await unpublishProject(testDb, { projectId: project.id, userId: ownerId });
    const afterUnpub = await listDeployments(testDb, { projectId: project.id, userId: ownerId });
    expect(afterUnpub.activeDeployment).toBeNull();
  });

  it("defaults buildDeploymentUrl to localhost:3000 in local dev and sparkapps.dev for cloudflare", () => {
    const prevPlatform = process.env.PLATFORM_DOMAIN;
    const prevDriver = process.env.HOSTING_DRIVER;
    try {
      delete process.env.PLATFORM_DOMAIN;
      delete process.env.HOSTING_DRIVER;

      expect(
        buildDeploymentUrl({
          subdomain: "demo-app",
          customDomain: null,
          verificationStatus: "unconfigured",
          sslStatus: "unconfigured",
        })
      ).toBe("http://demo-app.localhost:3000");

      process.env.HOSTING_DRIVER = "cloudflare";
      expect(
        buildDeploymentUrl({
          subdomain: "demo-app",
          customDomain: null,
          verificationStatus: "unconfigured",
          sslStatus: "unconfigured",
        })
      ).toBe("https://demo-app.sparkapps.dev");
    } finally {
      if (prevPlatform === undefined) delete process.env.PLATFORM_DOMAIN;
      else process.env.PLATFORM_DOMAIN = prevPlatform;
      if (prevDriver === undefined) delete process.env.HOSTING_DRIVER;
      else process.env.HOSTING_DRIVER = prevDriver;
    }
  });

  it("enforces subdomain uniqueness across projects and handles custom domain verification lifecycle (AC-6)", async () => {
    const projA = await createProject(testDb, { userId: ownerId, name: "Alpha Site" });
    const projB = await createProject(testDb, { userId: otherId, name: "Beta Site" });

    await ensureProjectDomain(testDb, {
      projectId: projA.id,
      userId: ownerId,
      preferredSubdomain: "shared-name",
    });

    await expect(
      updateProjectSubdomain(testDb, {
        projectId: projB.id,
        userId: otherId,
        subdomain: "shared-name",
      })
    ).rejects.toThrow(ConflictError);

    await expect(
      updateProjectSubdomain(testDb, {
        projectId: projB.id,
        userId: otherId,
        subdomain: "api",
      })
    ).rejects.toThrow(ValidationError);

    const configured = await configureProjectCustomDomain(testDb, {
      projectId: projA.id,
      userId: ownerId,
      customDomain: "app.example.com",
      recordType: "cname",
      verificationToken: "spark-verify=1234567890abcdef",
    });
    expect(configured.domain.verificationStatus).toBe("pending");

    await expect(
      configureProjectCustomDomain(testDb, {
        projectId: projB.id,
        userId: otherId,
        customDomain: "app.example.com",
        recordType: "cname",
        verificationToken: "spark-verify=abcdef",
      })
    ).rejects.toThrow(ConflictError);

    const verified = await updateCustomDomainVerificationState(testDb, {
      projectId: projA.id,
      userId: ownerId,
      verificationStatus: "verified",
      sslStatus: "active",
      providerHostnameId: "cf-host-1",
      lastCheckedAt: new Date(),
      verifiedAt: new Date(),
    });
    expect(verified.domain.sslStatus).toBe("active");

    const cleared = await clearProjectCustomDomain(testDb, {
      projectId: projA.id,
      userId: ownerId,
    });
    expect(cleared.clearedCustomDomain).toBe("app.example.com");
    expect(cleared.domain.customDomain).toBeNull();
  });

  it("detects exhausted healing snapshots from message prefix or prompt message toolCalls (AC-2)", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "Exhaust Check" });
    const cleanSnap = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>ok</h1>" } },
      message: "Clean build",
    });
    expect(await isSnapshotExhausted(testDb, cleanSnap.id)).toBe(false);

    const exhaustedMsgSnap = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>bad</h1>" } },
      message: "[Unverified - healing exhausted] Build failed",
    });
    expect(await isSnapshotExhausted(testDb, exhaustedMsgSnap.id)).toBe(true);

    const [thread] = await testDb
      .insert(promptThreads)
      .values({ projectId: project.id, title: "Main" })
      .returning();
    if (!thread) throw new Error("Failed to insert thread");

    const linkedSnap = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>linked</h1>" } },
      message: "Attempt",
    });
    await testDb.insert(promptMessages).values({
      threadId: thread.id,
      seq: 1,
      role: "assistant",
      content: "Repair exhausted",
      snapshotId: linkedSnap.id,
      toolCalls: { verificationStatus: "exhausted" },
    });
    expect(await isSnapshotExhausted(testDb, linkedSnap.id)).toBe(true);
  });

  // covers: AC-1, AC-5, AC-7
  it("validates subdomains, updates active deployment URLs on subdomain rename, and preserves current domain on rollback", async () => {
    expect(normalizeSlug("  Hello World!! ")).toBe("hello-world");
    expect(normalizeSlug("---")).toBe("project");
    expect(() => validateSubdomain("ab")).toThrow(ValidationError);
    expect(() => validateSubdomain("admin")).toThrow(ValidationError);
    expect(validateSubdomain(" My-App-1 ")).toBe("my-app-1");

    const project = await createProject(testDb, { userId: ownerId, name: "Rename Live" });
    const snap = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>live</h1>" } },
    });

    const d1 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap.id,
    });
    await activateDeployment(testDb, {
      projectId: project.id,
      deploymentId: d1.id,
      buildLogs: "ok",
      buildDurationMs: 100,
      artifactKey: d1.artifactKey ?? "",
    });

    const renamed = await updateProjectSubdomain(testDb, {
      projectId: project.id,
      userId: ownerId,
      subdomain: "renamed-live",
    });
    expect(renamed.previousSubdomain).not.toBe("renamed-live");
    expect(renamed.activeDeployment?.subdomain).toBe("renamed-live");
    expect(renamed.activeDeployment?.deploymentUrl).toContain("renamed-live");

    const resolvedNew = await resolveLiveDeploymentBySubdomain(testDb, "renamed-live");
    expect(resolvedNew?.deploymentId).toBe(d1.id);
    if (renamed.previousSubdomain) {
      expect(await resolveLiveDeploymentBySubdomain(testDb, renamed.previousSubdomain)).toBeNull();
    }

    const rolled = await rollbackToDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      targetDeploymentId: d1.id,
    });
    expect(rolled.deployment.subdomain).toBe("renamed-live");
    expect(rolled.deployment.deploymentUrl).toContain("renamed-live");
  });

  // covers: AC-2, AC-7, AC-9
  it("enforces tenant ownership, pagination, snapshot deletion guards, and project deletion resources", async () => {
    const project = await createProject(testDb, { userId: ownerId, name: "Guard Test" });
    const snap1 = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>1</h1>" } },
    });
    const snap2 = await saveSnapshot(testDb, {
      projectId: project.id,
      userId: ownerId,
      files: { "index.html": { content: "<h1>2</h1>" } },
    });

    const d1 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap1.id,
    });
    await markDeploymentBuilding(testDb, { deploymentId: d1.id });
    await expect(deleteSnapshot(testDb, { id: snap1.id, userId: ownerId })).rejects.toThrow(
      SnapshotInActiveDeploymentError
    );

    await activateDeployment(testDb, {
      projectId: project.id,
      deploymentId: d1.id,
      buildLogs: "ok",
      buildDurationMs: 50,
      artifactKey: d1.artifactKey ?? "",
    });
    await expect(deleteSnapshot(testDb, { id: snap1.id, userId: ownerId })).rejects.toThrow(
      SnapshotInActiveDeploymentError
    );

    const d2 = await createDeployment(testDb, {
      projectId: project.id,
      userId: ownerId,
      snapshotId: snap2.id,
    });
    await activateDeployment(testDb, {
      projectId: project.id,
      deploymentId: d2.id,
      buildLogs: "ok2",
      buildDurationMs: 50,
      artifactKey: d2.artifactKey ?? "",
    });

    const loaded = await getDeploymentById(testDb, {
      projectId: project.id,
      deploymentId: d1.id,
      userId: ownerId,
    });
    expect(loaded.status).toBe("retired");

    await expect(
      getDeploymentById(testDb, { projectId: project.id, deploymentId: d1.id, userId: otherId })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      getProjectDomain(testDb, { projectId: project.id, userId: otherId })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      getDeploymentById(testDb, {
        projectId: project.id,
        deploymentId: "00000000-0000-0000-0000-000000000999",
        userId: ownerId,
      })
    ).rejects.toThrow(NotFoundError);

    const page1 = await listDeployments(testDb, {
      projectId: project.id,
      userId: ownerId,
      limit: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listDeployments(testDb, {
      projectId: project.id,
      userId: ownerId,
      limit: 1,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);

    const resources = await getProjectDeletionResources(testDb, {
      projectId: project.id,
      userId: ownerId,
    });
    expect(resources.artifactKeys).toHaveLength(2);

    await deleteProject(testDb, { projectId: project.id, userId: ownerId });
    await expect(
      getProjectDeletionResources(testDb, { projectId: project.id, userId: ownerId })
    ).rejects.toThrow(NotFoundError);
  });
});

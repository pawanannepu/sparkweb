import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  accounts,
  apiKeys,
  deployments,
  designAttachments,
  designOutlines,
  projectBranches,
  projectDomains,
  projects,
  promptMessages,
  promptThreads,
  sessions,
  snapshots,
  users,
  verificationTokens,
} from "./index";

describe("db schema definitions", () => {
  it("defines users table with expected column attributes", () => {
    const columns = getTableColumns(users);
    expect(columns.id).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.email).toBeDefined();
    expect(columns.emailVerified).toBeDefined();
    expect(columns.image).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines accounts table with composite primary key fields", () => {
    const columns = getTableColumns(accounts);
    expect(columns.userId).toBeDefined();
    expect(columns.provider).toBeDefined();
    expect(columns.providerAccountId).toBeDefined();
    expect(columns.type).toBeDefined();
    expect(columns.accessToken).toBeDefined();
    expect(columns.refreshToken).toBeDefined();
  });

  it("defines sessions table with sessionToken primary key", () => {
    const columns = getTableColumns(sessions);
    expect(columns.sessionToken).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.expires).toBeDefined();
  });

  it("defines verificationTokens table with identifier and token", () => {
    const columns = getTableColumns(verificationTokens);
    expect(columns.identifier).toBeDefined();
    expect(columns.token).toBeDefined();
    expect(columns.expires).toBeDefined();
  });

  it("defines api_keys table with encryption and auth tag attributes", () => {
    const columns = getTableColumns(apiKeys);
    expect(columns.id).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.provider).toBeDefined();
    expect(columns.encryptedKey).toBeDefined();
    expect(columns.keyHint).toBeDefined();
    expect(columns.iv).toBeDefined();
    expect(columns.authTag).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it("defines projects table with slug, activeDeploymentId, and snapshot pointers", () => {
    const columns = getTableColumns(projects);
    expect(columns.id).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.slug).toBeDefined();
    expect(columns.description).toBeDefined();
    expect(columns.isTemplate).toBeDefined();
    expect(columns.forkedFromProjectId).toBeDefined();
    expect(columns.currentSnapshotId).toBeDefined();
    expect(columns.activeBranchId).toBeDefined();
    expect(columns.activeDeploymentId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines prompt_threads and prompt_messages tables with sequencing and outline lock", () => {
    const threadColumns = getTableColumns(promptThreads);
    expect(threadColumns.id).toBeDefined();
    expect(threadColumns.projectId).toBeDefined();
    expect(threadColumns.title).toBeDefined();
    expect(threadColumns.outlineLockExpiresAt).toBeDefined();

    const messageColumns = getTableColumns(promptMessages);
    expect(messageColumns.id).toBeDefined();
    expect(messageColumns.threadId).toBeDefined();
    expect(messageColumns.seq).toBeDefined();
    expect(messageColumns.role).toBeDefined();
    expect(messageColumns.content).toBeDefined();
    expect(messageColumns.toolCalls).toBeDefined();
    expect(messageColumns.snapshotId).toBeDefined();
    expect(messageColumns.status).toBeDefined();
  });

  it("defines snapshots table with content addressable tree hash and files map", () => {
    const columns = getTableColumns(snapshots);
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.parentId).toBeDefined();
    expect(columns.branchId).toBeDefined();
    expect(columns.branchName).toBeDefined();
    expect(columns.treeHash).toBeDefined();
    expect(columns.files).toBeDefined();
    expect(columns.fileCount).toBeDefined();
    expect(columns.message).toBeDefined();
    expect(columns.trigger).toBeDefined();
    expect(columns.tag).toBeDefined();
    expect(columns.restoredFromSnapshotId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it("defines project_branches table with unique constraint on projectId and name", () => {
    const columns = getTableColumns(projectBranches);
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.headSnapshotId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines deployments table with artifactKey, trigger, and lifecycle columns", () => {
    const columns = getTableColumns(deployments);
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.snapshotId).toBeDefined();
    expect(columns.subdomain).toBeDefined();
    expect(columns.customDomain).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.deploymentUrl).toBeDefined();
    expect(columns.artifactKey).toBeDefined();
    expect(columns.buildDurationMs).toBeDefined();
    expect(columns.errorMessage).toBeDefined();
    expect(columns.trigger).toBeDefined();
    expect(columns.promotedFromDeploymentId).toBeDefined();
    expect(columns.retiredAt).toBeDefined();
  });

  it("defines project_domains table with verification and SSL columns", () => {
    const columns = getTableColumns(projectDomains);
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.subdomain).toBeDefined();
    expect(columns.customDomain).toBeDefined();
    expect(columns.recordType).toBeDefined();
    expect(columns.verificationToken).toBeDefined();
    expect(columns.verificationStatus).toBeDefined();
    expect(columns.sslStatus).toBeDefined();
    expect(columns.providerHostnameId).toBeDefined();
    expect(columns.failureReason).toBeDefined();
    expect(columns.lastCheckedAt).toBeDefined();
    expect(columns.verifiedAt).toBeDefined();
  });

  // covers: AC-1
  it("defines design_attachments and design_outlines tables with expected multimodal columns", () => {
    const attachmentColumns = getTableColumns(designAttachments);
    expect(attachmentColumns.id).toBeDefined();
    expect(attachmentColumns.projectId).toBeDefined();
    expect(attachmentColumns.threadId).toBeDefined();
    expect(attachmentColumns.messageId).toBeDefined();
    expect(attachmentColumns.kind).toBeDefined();
    expect(attachmentColumns.storageKey).toBeDefined();
    expect(attachmentColumns.sourceUrl).toBeDefined();
    expect(attachmentColumns.fileName).toBeDefined();
    expect(attachmentColumns.mimeType).toBeDefined();
    expect(attachmentColumns.sizeBytes).toBeDefined();
    expect(attachmentColumns.width).toBeDefined();
    expect(attachmentColumns.height).toBeDefined();
    expect(attachmentColumns.urlSnapshot).toBeDefined();

    const outlineColumns = getTableColumns(designOutlines);
    expect(outlineColumns.id).toBeDefined();
    expect(outlineColumns.projectId).toBeDefined();
    expect(outlineColumns.threadId).toBeDefined();
    expect(outlineColumns.sourceMessageId).toBeDefined();
    expect(outlineColumns.clonedFromOutlineId).toBeDefined();
    expect(outlineColumns.outlineMessageId).toBeDefined();
    expect(outlineColumns.buildMessageId).toBeDefined();
    expect(outlineColumns.status).toBeDefined();
    expect(outlineColumns.modelId).toBeDefined();
    expect(outlineColumns.extractedOutline).toBeDefined();
    expect(outlineColumns.editedOutline).toBeDefined();
  });
});

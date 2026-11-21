import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  accounts,
  apiKeys,
  deployments,
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

  it("defines projects table with slug and snapshot pointers", () => {
    const columns = getTableColumns(projects);
    expect(columns.id).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.slug).toBeDefined();
    expect(columns.description).toBeDefined();
    expect(columns.isTemplate).toBeDefined();
    expect(columns.forkedFromProjectId).toBeDefined();
    expect(columns.currentSnapshotId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines prompt_threads and prompt_messages tables with sequencing", () => {
    const threadColumns = getTableColumns(promptThreads);
    expect(threadColumns.id).toBeDefined();
    expect(threadColumns.projectId).toBeDefined();
    expect(threadColumns.title).toBeDefined();

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
    expect(columns.branchName).toBeDefined();
    expect(columns.treeHash).toBeDefined();
    expect(columns.files).toBeDefined();
    expect(columns.message).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it("defines deployments table with subdomain and deploymentUrl", () => {
    const columns = getTableColumns(deployments);
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.snapshotId).toBeDefined();
    expect(columns.subdomain).toBeDefined();
    expect(columns.customDomain).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.deploymentUrl).toBeDefined();
  });
});

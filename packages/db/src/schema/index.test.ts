import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, snapshots, users } from "./index";

describe("db schema definitions", () => {
  it("defines users table with expected column attributes", () => {
    // Arrange & Act
    const columns = getTableColumns(users);

    // Assert
    expect(columns.id).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.email).toBeDefined();
    expect(columns.image).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines projects table with user foreign key relationship", () => {
    // Arrange & Act
    const columns = getTableColumns(projects);

    // Assert
    expect(columns.id).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.name).toBeDefined();
    expect(columns.prompt).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it("defines snapshots table with project foreign key relationship and tree hash", () => {
    // Arrange & Act
    const columns = getTableColumns(snapshots);

    // Assert
    expect(columns.id).toBeDefined();
    expect(columns.projectId).toBeDefined();
    expect(columns.treeHash).toBeDefined();
    expect(columns.message).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });
});

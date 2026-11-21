import { describe, expect, it } from "vitest";
import { db } from "./client";

describe("db client singleton", () => {
  it("exports a configured drizzle database instance", () => {
    // Arrange & Act & Assert
    expect(db).toBeDefined();
    expect(typeof db.query).toBe("object");
  });

  it("preserves the postgres connection on globalThis in non production environments", () => {
    // Arrange
    const globalObj = globalThis as unknown as { conn?: unknown };

    // Act & Assert
    expect(globalObj.conn).toBeDefined();
  });
});

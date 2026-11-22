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

  it("creates an in memory pglite database instance with query schema", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { createPgliteDatabase } = await import("./client");
    const pglite = new PGlite();
    const testDb = createPgliteDatabase(pglite);

    expect(testDb).toBeDefined();
    expect(typeof testDb.select).toBe("function");
    await pglite.close();
  }, 30000);
});

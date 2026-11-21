import { describe, expect, it } from "vitest";
import type { PreviewEvent, PreviewStatus, ProjectFile } from "./index";

describe("shared type contracts", () => {
  it("validates preview event creation with expected structure", () => {
    // Arrange
    const event: PreviewEvent = {
      type: "status",
      payload: { status: "running" },
      timestamp: Date.now(),
    };

    // Act & Assert
    expect(event.type).toBe("status");
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.payload).toEqual({ status: "running" });
  });

  it("validates project file contract representation", () => {
    // Arrange
    const file: ProjectFile = {
      path: "src/index.ts",
      content: 'console.log("sparkweb");',
    };

    // Act & Assert
    expect(file.path).toBe("src/index.ts");
    expect(file.content).toContain("sparkweb");
  });

  it("allows valid preview status enum literals", () => {
    // Arrange
    const statuses: PreviewStatus[] = ["idle", "booting", "installing", "running", "error"];

    // Act & Assert
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain("running");
  });
});

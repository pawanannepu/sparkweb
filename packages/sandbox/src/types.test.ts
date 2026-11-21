import { describe, expect, it } from "vitest";
import type { RunnerState, SandboxBridgeMessage, SandboxConfig } from "./types";

describe("sandbox type contracts", () => {
  it("constructs a valid sandbox configuration shape", () => {
    // Arrange
    const config: SandboxConfig = {
      projectId: "proj_123",
      files: [{ path: "package.json", content: '{"name": "demo"}' }],
    };

    // Act & Assert
    expect(config.projectId).toBe("proj_123");
    expect(config.files).toHaveLength(1);
  });

  it("constructs a valid sandbox bridge message from host to runner", () => {
    // Arrange
    const message: SandboxBridgeMessage = {
      id: "msg_001",
      source: "host",
      event: {
        type: "log",
        payload: "Starting WebContainer instance",
        timestamp: Date.now(),
      },
    };

    // Act & Assert
    expect(message.source).toBe("host");
    expect(message.event.type).toBe("log");
  });

  it("validates runner state shape with optional url and error", () => {
    // Arrange
    const readyState: RunnerState = {
      status: "running",
      url: "http://localhost:5173",
    };
    const errorState: RunnerState = {
      status: "error",
      error: "Failed to mount virtual file system",
    };

    // Act & Assert
    expect(readyState.status).toBe("running");
    expect(readyState.url).toBe("http://localhost:5173");
    expect(errorState.status).toBe("error");
    expect(errorState.error).toContain("Failed");
  });
});

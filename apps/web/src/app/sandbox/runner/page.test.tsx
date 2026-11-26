import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const runnerInstances: number[] = [];
let capturedOnReady: ((url: string) => void) | undefined;

// Mock @spark/sandbox runner
vi.mock("@spark/sandbox", () => ({
  upgradeLegacyDbTemplate: <T,>(files: T) => files,
  WebContainerRunner: class {
    constructor(callbacks?: { onReady?: (url: string) => void }) {
      runnerInstances.push(1);
      capturedOnReady = callbacks?.onReady;
    }
    getStatus() {
      return "idle";
    }
    getUrl() {
      return null;
    }
    async boot() {
      return "http://localhost:3000";
    }
    async applyFileUpdates() {}
  },
}));

import SandboxRunnerPage from "./page";

describe("SandboxRunnerPage", () => {
  // covers: AC-7
  it("renders runner shell with title, runtime descriptor, and status badge", () => {
    // Arrange & Act
    render(<SandboxRunnerPage />);

    // Assert
    expect(screen.getByText("Sparkweb Sandbox")).toBeInTheDocument();
    expect(screen.getByText("WebAssembly Node.js Runtime")).toBeInTheDocument();
    expect(screen.getByText("Terminal Output")).toBeInTheDocument();
    expect(screen.getByText("Waiting for process logs...")).toBeInTheDocument();
  });

  // covers: AC-4, AC-7
  it("renders idle status badge and loader text initially", () => {
    // Arrange & Act
    render(<SandboxRunnerPage />);

    // Assert
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("Initializing preview environment...")).toBeInTheDocument();
    expect(screen.getByText("Vite dev server starting in browser WebAssembly")).toBeInTheDocument();
  });

  // covers: AC-1, AC-3
  it("subscribes to window message events for host bridge communication", () => {
    // Arrange
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    // Act
    render(<SandboxRunnerPage />);

    // Assert
    expect(addEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("does not re-instantiate WebContainerRunner when previewUrl updates via onReady", () => {
    runnerInstances.length = 0;
    render(<SandboxRunnerPage />);
    expect(runnerInstances).toHaveLength(1);

    act(() => {
      capturedOnReady?.("https://mock-preview.local");
    });

    expect(runnerInstances).toHaveLength(1);
  });

  // covers: AC-4 (HMR completion before health check)
  it("resolves PREVIEW_HEALTH_CHECK promptly when PREVIEW_HMR_COMPLETE arrived before health check", async () => {
    vi.useFakeTimers();
    const postMessageSpy = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    try {
      render(<SandboxRunnerPage />);

      // Simulate host sending PREVIEW_WRITE_FILES
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent as unknown as Window,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_WRITE_FILES",
              source: "sparkweb:host",
              payload: { files: [{ path: "src/App.tsx", content: "export default () => null;" }] },
              timestamp: Date.now(),
            },
          })
        );
      });

      // Simulate inner iframe sending PREVIEW_HMR_COMPLETE before PREVIEW_HEALTH_CHECK arrives
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: null,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_HMR_COMPLETE",
              source: "sparkweb:app",
              payload: { timestamp: Date.now() },
              timestamp: Date.now(),
            },
          })
        );
      });

      // Now host requests health check with 4000ms timeout
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent as unknown as Window,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_HEALTH_CHECK",
              source: "sparkweb:host",
              payload: { timeoutMs: 4000 },
              timestamp: Date.now(),
            },
          })
        );
      });

      // Advance only 100ms (much less than 4000ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      const healthMsg = postMessageSpy.mock.calls
        .map((c) => c[0])
        .find((m) => m?.type === "PREVIEW_HEALTH_STATUS");
      expect(healthMsg).toBeDefined();
      expect(healthMsg.payload).toEqual({ healthy: true });
    } finally {
      Object.defineProperty(window, "parent", {
        value: originalParent,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  // covers: AC-4
  it("resolves pending PREVIEW_HEALTH_CHECK as soon as PREVIEW_HMR_COMPLETE arrives after check starts", async () => {
    vi.useFakeTimers();
    const postMessageSpy = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    try {
      render(<SandboxRunnerPage />);

      // Host starts health check first
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent as unknown as Window,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_HEALTH_CHECK",
              source: "sparkweb:host",
              payload: { timeoutMs: 4000 },
              timestamp: Date.now(),
            },
          })
        );
      });

      // Inner iframe emits PREVIEW_HMR_COMPLETE while health check is pending
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: null,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_HMR_COMPLETE",
              source: "sparkweb:app",
              payload: { timestamp: Date.now() },
              timestamp: Date.now(),
            },
          })
        );
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      const healthMsg = postMessageSpy.mock.calls
        .map((c) => c[0])
        .find((m) => m?.type === "PREVIEW_HEALTH_STATUS");
      expect(healthMsg).toBeDefined();
      expect(healthMsg.payload).toEqual({ healthy: true });
    } finally {
      Object.defineProperty(window, "parent", {
        value: originalParent,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  // covers: AC-1, AC-4
  it("resolves pending PREVIEW_HEALTH_CHECK immediately as unhealthy when inner iframe sends PREVIEW_ERROR", async () => {
    vi.useFakeTimers();
    const postMessageSpy = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    try {
      render(<SandboxRunnerPage />);

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: window.parent as unknown as Window,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_HEALTH_CHECK",
              source: "sparkweb:host",
              payload: { timeoutMs: 4000 },
              timestamp: Date.now(),
            },
          })
        );
      });

      const runtimeErr = {
        category: "runtime",
        message: "ReferenceError: missingVar is not defined",
        filename: "src/App.tsx",
      };

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: null,
            data: {
              protocol: "sparkweb:bridge:v1",
              type: "PREVIEW_ERROR",
              source: "sparkweb:app",
              payload: runtimeErr,
              timestamp: Date.now(),
            },
          })
        );
      });

      const healthMsg = postMessageSpy.mock.calls
        .map((c) => c[0])
        .find((m) => m?.type === "PREVIEW_HEALTH_STATUS");
      expect(healthMsg).toBeDefined();
      expect(healthMsg.payload).toEqual({
        healthy: false,
        error: runtimeErr,
      });
    } finally {
      Object.defineProperty(window, "parent", {
        value: originalParent,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  // covers: AC-3, AC-6, AC-9
  it("forwards DB bridge requests down to the preview app iframe and relays responses up to host", async () => {
    const hostPostMessageSpy = vi.fn();
    const appPostMessageSpy = vi.fn();
    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      value: { postMessage: hostPostMessageSpy },
      configurable: true,
    });

    const getElementByIdSpy = vi.spyOn(document, "getElementById").mockImplementation((id) => {
      if (id === "sandbox-app-frame") {
        return { contentWindow: { postMessage: appPostMessageSpy } } as unknown as HTMLElement;
      }
      return null;
    });

    try {
      render(<SandboxRunnerPage />);

      // Host -> Runner -> App iframe forwarding
      const hostCommands = [
        { type: "DB_INTROSPECT_REQUEST", payload: { id: "req-1" } },
        { type: "DB_QUERY_REQUEST", payload: { id: "req-2", table: "demo_items" } },
        {
          type: "DB_MUTATE_REQUEST",
          payload: { id: "req-3", action: "insert", table: "demo_items" },
        },
        { type: "DB_EXPORT_SEED_REQUEST", payload: { id: "req-4" } },
      ];

      for (const cmd of hostCommands) {
        await act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: window.parent as unknown as Window,
              data: {
                protocol: "sparkweb:bridge:v1",
                type: cmd.type,
                source: "sparkweb:host",
                payload: cmd.payload,
                timestamp: Date.now(),
              },
            })
          );
        });
      }

      expect(appPostMessageSpy).toHaveBeenCalledTimes(4);
      expect(appPostMessageSpy.mock.calls.map((c) => c[0].type)).toEqual([
        "DB_INTROSPECT_REQUEST",
        "DB_QUERY_REQUEST",
        "DB_MUTATE_REQUEST",
        "DB_EXPORT_SEED_REQUEST",
      ]);

      // App iframe -> Runner -> Host upstream forwarding
      const appEvents = [
        { type: "DB_READY_EVENT", payload: { tableCount: 1 } },
        { type: "DB_INTROSPECT_RESPONSE", payload: { id: "req-1", tables: [] } },
        { type: "DB_MUTATED_EVENT", payload: { origin: "app", table: "demo_items" } },
        {
          type: "DB_EXPORT_SEED_RESPONSE",
          payload: { id: "req-4", sql: "", tableCount: 0, rowCount: 0 },
        },
      ];

      for (const ev of appEvents) {
        await act(async () => {
          window.dispatchEvent(
            new MessageEvent("message", {
              source: null,
              data: {
                protocol: "sparkweb:bridge:v1",
                type: ev.type,
                source: "sparkweb:app",
                payload: ev.payload,
                timestamp: Date.now(),
              },
            })
          );
        });
      }

      const relayedTypes = hostPostMessageSpy.mock.calls.map((c) => c[0]?.type);
      expect(relayedTypes).toContain("DB_READY_EVENT");
      expect(relayedTypes).toContain("DB_INTROSPECT_RESPONSE");
      expect(relayedTypes).toContain("DB_MUTATED_EVENT");
      expect(relayedTypes).toContain("DB_EXPORT_SEED_RESPONSE");
    } finally {
      getElementByIdSpy.mockRestore();
      Object.defineProperty(window, "parent", {
        value: originalParent,
        configurable: true,
      });
    }
  });
});

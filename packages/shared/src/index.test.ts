import { describe, expect, it } from "vitest";
import type {
  BridgeMessage,
  BridgeMessageType,
  CanvasHistoryStack,
  ElementRect,
  ElementSourceLocation,
  PreviewEvent,
  PreviewInspectModePayload,
  PreviewStatus,
  ProjectFile,
  SelectedElementState,
} from "./index";

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

  it("validates inspector bridge message types and payload contracts", () => {
    // Arrange
    const inspectMsgType: BridgeMessageType = "PREVIEW_INSPECT_MODE";
    const payload: PreviewInspectModePayload = { enabled: true };
    const bridgeMsg: BridgeMessage = {
      protocol: "sparkweb:bridge:v1",
      type: inspectMsgType,
      source: "sparkweb:host",
      payload: payload as unknown as Record<string, unknown>,
      timestamp: Date.now(),
    };

    // Act & Assert
    expect(bridgeMsg.type).toBe("PREVIEW_INSPECT_MODE");
    expect(bridgeMsg.protocol).toBe("sparkweb:bridge:v1");
    expect((bridgeMsg.payload as unknown as PreviewInspectModePayload).enabled).toBe(true);
  });

  it("validates canvas element selection and history contracts", () => {
    // Arrange
    const rect: ElementRect = { top: 10, left: 20, width: 200, height: 100 };
    const source: ElementSourceLocation = {
      file: "src/App.tsx",
      line: 42,
      column: 8,
      componentName: "App",
    };
    const state: SelectedElementState = {
      selector: "[data-source-loc='src/App.tsx:42:8']",
      tagName: "button",
      source,
      classes: ["bg-indigo-600", "text-white"],
      styles: { backgroundColor: "rgb(79, 70, 229)" },
      textContent: "Click me",
      rect,
      isEditable: true,
      isLeafTextOnly: true,
    };

    const history: CanvasHistoryStack = {
      past: [],
      present: { "src/App.tsx": "console.log('App');" },
      future: [],
    };

    // Act & Assert
    expect(state.tagName).toBe("button");
    expect(state.source?.file).toBe("src/App.tsx");
    expect(state.rect.width).toBe(200);
    expect(history.present["src/App.tsx"]).toContain("App");
  });
});

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTargetOrigin, usePreviewBridge } from "./usePreviewBridge";

describe("usePreviewBridge Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves target origin correctly from relative or absolute URLs", () => {
    expect(resolveTargetOrigin("/sandbox", "http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveTargetOrigin("http://127.0.0.1:3000/sandbox")).toBe("http://127.0.0.1:3000");
    expect(resolveTargetOrigin("https://preview.sparkweb.io")).toBe("https://preview.sparkweb.io");
  });

  it("buffers messages until PREVIEW_READY handshake is received", () => {
    const postMessageMock = vi.fn();
    const mockIframe = {
      contentWindow: {
        postMessage: postMessageMock,
      },
    } as unknown as HTMLIFrameElement;

    const iframeRef = { current: mockIframe };
    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef,
        targetUrl: "http://127.0.0.1:3000/sandbox",
      })
    );

    // Initial state: not connected
    expect(result.current.isConnected).toBe(false);

    // Send a message before handshake: should be queued, not posted yet
    act(() => {
      result.current.sendToPreview("PREVIEW_NAVIGATE", { path: "/dashboard" });
    });
    expect(postMessageMock).not.toHaveBeenCalled();

    // Simulate PREVIEW_READY from valid origin
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_READY",
            source: "sparkweb:sandbox",
            payload: {},
            timestamp: Date.now(),
          },
        })
      );
    });

    // Should now be connected and queued message flushed
    expect(result.current.isConnected).toBe(true);
    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PREVIEW_NAVIGATE",
        payload: { path: "/dashboard" },
      }),
      "http://127.0.0.1:3000"
    );
  });

  it("ignores messages from untrusted origins", () => {
    const onMessageMock = vi.fn();
    const iframeRef = { current: null };

    renderHook(() =>
      usePreviewBridge({
        iframeRef,
        targetUrl: "http://127.0.0.1:3000/sandbox",
        onMessage: onMessageMock,
      })
    );

    // Dispatch from untrusted origin
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://malicious-attacker.com",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_READY",
          },
        })
      );
    });

    expect(onMessageMock).not.toHaveBeenCalled();
  });
});

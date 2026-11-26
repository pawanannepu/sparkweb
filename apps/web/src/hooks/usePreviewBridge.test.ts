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

  it("dispatches PREVIEW_BOOT immediately before PREVIEW_READY so runner boots with snapshot files", () => {
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

    act(() => {
      result.current.sendToPreview("PREVIEW_BOOT", {
        files: { "seed.sql": { content: "SELECT 1;" } },
      });
    });

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PREVIEW_BOOT",
        payload: { files: { "seed.sql": { content: "SELECT 1;" } } },
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

  // covers: AC-4 (Runner crash timeout)
  it("resolves checkPreviewHealth with healthy false when runner times out without responding", async () => {
    vi.useFakeTimers();
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

    let healthResult: unknown;
    const promise = result.current.checkPreviewHealth(1000).then((res) => {
      healthResult = res;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    await promise;

    expect(healthResult).toEqual(
      expect.objectContaining({
        healthy: false,
        error: expect.objectContaining({
          category: "runtime",
        }),
      })
    );
    vi.useRealTimers();
  });

  // covers: AC-4
  it("resolves checkPreviewHealth with healthy true when PREVIEW_HEALTH_STATUS arrives before timeout", async () => {
    vi.useFakeTimers();
    const postMessageMock = vi.fn();
    const mockIframe = {
      contentWindow: {
        postMessage: postMessageMock,
      },
    } as unknown as HTMLIFrameElement;

    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: mockIframe },
        targetUrl: "http://127.0.0.1:3000/sandbox",
      })
    );

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

    const healthPromise = result.current.checkPreviewHealth(4000);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_HEALTH_STATUS",
            source: "sparkweb:sandbox",
            payload: { healthy: true },
            timestamp: Date.now(),
          },
        })
      );
    });

    const healthResult = await healthPromise;
    expect(healthResult).toEqual({ healthy: true });

    // Advancing past original timeout must not throw or trigger stale timers
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();
  });

  // covers: AC-4
  it("resolves checkPreviewHealth with runner error payload when PREVIEW_HEALTH_STATUS reports unhealthy", async () => {
    const postMessageMock = vi.fn();
    const mockIframe = {
      contentWindow: {
        postMessage: postMessageMock,
      },
    } as unknown as HTMLIFrameElement;

    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: mockIframe },
        targetUrl: "http://127.0.0.1:3000/sandbox",
      })
    );

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

    const healthPromise = result.current.checkPreviewHealth(4000);

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3000",
          data: {
            protocol: "sparkweb:bridge:v1",
            type: "PREVIEW_HEALTH_STATUS",
            source: "sparkweb:sandbox",
            payload: {
              healthy: false,
              error: { category: "syntax", message: "Unexpected token", filename: "src/App.tsx" },
            },
            timestamp: Date.now(),
          },
        })
      );
    });

    const healthResult = await healthPromise;
    expect(healthResult).toEqual({
      healthy: false,
      error: { category: "syntax", message: "Unexpected token", filename: "src/App.tsx" },
    });
  });

  it("resets connection state and rebuffers messages when resetConnection is called", () => {
    const postMessageMock = vi.fn();
    const mockIframe = {
      contentWindow: {
        postMessage: postMessageMock,
      },
    } as unknown as HTMLIFrameElement;

    const { result } = renderHook(() =>
      usePreviewBridge({
        iframeRef: { current: mockIframe },
        targetUrl: "http://127.0.0.1:3000/sandbox",
      })
    );

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
    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.resetConnection();
    });
    expect(result.current.isConnected).toBe(false);

    act(() => {
      result.current.sendToPreview("PREVIEW_RELOAD", {});
    });
    expect(postMessageMock).not.toHaveBeenCalled();
  });
});

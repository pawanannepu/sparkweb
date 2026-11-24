"use client";

import type { BridgeMessage, BridgeMessageType, PreviewHealthStatusPayload } from "@spark/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface UsePreviewBridgeOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  targetUrl: string;
  onMessage?: (message: BridgeMessage) => void;
}

export function resolveTargetOrigin(targetUrl: string, baseOrigin?: string): string {
  try {
    const base =
      baseOrigin ||
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    const parsed = new URL(targetUrl, base);
    return parsed.origin;
  } catch {
    return "";
  }
}

export function usePreviewBridge({ iframeRef, targetUrl, onMessage }: UsePreviewBridgeOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<BridgeMessage | null>(null);
  const pendingQueueRef = useRef<BridgeMessage[]>([]);
  const healthCheckResolverRef = useRef<((payload: PreviewHealthStatusPayload) => void) | null>(
    null
  );
  const targetOrigin = useMemo(() => resolveTargetOrigin(targetUrl), [targetUrl]);

  const sendToPreview = useCallback(
    (type: BridgeMessageType, payload: Record<string, unknown> = {}) => {
      const message: BridgeMessage = {
        protocol: "sparkweb:bridge:v1",
        type,
        source: "sparkweb:host",
        payload,
        timestamp: Date.now(),
      };

      const iframeWindow = iframeRef.current?.contentWindow;
      if (!iframeWindow || !isConnected || !targetOrigin) {
        pendingQueueRef.current.push(message);
        return;
      }

      try {
        iframeWindow.postMessage(message, targetOrigin);
      } catch (err) {
        console.warn("Failed to post message to preview iframe", err);
      }
    },
    [iframeRef, isConnected, targetOrigin]
  );

  const checkPreviewHealth = useCallback(
    (timeoutMs = 4000): Promise<PreviewHealthStatusPayload> => {
      return new Promise((resolve) => {
        healthCheckResolverRef.current = resolve;
        sendToPreview("PREVIEW_HEALTH_CHECK", { timeoutMs });

        // Fallback safety timeout if iframe drops message
        setTimeout(() => {
          if (healthCheckResolverRef.current === resolve) {
            healthCheckResolverRef.current = null;
            resolve({ healthy: true });
          }
        }, timeoutMs + 300);
      });
    },
    [sendToPreview]
  );

  const resetConnection = useCallback(() => {
    setIsConnected(false);
    pendingQueueRef.current = [];
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !targetOrigin) return;

    const handleMessage = (event: MessageEvent) => {
      // Strict origin verification
      if (event.origin !== targetOrigin) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object" || data.protocol !== "sparkweb:bridge:v1") {
        return;
      }

      const bridgeMsg = data as BridgeMessage;
      setLastMessage(bridgeMsg);
      onMessage?.(bridgeMsg);

      if (bridgeMsg.type === "PREVIEW_HEALTH_STATUS") {
        const payload = bridgeMsg.payload as unknown as PreviewHealthStatusPayload;
        if (healthCheckResolverRef.current) {
          const resolver = healthCheckResolverRef.current;
          healthCheckResolverRef.current = null;
          resolver(payload);
        }
      }

      if (bridgeMsg.type === "PREVIEW_READY") {
        setIsConnected(true);
        // Flush pending queued messages
        const queue = [...pendingQueueRef.current];
        pendingQueueRef.current = [];
        const iframeWindow = iframeRef.current?.contentWindow;
        if (iframeWindow) {
          for (const queued of queue) {
            try {
              iframeWindow.postMessage(queued, targetOrigin);
            } catch (err) {
              console.warn("Error flushing queued bridge message", err);
            }
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [iframeRef, onMessage, targetOrigin]);

  return {
    isConnected,
    lastMessage,
    sendToPreview,
    checkPreviewHealth,
    resetConnection,
    targetOrigin,
  };
}

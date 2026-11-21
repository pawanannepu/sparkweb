"use client";

import type { DeviceMode } from "@spark/shared";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PreviewFrameProps {
  src: string;
  device: DeviceMode;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
  isDragging?: boolean;
  className?: string;
  onLoad?: () => void;
}

const DEVICE_DIMENSIONS: Record<DeviceMode, { width: number; height: number; isFluid?: boolean }> =
  {
    desktop: { width: 0, height: 0, isFluid: true },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 667 },
  };

export function PreviewFrame({
  src,
  device,
  iframeRef,
  isDragging = false,
  className,
  onLoad,
}: PreviewFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Auto scale down for tablet / mobile if canvas container is narrower than preset
  useEffect(() => {
    if (device === "desktop" || !containerRef.current) {
      setScale(1);
      return;
    }

    const updateScale = () => {
      if (!containerRef.current) return;
      const targetWidth = DEVICE_DIMENSIONS[device].width;
      const availableWidth = containerRef.current.clientWidth - 32; // 16px padding each side
      if (availableWidth < targetWidth && availableWidth > 0) {
        setScale(availableWidth / targetWidth);
      } else {
        setScale(1);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [device]);

  const targetDim = DEVICE_DIMENSIONS[device];

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-1 items-center justify-center overflow-auto bg-muted/20 p-2 sm:p-4",
        className
      )}
    >
      {/* Pointer capture shield during active resizer dragging */}
      {isDragging && (
        <div
          className="absolute inset-0 z-50 cursor-col-resize bg-transparent"
          aria-hidden="true"
        />
      )}

      {/* Frame wrapper with dimension styling */}
      <div
        style={{
          width: targetDim.isFluid ? "100%" : `${targetDim.width}px`,
          height: targetDim.isFluid ? "100%" : `${targetDim.height}px`,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: "top center",
          transition: "width 0.2s ease, height 0.2s ease, transform 0.2s ease",
        }}
        className={cn(
          "relative overflow-hidden bg-background",
          targetDim.isFluid
            ? "h-full w-full"
            : "rounded-lg border border-border shadow-2xl ring-1 ring-border/50"
        )}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title="Sparkweb Live Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="h-full w-full border-0 bg-background"
          onLoad={onLoad}
        />
      </div>
    </div>
  );
}

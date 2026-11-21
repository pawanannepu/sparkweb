"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export const workspaceLayoutSchema = z.object({
  version: z.literal(1).default(1),
  chatPanelSize: z.number().min(15).max(50).default(30),
  previewPanelSize: z.number().min(50).max(85).default(70),
  lastExpandedChatSize: z.number().min(15).max(50).default(30),
  isChatCollapsed: z.boolean().default(false),
  previewDevice: z.enum(["desktop", "tablet", "mobile"]).default("desktop"),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export type WorkspaceLayoutState = z.infer<typeof workspaceLayoutSchema>;
export type DeviceMode = WorkspaceLayoutState["previewDevice"];

export const DEFAULT_LAYOUT_STATE: WorkspaceLayoutState = {
  version: 1,
  chatPanelSize: 30,
  previewPanelSize: 70,
  lastExpandedChatSize: 30,
  isChatCollapsed: false,
  previewDevice: "desktop",
  updatedAt: new Date().toISOString(),
};

const STORAGE_KEY = "sparkweb:layout:v1";

export function normalizeLayoutSizes(
  chat: number,
  _preview?: number
): { chat: number; preview: number } {
  const clampedChat = Math.min(50, Math.max(15, Math.round(chat)));
  const complementaryPreview = 100 - clampedChat;
  return { chat: clampedChat, preview: complementaryPreview };
}

export function readStoredLayout(): WorkspaceLayoutState {
  if (typeof window === "undefined") {
    return DEFAULT_LAYOUT_STATE;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT_STATE;
    const parsed = JSON.parse(raw);
    const result = workspaceLayoutSchema.safeParse(parsed);
    if (result.success) {
      const normalized = normalizeLayoutSizes(
        result.data.chatPanelSize,
        result.data.previewPanelSize
      );
      return {
        ...result.data,
        chatPanelSize: normalized.chat,
        previewPanelSize: normalized.preview,
      };
    }
    console.warn("Invalid workspace layout in localStorage, resetting to defaults", result.error);
    return DEFAULT_LAYOUT_STATE;
  } catch (err) {
    console.warn("Failed to read workspace layout from localStorage", err);
    return DEFAULT_LAYOUT_STATE;
  }
}

export function useWorkspaceLayout(initialDefaults?: Partial<WorkspaceLayoutState>) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => {
    return { ...DEFAULT_LAYOUT_STATE, ...initialDefaults };
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const stored = readStoredLayout();
    setLayout(stored);
    setIsHydrated(true);
  }, []);

  const persistLayout = useCallback((nextState: WorkspaceLayoutState) => {
    if (typeof window === "undefined") return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      } catch (err) {
        console.warn("Could not save workspace layout to localStorage", err);
      }
    }, 250);
  }, []);

  const updateSizes = useCallback(
    (chatSize: number, previewSize: number) => {
      setLayout((prev) => {
        if (prev.isChatCollapsed) return prev;
        const normalized = normalizeLayoutSizes(chatSize, previewSize);
        const next: WorkspaceLayoutState = {
          ...prev,
          chatPanelSize: normalized.chat,
          previewPanelSize: normalized.preview,
          lastExpandedChatSize: normalized.chat,
          updatedAt: new Date().toISOString(),
        };
        persistLayout(next);
        return next;
      });
    },
    [persistLayout]
  );

  const toggleChatCollapse = useCallback(() => {
    setLayout((prev) => {
      const nextCollapsed = !prev.isChatCollapsed;
      let nextChatSize = prev.chatPanelSize;
      let nextPreviewSize = prev.previewPanelSize;

      if (nextCollapsed) {
        nextChatSize = 0;
        nextPreviewSize = 100;
      } else {
        const restored =
          prev.lastExpandedChatSize > 0
            ? prev.lastExpandedChatSize
            : DEFAULT_LAYOUT_STATE.chatPanelSize;
        nextChatSize = restored;
        nextPreviewSize = 100 - restored;
      }

      const next: WorkspaceLayoutState = {
        ...prev,
        isChatCollapsed: nextCollapsed,
        chatPanelSize: nextChatSize,
        previewPanelSize: nextPreviewSize,
        updatedAt: new Date().toISOString(),
      };
      persistLayout(next);
      return next;
    });
  }, [persistLayout]);

  const setPreviewDevice = useCallback(
    (device: DeviceMode) => {
      setLayout((prev) => {
        const next: WorkspaceLayoutState = {
          ...prev,
          previewDevice: device,
          updatedAt: new Date().toISOString(),
        };
        persistLayout(next);
        return next;
      });
    },
    [persistLayout]
  );

  const resetPreferences = useCallback(() => {
    setLayout(DEFAULT_LAYOUT_STATE);
    persistLayout(DEFAULT_LAYOUT_STATE);
  }, [persistLayout]);

  return {
    layout,
    isHydrated,
    updateSizes,
    toggleChatCollapse,
    setPreviewDevice,
    resetPreferences,
  };
}

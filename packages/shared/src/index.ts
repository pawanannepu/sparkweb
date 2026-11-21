export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  treeHash: string;
  message?: string;
  createdAt: Date;
}

export type PreviewStatus = "idle" | "booting" | "installing" | "running" | "error";

export interface PreviewEvent {
  type: "log" | "error" | "ready" | "status";
  payload: unknown;
  timestamp: number;
}

export type DeviceMode = "desktop" | "tablet" | "mobile";
export type ThemeMode = "dark" | "light" | "system";

export interface WorkspaceLayoutPreferences {
  version: 1;
  chatPanelSize: number;
  previewPanelSize: number;
  lastExpandedChatSize: number;
  isChatCollapsed: boolean;
  previewDevice: DeviceMode;
  updatedAt: string;
}

export type BridgeMessageType =
  | "PREVIEW_READY"
  | "PREVIEW_NAVIGATE"
  | "PREVIEW_RELOAD"
  | "PREVIEW_ERROR"
  | "PREVIEW_RESIZE"
  | "PREVIEW_HEARTBEAT";

export interface BridgeMessage {
  protocol: "sparkweb:bridge:v1";
  type: BridgeMessageType;
  source: "sparkweb:host" | "sparkweb:sandbox";
  payload: Record<string, unknown>;
  timestamp: number;
}

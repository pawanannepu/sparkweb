export interface ProjectFile {
  path: string;
  content: string;
}

export interface SnapshotFileEntry {
  content: string;
  isBinary?: boolean;
}

export type SnapshotFilesMap = Record<string, SnapshotFileEntry>;

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
  | "PREVIEW_BOOT"
  | "PREVIEW_WRITE_FILES"
  | "PREVIEW_READY"
  | "PREVIEW_NAVIGATE"
  | "PREVIEW_RELOAD"
  | "PREVIEW_ERROR"
  | "PREVIEW_RESIZE"
  | "PREVIEW_HEARTBEAT";

export interface PreviewErrorPayload {
  message: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface PreviewBootPayload {
  files: SnapshotFilesMap;
}

export interface PreviewWriteFilesPayload {
  files: ProjectFile[];
}

export interface BridgeMessage {
  protocol: "sparkweb:bridge:v1";
  type: BridgeMessageType;
  source: "sparkweb:host" | "sparkweb:sandbox";
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface FileOperation {
  path: string;
  op: "write" | "delete";
  status: "pending" | "streaming" | "completed" | "failed";
  diff?: string;
}

export interface GenerationPlan {
  plan: PlanStep[];
  fileOperations: FileOperation[];
  model: string;
  provider: string;
  totalTokens?: number;
}

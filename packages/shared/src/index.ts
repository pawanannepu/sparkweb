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

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ElementSourceLocation {
  file: string;
  line: number;
  column: number;
  componentName?: string;
}

export interface SelectedElementState {
  selector: string;
  tagName: string;
  source?: ElementSourceLocation;
  classes: string[];
  styles: Record<string, string>;
  textContent: string;
  rect: ElementRect;
  isEditable: boolean;
  isLeafTextOnly: boolean;
}

export interface CanvasHistoryEntry {
  id: string;
  timestamp: number;
  files: Record<string, string>;
  description: string;
}

export interface CanvasHistoryStack {
  past: CanvasHistoryEntry[];
  present: Record<string, string>;
  future: CanvasHistoryEntry[];
}

export type BridgeMessageType =
  | "PREVIEW_BOOT"
  | "PREVIEW_WRITE_FILES"
  | "PREVIEW_READY"
  | "PREVIEW_NAVIGATE"
  | "PREVIEW_RELOAD"
  | "PREVIEW_ERROR"
  | "PREVIEW_RESIZE"
  | "PREVIEW_HEARTBEAT"
  | "PREVIEW_INSPECT_MODE"
  | "PREVIEW_ELEMENT_HOVER"
  | "PREVIEW_ELEMENT_SELECT"
  | "PREVIEW_INJECT_STYLES"
  | "PREVIEW_UPDATE_TEXT"
  | "PREVIEW_HMR_COMPLETE"
  | "PREVIEW_HEALTH_CHECK"
  | "PREVIEW_HEALTH_STATUS";

export type HealingCategory = "compiler" | "runtime" | "import" | "syntax";
export type HealingAttemptStatus =
  | "analyzing"
  | "patching"
  | "verifying"
  | "resolved"
  | "unfixable";
export type HealingOverallStatus = "none" | "in_progress" | "healed" | "exhausted";

export interface PreviewErrorPayload {
  message: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
  category?: HealingCategory;
  errorFingerprint?: string;
}

export interface HealingAttempt {
  attemptIndex: number;
  errorFingerprint: string;
  category: HealingCategory;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  patchFiles: string[];
  status: HealingAttemptStatus;
  timestamp: number;
}

export interface HealingTelemetry {
  status: HealingOverallStatus;
  totalRepairs: number;
  attempts: HealingAttempt[];
}

export interface PreviewHealthCheckPayload {
  timeoutMs: number;
}

export interface PreviewHealthStatusPayload {
  healthy: boolean;
  error?: PreviewErrorPayload;
}

export interface PreviewBootPayload {
  files: SnapshotFilesMap;
}

export interface PreviewWriteFilesPayload {
  files: ProjectFile[];
}

export interface PreviewInspectModePayload {
  enabled: boolean;
}

export interface PreviewElementHoverPayload {
  rect: ElementRect;
  tagName: string;
  classes: string[];
}

export interface PreviewElementSelectPayload {
  selector: string;
  tagName: string;
  rect: ElementRect;
  source?: ElementSourceLocation;
  classes: string[];
  styles: Record<string, string>;
  textContent: string;
  isEditable: boolean;
  isLeafTextOnly: boolean;
}

export interface PreviewInjectStylesPayload {
  selector: string;
  styles: Record<string, string>;
}

export interface PreviewUpdateTextPayload {
  selector: string;
  text: string;
}

export interface PreviewHmrCompletePayload {
  timestamp: number;
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

export * from "./ai-models";

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
  | "PREVIEW_HEALTH_STATUS"
  | "DB_READY_EVENT"
  | "DB_INTROSPECT_REQUEST"
  | "DB_INTROSPECT_RESPONSE"
  | "DB_QUERY_REQUEST"
  | "DB_QUERY_RESPONSE"
  | "DB_MUTATE_REQUEST"
  | "DB_MUTATE_RESPONSE"
  | "DB_MUTATED_EVENT"
  | "DB_EXPORT_SEED_REQUEST"
  | "DB_EXPORT_SEED_RESPONSE";

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

export type SnapshotTrigger = "generation" | "canvas" | "repair" | "manual" | "rollback";

export interface SnapshotSummary {
  id: string;
  projectId: string;
  parentId: string | null;
  branchId: string | null;
  branchName: string;
  treeHash: string;
  fileCount: number;
  message: string | null;
  trigger: SnapshotTrigger;
  tag: string | null;
  restoredFromSnapshotId: string | null;
  createdAt: string;
}

export interface BranchSummary {
  id: string;
  projectId: string;
  name: string;
  headSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  isMain?: boolean;
  isActive?: boolean;
}

export type FileDiffStatus = "added" | "modified" | "deleted";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  path: string;
  status: FileDiffStatus;
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface SnapshotDiffSummary {
  totalFiles: number;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}

export interface SnapshotDiffResult {
  baseSnapshotId: string | null;
  targetSnapshotId: string;
  summary: SnapshotDiffSummary;
  fileDiffs: FileDiff[];
}

export interface PaginatedSnapshotsResponse {
  items: SnapshotSummary[];
  nextCursor: string | null;
}

export type DatabaseViewerMode = "BOOTING" | "EMPTY" | "READY" | "STREAMING_LOCKED";

export interface DbColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  defaultValue: string | null;
  enumValues?: string[];
}

export interface DbTableMetadata {
  name: string;
  isReadOnly: boolean;
  rowCount: number;
  columns: DbColumnMetadata[];
}

export interface DbReadyEventPayload {
  tableCount: number;
}

export interface DbIntrospectRequestPayload {
  id: string;
}

export interface DbIntrospectResponsePayload {
  id: string;
  tables: DbTableMetadata[];
  error?: string;
}

export interface DbQueryRequestPayload {
  id: string;
  table?: string;
  page?: number;
  pageSize?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  search?: string;
  rawSql?: string;
  readOnly?: boolean;
}

export interface DbQueryResponsePayload {
  id: string;
  rows: Record<string, unknown>[];
  totalCount: number;
  executionTimeMs: number;
  columns?: string[];
  affectedRows?: number;
  error?: string;
}

export type DbMutateAction = "insert" | "update" | "delete";

export interface DbMutateRequestPayload {
  id: string;
  action: DbMutateAction;
  table: string;
  record?: Record<string, unknown>;
  where?: Record<string, unknown>;
  readOnly?: boolean;
}

export interface DbMutateResponsePayload {
  id: string;
  success: boolean;
  affectedRows: number;
  error?: string;
}

export interface DbMutatedEventPayload {
  origin: "app" | "viewer";
  table?: string;
}

export interface DbExportSeedRequestPayload {
  id: string;
}

export interface DbExportSeedResponsePayload {
  id: string;
  sql: string;
  tableCount: number;
  rowCount: number;
  error?: string;
}

export interface ProjectQuerySummary {
  id: string;
  projectId: string;
  title: string;
  sql: string;
  description: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

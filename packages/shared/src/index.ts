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

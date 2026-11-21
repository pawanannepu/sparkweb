import type { PreviewEvent, PreviewStatus, ProjectFile } from "@spark/shared";

export interface SandboxConfig {
  projectId: string;
  files: ProjectFile[];
}

export interface SandboxBridgeMessage {
  id: string;
  source: "host" | "runner";
  event: PreviewEvent;
}

export interface RunnerState {
  status: PreviewStatus;
  url?: string;
  error?: string;
}

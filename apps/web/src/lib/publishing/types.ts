import type { HostRouteRecord } from "@spark/shared";

export interface ArtifactObject {
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface ArtifactUploadSummary {
  fileCount: number;
  totalBytes: number;
}

export interface ArtifactStore {
  uploadDirectory(prefix: string, localDirPath: string): Promise<ArtifactUploadSummary>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getObject(key: string): Promise<ArtifactObject | null>;
  deleteObject?(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export interface CustomHostnameRegistration {
  providerHostnameId: string;
  sslStatus: "pending" | "active" | "failed";
  failureReason?: string | null;
}

export interface HostingAdapter {
  putRoute(hostname: string, route: HostRouteRecord): Promise<void>;
  getRoute(hostname: string): Promise<HostRouteRecord | null>;
  deleteRoute(hostname: string): Promise<void>;
  syncCustomHostname(hostname: string): Promise<CustomHostnameRegistration>;
  getCustomHostnameStatus(providerHostnameId: string): Promise<CustomHostnameRegistration>;
  deleteCustomHostname(providerHostnameId: string): Promise<void>;
}

export interface BuildRunnerOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  npmCacheDir?: string;
}

export interface BuildRunnerResult {
  success: boolean;
  distDir: string | null;
  buildLogs: string;
  durationMs: number;
  errorMessage: string | null;
  cleanup: () => Promise<void>;
}

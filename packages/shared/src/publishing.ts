export type DeploymentStatus = "queued" | "building" | "active" | "failed" | "retired";
export type DeploymentTrigger = "manual" | "rollback";

export type DomainRecordType = "cname" | "apex";
export type DomainVerificationStatus = "unconfigured" | "pending" | "verified" | "failed";
export type DomainSslStatus = "unconfigured" | "pending" | "active" | "failed";

export interface DeploymentSummary {
  id: string;
  projectId: string;
  snapshotId: string | null;
  subdomain: string;
  customDomain: string | null;
  status: DeploymentStatus;
  deploymentUrl: string;
  artifactKey: string | null;
  buildLogs: string | null;
  buildDurationMs: number | null;
  errorMessage: string | null;
  trigger: DeploymentTrigger;
  promotedFromDeploymentId: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDomainSummary {
  id: string;
  projectId: string;
  subdomain: string;
  customDomain: string | null;
  recordType: DomainRecordType | null;
  verificationToken: string | null;
  verificationStatus: DomainVerificationStatus;
  sslStatus: DomainSslStatus;
  failureReason: string | null;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DnsInstructionRecord {
  type: "TXT" | "CNAME" | "A";
  host: string;
  value: string;
  purpose: string;
}

export interface DnsInstructions {
  customDomain: string;
  recordType: DomainRecordType;
  records: DnsInstructionRecord[];
}

export interface DeploymentsListResponse {
  domain: ProjectDomainSummary | null;
  activeDeployment: DeploymentSummary | null;
  items: DeploymentSummary[];
  nextCursor: string | null;
}

export interface PublishTriggerRequest {
  snapshotId?: string;
  previewClean: boolean;
  isStreaming: boolean;
}

export interface PublishTriggerResponse {
  deployment: DeploymentSummary;
  domain: ProjectDomainSummary;
}

export interface DomainUpdateRequest {
  subdomain?: string;
  customDomain?: string;
}

export interface DomainUpdateResponse {
  domain: ProjectDomainSummary;
  dnsInstructions: DnsInstructions | null;
}

export interface HostRouteRecord {
  deploymentId: string;
  projectId: string;
  artifactKey: string;
  updatedAt: string;
}

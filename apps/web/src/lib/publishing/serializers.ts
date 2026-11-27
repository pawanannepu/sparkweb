import {
  ConflictError,
  type Deployment,
  DomainError,
  ForbiddenError,
  NotFoundError,
  type ProjectDomain,
  ValidationError,
} from "@spark/db";
import type { DeploymentSummary, ProjectDomainSummary } from "@spark/shared";
import { NextResponse } from "next/server";

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function serializeDeployment(d: Deployment): DeploymentSummary {
  return {
    id: d.id,
    projectId: d.projectId,
    snapshotId: d.snapshotId ?? null,
    subdomain: d.subdomain,
    customDomain: d.customDomain ?? null,
    status: d.status,
    deploymentUrl: d.deploymentUrl,
    artifactKey: d.artifactKey ?? null,
    buildLogs: d.buildLogs ?? null,
    buildDurationMs: d.buildDurationMs ?? null,
    errorMessage: d.errorMessage ?? null,
    trigger: d.trigger,
    promotedFromDeploymentId: d.promotedFromDeploymentId ?? null,
    retiredAt: toIsoString(d.retiredAt),
    createdAt: toIsoString(d.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(d.updatedAt) ?? new Date().toISOString(),
  };
}

export function serializeProjectDomain(domain: ProjectDomain): ProjectDomainSummary {
  return {
    id: domain.id,
    projectId: domain.projectId,
    subdomain: domain.subdomain,
    customDomain: domain.customDomain ?? null,
    recordType: domain.recordType ?? null,
    verificationToken: domain.verificationToken ?? null,
    verificationStatus: domain.verificationStatus,
    sslStatus: domain.sslStatus,
    failureReason: domain.failureReason ?? null,
    lastCheckedAt: toIsoString(domain.lastCheckedAt),
    verifiedAt: toIsoString(domain.verifiedAt),
    createdAt: toIsoString(domain.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(domain.updatedAt) ?? new Date().toISOString(),
  };
}

export function handlePublishingRouteError(err: unknown, fallbackMessage: string) {
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
  }
  if (err instanceof DomainError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: fallbackMessage, message }, { status: 500 });
}

import { db, getProjectDomain, updateCustomDomainVerificationState } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkVerifyRateLimit, getHostingAdapter, verifyDomainDnsRecords } from "@/lib/publishing";
import { handlePublishingRouteError, serializeProjectDomain } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  const rateLimit = checkVerifyRateLimit(projectId);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many DNS verification attempts. Please wait a minute before retrying." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  try {
    const domain = await getProjectDomain(db, { projectId, userId: user.id });
    if (!domain?.customDomain || !domain.recordType || !domain.verificationToken) {
      return NextResponse.json(
        { error: "No custom domain configured for this project" },
        { status: 404 }
      );
    }

    const now = new Date();
    const dnsResult = await verifyDomainDnsRecords({
      customDomain: domain.customDomain,
      recordType: domain.recordType,
      verificationToken: domain.verificationToken,
    });

    if (!dnsResult.txtVerified) {
      const { domain: failedDomain } = await updateCustomDomainVerificationState(db, {
        projectId,
        userId: user.id,
        verificationStatus: "failed",
        sslStatus: "unconfigured",
        failureReason: dnsResult.failureReason,
        lastCheckedAt: now,
      });

      return NextResponse.json({
        domain: serializeProjectDomain(failedDomain),
      });
    }

    const adapter = getHostingAdapter();
    const hostnameRegistration = domain.providerHostnameId
      ? await adapter.getCustomHostnameStatus(domain.providerHostnameId)
      : await adapter.syncCustomHostname(domain.customDomain);

    const { domain: updatedDomain, activeDeployment } = await updateCustomDomainVerificationState(
      db,
      {
        projectId,
        userId: user.id,
        verificationStatus: "verified",
        sslStatus: hostnameRegistration.sslStatus,
        providerHostnameId: hostnameRegistration.providerHostnameId,
        failureReason: hostnameRegistration.failureReason ?? dnsResult.failureReason,
        lastCheckedAt: now,
        verifiedAt: domain.verifiedAt ?? now,
      }
    );

    if (
      activeDeployment?.artifactKey &&
      updatedDomain.customDomain &&
      updatedDomain.sslStatus === "active"
    ) {
      await adapter.putRoute(updatedDomain.customDomain, {
        deploymentId: activeDeployment.id,
        projectId,
        artifactKey: activeDeployment.artifactKey,
        updatedAt: now.toISOString(),
      });
    }

    return NextResponse.json({
      domain: serializeProjectDomain(updatedDomain),
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to verify custom domain");
  }
}

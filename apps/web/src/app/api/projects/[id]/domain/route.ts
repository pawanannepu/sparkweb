import {
  configureProjectCustomDomain,
  db,
  type ProjectDomain,
  updateProjectSubdomain,
} from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  buildDnsInstructions,
  generateVerificationToken,
  getHostingAdapter,
  removeRoutesForDomain,
  syncRoutesForDomain,
  validateCustomDomainInput,
} from "@/lib/publishing";
import { handlePublishingRouteError, serializeProjectDomain } from "@/lib/publishing/serializers";
import { isValidUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";

const domainPatchSchema = z
  .object({
    subdomain: z.string().min(1).optional(),
    customDomain: z.string().min(1).optional(),
  })
  .refine((data) => data.subdomain !== undefined || data.customDomain !== undefined, {
    message: "Provide subdomain or customDomain to update",
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;

  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(projectId)) {
    return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = domainPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid domain configuration payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const adapter = getHostingAdapter();
    let updatedDomain: ProjectDomain | null = null;

    if (parsed.data.subdomain !== undefined) {
      const subResult = await updateProjectSubdomain(db, {
        projectId,
        userId: user.id,
        subdomain: parsed.data.subdomain,
      });
      updatedDomain = subResult.domain;

      if (
        subResult.previousSubdomain &&
        subResult.previousSubdomain !== subResult.domain.subdomain
      ) {
        await removeRoutesForDomain(adapter, {
          subdomain: subResult.previousSubdomain,
          customDomain: null,
        });
      }

      if (subResult.activeDeployment?.artifactKey) {
        await syncRoutesForDomain(adapter, subResult.domain, {
          deploymentId: subResult.activeDeployment.id,
          projectId,
          artifactKey: subResult.activeDeployment.artifactKey,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (parsed.data.customDomain !== undefined) {
      const { customDomain, recordType } = validateCustomDomainInput(parsed.data.customDomain);
      const verificationToken = generateVerificationToken();

      const customResult = await configureProjectCustomDomain(db, {
        projectId,
        userId: user.id,
        customDomain,
        recordType,
        verificationToken,
      });
      updatedDomain = customResult.domain;

      if (
        customResult.previousCustomDomain &&
        customResult.previousCustomDomain !== customResult.domain.customDomain
      ) {
        await adapter.deleteRoute(customResult.previousCustomDomain);
      }

      if (customResult.previousProviderHostnameId) {
        await adapter.deleteCustomHostname(customResult.previousProviderHostnameId);
      }
    }

    if (!updatedDomain) {
      return NextResponse.json({ error: "No domain update applied" }, { status: 400 });
    }

    const dnsInstructions =
      updatedDomain.customDomain && updatedDomain.recordType && updatedDomain.verificationToken
        ? buildDnsInstructions(
            updatedDomain.customDomain,
            updatedDomain.recordType,
            updatedDomain.verificationToken
          )
        : null;

    return NextResponse.json({
      domain: serializeProjectDomain(updatedDomain),
      dnsInstructions,
    });
  } catch (err) {
    return handlePublishingRouteError(err, "Failed to update project domain");
  }
}

import path from "node:path";
import { db, resolveLiveDeploymentBySubdomain } from "@spark/db";
import { type NextRequest, NextResponse } from "next/server";
import { getArtifactStore, getHostingAdapter, getPlatformHostnames } from "@/lib/publishing";

export const dynamic = "force-dynamic";

function buildSecurityHeaders(relativePath: string, contentType: string): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");

  if (relativePath.startsWith("assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  } else if (relativePath === "index.html") {
    headers.set("Cache-Control", "no-cache");
  } else {
    headers.set("Cache-Control", "public, max-age=300");
  }

  return headers;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ subdomain: string; path?: string[] }> }
) {
  const { subdomain, path: pathSegments } = await params;
  const normalizedSubdomain = subdomain.toLowerCase().trim();

  // Enforce origin isolation: direct hits on builder origin redirect to subdomain origin (AC-8)
  const rawHost = (req.headers.get("host") || "").toLowerCase().trim();
  const hostWithoutPort = rawHost.replace(/:\d+$/, "");
  if (hostWithoutPort === "localhost" || hostWithoutPort === "127.0.0.1") {
    const portMatch = /:(\d+)$/.exec(rawHost);
    const portSuffix = portMatch ? `:${portMatch[1]}` : "";
    const restPath = pathSegments && pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "/";
    const isolatedUrl = `http://${normalizedSubdomain}.localhost${portSuffix}${restPath}${req.nextUrl.search}`;
    return NextResponse.redirect(isolatedUrl, 307);
  }

  const hostingAdapter = getHostingAdapter();
  const artifactStore = getArtifactStore();

  const candidateHosts = [hostWithoutPort, ...getPlatformHostnames(normalizedSubdomain)];
  let route = null;
  for (const candidate of candidateHosts) {
    if (!candidate) continue;
    route = await hostingAdapter.getRoute(candidate);
    if (route) break;
  }

  if (!route) {
    const dbFallback = await resolveLiveDeploymentBySubdomain(db, normalizedSubdomain);
    if (dbFallback) {
      route = {
        deploymentId: dbFallback.deploymentId,
        projectId: dbFallback.projectId,
        artifactKey: dbFallback.artifactKey,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  if (!route) {
    return new NextResponse("Site not found or unpublished", {
      status: 404,
      headers: buildSecurityHeaders("index.html", "text/plain; charset=utf-8"),
    });
  }

  const rawSegments = pathSegments ?? [];
  if (rawSegments.some((seg) => seg === ".." || seg === "." || seg.includes("\0"))) {
    return new NextResponse("Not found", {
      status: 404,
      headers: buildSecurityHeaders("index.html", "text/plain; charset=utf-8"),
    });
  }

  const requestedPath = rawSegments.length > 0 ? rawSegments.join("/") : "index.html";
  const prefix = route.artifactKey.replace(/\/+$/, "");

  const directAsset = await artifactStore.getObject(`${prefix}/${requestedPath}`);
  if (directAsset) {
    return new NextResponse(Buffer.from(directAsset.body), {
      status: 200,
      headers: buildSecurityHeaders(requestedPath, directAsset.contentType),
    });
  }

  // SPA fallback to index.html only for extensionless client-side routes (AC-8)
  const hasFileExtension = path.posix.extname(requestedPath) !== "";
  if (!hasFileExtension) {
    const indexAsset = await artifactStore.getObject(`${prefix}/index.html`);
    if (indexAsset) {
      return new NextResponse(Buffer.from(indexAsset.body), {
        status: 200,
        headers: buildSecurityHeaders("index.html", "text/html; charset=utf-8"),
      });
    }
  }

  return new NextResponse("Not found", {
    status: 404,
    headers: buildSecurityHeaders("index.html", "text/plain; charset=utf-8"),
  });
}

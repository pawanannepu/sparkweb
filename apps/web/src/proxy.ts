import { type NextRequest, NextResponse } from "next/server";

function getPlatformHost(): string {
  return (process.env.PLATFORM_DOMAIN || "sparkapps.dev").toLowerCase().trim().replace(/:\d+$/, "");
}

export function extractPublishedSubdomain(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  const hostname = hostHeader.toLowerCase().trim().replace(/:\d+$/, "");

  if (hostname.endsWith(".localhost")) {
    const sub = hostname.slice(0, -".localhost".length);
    if (sub && !sub.includes(".")) {
      return sub;
    }
  }

  const platformHost = getPlatformHost();
  if (
    platformHost !== "localhost" &&
    platformHost !== "127.0.0.1" &&
    hostname.endsWith(`.${platformHost}`)
  ) {
    const sub = hostname.slice(0, -(platformHost.length + 1));
    if (sub && !sub.includes(".") && sub !== "www" && sub !== "api" && sub !== "app") {
      return sub;
    }
  }

  return null;
}

export function proxy(request: NextRequest) {
  const hostHeader = request.headers.get("host");
  const subdomain = extractPublishedSubdomain(hostHeader);

  if (subdomain) {
    const rewriteUrl = request.nextUrl.clone();
    const targetPath = request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname;
    rewriteUrl.pathname = `/live/${subdomain}${targetPath}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  // Redirect direct /live/[subdomain] hits on builder origin to isolated subdomain origin (AC-8)
  if (request.nextUrl.pathname.startsWith("/live/")) {
    const segments = request.nextUrl.pathname.split("/").filter(Boolean);
    const targetSubdomain = segments[1];
    if (targetSubdomain) {
      const restPath = segments.length > 2 ? `/${segments.slice(2).join("/")}` : "/";
      const currentHost = (hostHeader || "localhost:3000").toLowerCase().trim();
      const portMatch = /:(\d+)$/.exec(currentHost);
      const portSuffix = portMatch ? `:${portMatch[1]}` : "";
      const platformDomain = process.env.PLATFORM_DOMAIN || `localhost${portSuffix}`;
      const protocol = platformDomain.includes("localhost") ? "http" : "https";
      const isolatedOrigin = `${protocol}://${targetSubdomain}.${platformDomain}`;
      return NextResponse.redirect(
        new URL(`${restPath}${request.nextUrl.search}`, isolatedOrigin),
        307
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/image).*)"],
};

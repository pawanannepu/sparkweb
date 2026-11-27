import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { extractPublishedSubdomain, proxy } from "./proxy";

describe("proxy origin isolation and subdomain routing", () => {
  const originalPlatformDomain = process.env.PLATFORM_DOMAIN;

  afterEach(() => {
    if (originalPlatformDomain === undefined) {
      delete process.env.PLATFORM_DOMAIN;
    } else {
      process.env.PLATFORM_DOMAIN = originalPlatformDomain;
    }
  });

  // covers: AC-8
  it("extracts published subdomains from .localhost and custom PLATFORM_DOMAIN while ignoring reserved hosts", () => {
    expect(extractPublishedSubdomain(null)).toBeNull();
    expect(extractPublishedSubdomain("localhost:3000")).toBeNull();
    expect(extractPublishedSubdomain("demo-app.localhost:3000")).toBe("demo-app");
    expect(extractPublishedSubdomain("a.b.localhost:3000")).toBeNull();

    process.env.PLATFORM_DOMAIN = "sparkapps.dev";
    expect(extractPublishedSubdomain("my-site.sparkapps.dev")).toBe("my-site");
    expect(extractPublishedSubdomain("www.sparkapps.dev")).toBeNull();
    expect(extractPublishedSubdomain("api.sparkapps.dev")).toBeNull();
    expect(extractPublishedSubdomain("app.sparkapps.dev")).toBeNull();
    expect(extractPublishedSubdomain("sparkapps.dev")).toBeNull();
  });

  // covers: AC-8
  it("rewrites subdomain requests to internal /live/[subdomain] handler", () => {
    const rootReq = new NextRequest("http://demo-app.localhost:3000/", {
      headers: { host: "demo-app.localhost:3000" },
    });
    const rootRes = proxy(rootReq);
    expect(rootRes.headers.get("x-middleware-rewrite")).toBe(
      "http://demo-app.localhost:3000/live/demo-app"
    );

    const nestedReq = new NextRequest("http://demo-app.localhost:3000/settings/profile?x=1", {
      headers: { host: "demo-app.localhost:3000" },
    });
    const nestedRes = proxy(nestedReq);
    expect(nestedRes.headers.get("x-middleware-rewrite")).toBe(
      "http://demo-app.localhost:3000/live/demo-app/settings/profile?x=1"
    );
  });

  // covers: AC-8
  it("redirects direct /live/[subdomain] hits on the builder origin to the isolated subdomain origin", () => {
    delete process.env.PLATFORM_DOMAIN;
    const req = new NextRequest("http://localhost:3000/live/demo-app/about?ref=1", {
      headers: { host: "localhost:3000" },
    });
    const res = proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://demo-app.localhost:3000/about?ref=1");
  });

  // covers: AC-8
  it("passes through regular builder workspace requests untouched", () => {
    const req = new NextRequest("http://localhost:3000/api/projects", {
      headers: { host: "localhost:3000" },
    });
    const res = proxy(req);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
